#!/usr/bin/env python3
"""Guard anti-vazamento do SCA. Roda no pre-commit e barra o commit (exit 1) se
achar, em arquivo VERSIONADO, o que nao pode ficar num repositorio publico:

1. Caminho de maquina: drive local (C:\\, D:\\), unidade mapeada (Y:\\) ou UNC
   (\\\\servidor\\share). Mapeamento de unidade e local de cada maquina, entao ele
   nem descreve a realidade de quem le.
2. IP interno (10.x, 192.168.x, 172.16-31.x): topologia da rede da DGEO.
3. Segredo com valor: senha, token, api_key, client_secret, credencial em URL,
   e prefixos de alta entropia (GitHub, JWT, Google, Slack).

Onde essa informacao mora: nas chaves do `server/config.env`, que e gitignored.
Arquivo versionado cita a CHAVE, nunca o valor. O catalogo sem segredo esta em
`.env.example`.

Escape explicito: a linha com o marcador `path-ok` passa. Use quando a linha for
o exemplo da propria regra, e nunca para empurrar vazamento de verdade.

Uso a mao:
    python scripts/check_vazamento.py

DE PROPOSITO, este guard NAO checa estilo (em-dash, acento). O repositorio tem
221 em-dashes herdados, e guard que bloqueia todo commit ensina `--no-verify`,
que e o contrario de guardar. Aqui so entra o que vaza.
"""
import os
import re
import subprocess
import sys

# Drive local ou unidade mapeada: letra + ':' + barra + caminho.
# Exige DOIS caracteres de caminho para nao pegar a sequencia de escape `:\n` de
# string ("problemas:\n"), que era 40% dos falsos positivos na primeira medicao.
DRIVE_RE = re.compile(r"[A-Za-z]:[\\/][\w.$~-]{2,}")
# UNC com barra invertida (\\servidor\share). O lookahead descarta o escape
# unicode `\\u0300` de expressao regular em JavaScript, e o piso de 2 caracteres
# no host descarta `\\n\\n` de docstring: nome de servidor nao tem 1 letra.
UNC_RE = re.compile(r"\\\\(?!u[0-9a-fA-F]{4})([A-Za-z0-9._-]{2,})\\")
# UNC com barra normal (//servidor/share). Exige ponto no host: sem isso, todo
# hash base64 com `//` no meio (integrity de lockfile) virava achado.
UNC_BARRA_RE = re.compile(r"(?<![:\w/])//([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/")
# IP interno (RFC 1918).
IP_INTERNO_RE = re.compile(
    r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"
    r"|\b192\.168\.\d{1,3}\.\d{1,3}\b"
    r"|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b"
)
# Nome de segredo seguido de valor.
SEGREDO_NOME_RE = re.compile(
    r"(?i)\b(senha|password|passwd|pwd|token|secret|api[_-]?key|client[_-]?secret"
    r"|credential|access[_-]?key)[\"'`]?\s*[:=]\s*[\"'`]?([^\s\"'`,;)*]+)"
)
# Prefixo de alta entropia, independente do nome da variavel. Pega o segredo
# colado num comentario ou num exemplo de curl, onde nao ha variavel nenhuma.
SEGREDO_PREFIXO_RE = re.compile(
    r"\b(gh[pousr]_[A-Za-z0-9]{16,}"
    r"|github_pat_[A-Za-z0-9_]{20,}"
    r"|eyJ[A-Za-z0-9_-]{20,}"
    r"|GOCSPX-[A-Za-z0-9_-]{10,}"
    r"|AIza[A-Za-z0-9_-]{20,}"
    r"|sk-[A-Za-z0-9]{20,}"
    r"|xox[baprs]-[A-Za-z0-9-]{10,})"
)
# Credencial embutida em URL: esquema://usuario:senha@host. O `${` e o `%s` sao
# interpolacao (`postgres://${dbUser}:${dbPassword}@...` monta a URL a partir do
# config.env, e e exatamente o jeito CERTO de fazer).
CRED_URL_RE = re.compile(r"\b[a-z][a-z0-9+.-]*://(?![^\s@]*(?:\$\{|%s|<))[^/\s:@]+:[^/\s@]+@")

# Valores que sao placeholder de documentacao ou referencia de codigo, nao segredo.
PLACEHOLDER_SUBSTR = ("<", ">", "$", "%", "...", "xxx", "***", "senha", "password",
                      "env", "exemplo", "sua", "seu", "minha", "changeme", "trocar")
CODE_SUBSTR = ("[", "(", "{", ".", "_env", "env[", "getenv", "environ")
STOPWORDS = {"a", "o", "e", "de", "do", "da", "em", "no", "na", "que", "ver", "com",
             "sem", "ok", "id", "login", "usuario", "await", "none", "null", "true",
             "false", "valor", "bearer", "jwt", "csrf", "reset", "refresh",
             # fixture de teste e tipo de documentacao, nao credencial
             "pass", "string", "test", "teste", "fake", "dummy", "1234", "abc"}
ENVKEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")
CODE_PREFIX = ("self.", "this.", "os.", "process.", "config", "args.", "opts.", "req.", "res.")

ALLOW_MARK = "path-ok"
UNC_HOST_PLACEHOLDER = ("host", "servidor")

SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ico", ".zip", ".gz", ".svg",
            ".ods", ".xlsx", ".docx", ".pptx", ".node", ".db", ".sqlite", ".woff", ".woff2"}
SKIP_DIRS = ("node_modules/", "server/src/build/", "client/dist/")
# Gerado por ferramenta: nao ha texto humano onde um segredo caiba.
SKIP_BASENAMES = {"package-lock.json"}
# O proprio guard enuncia a regra com exemplos.
SKIP_FILES = {os.path.normpath("scripts/check_vazamento.py")}


def arquivos_versionados():
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
    return [p for p in out.decode("utf-8", "replace").split("\0") if p]


def _valor_e_literal(nome, valor):
    """True se o valor parece segredo de verdade, e nao placeholder nem codigo."""
    vlow = valor.lower()
    if len(valor) < 3 or vlow in STOPWORDS:
        return False
    if vlow == nome.lower().replace("_", "").replace("-", ""):
        return False  # `token=token`: repasse de variavel
    if any(p in vlow for p in PLACEHOLDER_SUBSTR):
        return False
    if any(p in vlow for p in CODE_SUBSTR):
        return False
    if ENVKEY_RE.match(valor) or vlow.startswith(CODE_PREFIX):
        return False
    return True


def varrer_linha(linha):
    """Devolve os trechos suspeitos da linha, ja filtrado o que e legitimo."""
    if ALLOW_MARK in linha:
        return []
    achados = []
    for m in SEGREDO_PREFIXO_RE.finditer(linha):
        achados.append(m.group(1)[:12] + "...")  # nunca ecoa o segredo inteiro
    for _ in CRED_URL_RE.finditer(linha):
        achados.append("credencial em URL")
    for m in DRIVE_RE.finditer(linha):
        achados.append(m.group(0))
    for m in UNC_RE.finditer(linha):
        if m.group(1).lower() not in UNC_HOST_PLACEHOLDER:
            achados.append(m.group(0))
    for m in UNC_BARRA_RE.finditer(linha):
        if m.group(1).lower() not in UNC_HOST_PLACEHOLDER:
            achados.append(m.group(0))
    for m in IP_INTERNO_RE.finditer(linha):
        achados.append(m.group(0))
    for m in SEGREDO_NOME_RE.finditer(linha):
        nome, valor = m.group(1), m.group(2)
        # Segredo real tem comprimento. "token: das" e a palavra no sentido de
        # pedaco de texto. Senha curta continua coberta pelo piso de 3.
        piso = 3 if nome.lower() in ("senha", "password", "passwd", "pwd") else 12
        if len(valor) >= piso and _valor_e_literal(nome, valor):
            achados.append(nome + "=<valor literal>")
    return achados


def main():
    try:
        arquivos = arquivos_versionados()
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("ERRO: nao consegui rodar `git ls-files`. Esta num repositorio git?")
        return 2

    achados = []
    varridos = 0
    for rel in arquivos:
        norm = rel.replace("\\", "/")
        if os.path.normpath(rel) in SKIP_FILES:
            continue
        if any(norm.startswith(d) for d in SKIP_DIRS):
            continue
        if os.path.basename(norm) in SKIP_BASENAMES:
            continue
        if os.path.splitext(rel)[1].lower() in SKIP_EXT:
            continue
        try:
            with open(rel, encoding="utf-8") as fh:
                linhas = fh.readlines()
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError, PermissionError):
            continue
        varridos += 1
        for i, linha in enumerate(linhas, 1):
            for trecho in varrer_linha(linha):
                achados.append((rel, i, trecho, linha.strip()))

    print("=== GUARD ANTI-VAZAMENTO (%d arquivos versionados varridos) ===" % varridos)
    if not achados:
        print("OK: nenhum caminho de maquina, UNC, IP interno nem segredo com valor.")
        return 0

    print("BLOQUEIO: %d achado(s). Este repositorio e PUBLICO.\n"
          "Troque o valor pela CHAVE do config.env (catalogo em .env.example), pelo\n"
          "nome do arquivo ou pela URL do GitHub. Se a linha for exemplo legitimo da\n"
          "propria regra, marque-a com `path-ok`.\n" % len(achados))
    for rel, num, trecho, linha in achados:
        print("    %s:%d: [%s]  %s" % (rel, num, trecho, linha[:120]))
    return 1


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
