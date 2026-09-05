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
#
# O lookbehind e o resto do conserto, e veio de um bloqueio de verdade: a letra
# de unidade e UMA letra, entao ela nunca vem grudada em outra. Sem ele, a
# mensagem "...localizar o arquivo de origem para:\n- " casava como se `a:\n-`
# fosse um caminho -- o "a" de "para" mais o escape de linha mais o marcador de
# lista. Toda frase em portugues terminada em "para:", "pasta:" ou "mapa:"
# seguida de `\n-` cai no mesmo lugar. Ele NAO afrouxa a regra: caminho real
# ("C:\\Users", "dir=D:\\dados") sempre traz aspas, espaco, sinal ou inicio de
# linha antes da letra, nunca outra letra.
DRIVE_RE = re.compile(r"(?<![^\W\d_])[A-Za-z]:[\\/][\w.$~-]{2,}")
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
#
# O `[A-Za-z0-9_]*?` ANTES do nome nao e enfeite: sem ele o `\b` sozinho nao casa
# nada que leve prefixo, e prefixo e justamente a convencao deste repositorio.
# `DB_PASSWORD=<valor>`, `AUTH_DB_PASSWORD=`, `SCA_SENHA=`, `JWT_SECRET=`,
# `PGPASSWORD=` e o `dbPassword = "..."` em camelCase passavam TODOS, porque
# entre `_` (ou entre `b` e `P`) e a palavra nao ha fronteira de palavra. Eram as
# cinco chaves reais do `config.env` e a forma que o codigo do servidor usa: o
# guard barrava `password=x` e deixava passar `DB_PASSWORD=x`.
#
# O que impede o casamento solto e o SUFIXO exigido (`:` ou `=` logo depois, com
# aspas opcionais): "tokenizer", "secretaria" e "desenhado" nao sao seguidos de
# atribuicao, entao nao entram.
SEGREDO_NOME_RE = re.compile(
    r"(?i)\b[A-Za-z0-9_]*?(senha|password|passwd|pwd|token|secret|api[_-]?key"
    r"|client[_-]?secret|credential|access[_-]?key)[\"'`]?\s*[:=]\s*[\"'`]?([^\s\"'`,;)*]+)"
)
# As grafias REAIS das chaves deste repositorio (`.env.example`), como SEGUNDA
# regra e nao como remendo da primeira. A generica acima recusa o nome precedido
# de minuscula, que e o que a faz nao acusar `nao o desenha:`; o preco disso e
# que `dbpassword=<valor>` e `"dbpassword": "<valor>"` tambem passam, porque
# casing sozinho nao distingue `dbpassword` de `desenha`. Aqui o nome INTEIRO e
# casado, prefixo junto, entao nao ha o que confundir com prosa: nenhuma palavra
# em portugues termina em `db_password`. O valor continua passando pelo mesmo
# `_valor_e_literal`, para que `SCA_SENHA=<sua senha>` do `.env.example` siga
# sendo um catalogo e nao um achado.
SEGREDO_CHAVE_REAL_RE = re.compile(
    r"(?i)\b((?:DB|AUTH_DB|SCA|JWT|PG)_?(?:PASSWORD|SENHA|SECRET))[\"'`]?\s*[:=]\s*[\"'`]?([^\s\"'`,;)*]+)"
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
# `valor` e `teste` NAO entram aqui, e a ausencia e deliberada: como SUBSTRING
# eles engoliam `SCA_SENHA=meuvalorsecreto` e `senha: testeReal9f8a`, que sao
# segredo de verdade. A fixture deste repositorio (`valor-de-teste`) sai pela
# porta certa, que e a igualdade de STOPWORDS logo abaixo.
PLACEHOLDER_SUBSTR = ("<", ">", "$", "%", "...", "xxx", "***", "senha", "password",
                      "env", "exemplo", "sua", "seu", "minha", "changeme", "trocar")
CODE_SUBSTR = ("[", "(", "{", ".", "_env", "env[", "getenv", "environ")
STOPWORDS = {"a", "o", "e", "de", "do", "da", "em", "no", "na", "que", "ver", "com",
             "sem", "ok", "id", "login", "usuario", "await", "none", "null", "true",
             "false", "valor", "bearer", "jwt", "csrf", "reset", "refresh",
             # palavra de CODIGO no lugar do valor: `const trocarSenha = async (`
             "async", "function", "new", "const", "let", "var", "return", "require",
             # fixture de teste e tipo de documentacao, nao credencial
             "pass", "string", "test", "teste", "fake", "dummy", "1234", "abc",
             # a fixture literal do repositorio, por IGUALDADE e nunca por substring
             "valor-de-teste"}
ENVKEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")
CODE_PREFIX = ("self.", "this.", "os.", "process.", "config", "args.", "opts.", "req.", "res.")
# Operador de codigo no lugar do valor: `const meuToken = ++requisicao`.
OPERADOR_CODIGO_RE = re.compile(r"^[+\-*/=<>!&|^~]+[A-Za-z_$][A-Za-z0-9_$.]*$")
# Identificador nu no lugar do valor: `download_token: downloadToken`.
IDENTIFICADOR_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")
# UUID canonico. Neste sistema o uuid e IDENTIFICADOR (uuid_versao, usuario_uuid,
# download_token), e ele viaja em resposta de API e em fixture de schema. Tratar
# a forma dele como segredo bloquearia o commit de toda fixture.
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")

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
    # `++requisicao` do `const meuToken = ++requisicao` nao e valor nenhum. O
    # teste era "comeca em alfanumerico", e ele custava caro: senha forte comeca
    # em caractere especial com frequencia, e `senha = "!Str0ngP@ssWord"` passava
    # batido por causa do `!`. O que separa os dois nao e o primeiro caractere, e
    # sim o RESTO: depois do operador, codigo traz um identificador puro
    # (`++requisicao`, `!!valido`) e segredo traz pontuacao no meio. O `$` do
    # hash bcrypt continua caindo no PLACEHOLDER.
    if OPERADOR_CODIGO_RE.match(valor):
        return False
    nlow = nome.lower().replace("_", "").replace("-", "")
    vident = vlow.replace("_", "").replace("-", "")
    if vident == nlow:
        return False  # `token=token`: repasse de variavel
    # `download_token: downloadToken`: identificador nu batizado com o proprio
    # nome do segredo. E a variavel, nunca o valor dela.
    #
    # O `not any(digito)` e o limite da regra, e ele custou uma medicao: sem ele
    # `token = "tokenABC123XYZ456"` e `api_key = "apikeyLive9f8a7b6c5d"` saiam
    # como "variavel", e sao exatamente a forma de um segredo gerado que carrega
    # o proprio nome no prefixo. Nome de variavel de codigo neste repositorio nao
    # leva digito no meio.
    if nlow in vident and IDENTIFICADOR_RE.match(valor) and not any(c.isdigit() for c in valor):
        return False
    if UUID_RE.match(valor):
        return False
    if any(p in vlow for p in PLACEHOLDER_SUBSTR):
        return False
    if any(p in vlow for p in CODE_SUBSTR):
        return False
    if ENVKEY_RE.match(valor) or vlow.startswith(CODE_PREFIX):
        return False
    return True


def _nome_e_identificador(linha, inicio, nome):
    """False quando o nome casado e o FIM de uma palavra em prosa.

    `nao o desenha:` e `o mapa desenha:` casavam `senha` com um `e` minusculo
    grudado antes, e viravam achado numa linha de comentario em portugues. Um
    nome de verdade se separa por `_`, por caixa (`dbPassword`, `PGPASSWORD`) ou
    por inicio de palavra; nunca por duas minusculas seguidas.
    """
    if inicio == 0:
        return True
    anterior = linha[inicio - 1]
    if anterior.islower() and anterior.isalpha() and nome[0].islower():
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
    # As duas regras de nome escrevem no mesmo balde, e a posicao do VALOR e a
    # chave: uma linha `DB_PASSWORD=x` casa nas duas, e sem isso ela sairia
    # duas vezes no relatorio.
    vistos = set()
    for m in SEGREDO_CHAVE_REAL_RE.finditer(linha):
        nome, valor = m.group(1), m.group(2)
        if len(valor) >= 3 and _valor_e_literal(nome, valor):
            vistos.add(m.start(2))
            achados.append(nome + "=<valor literal>")
    for m in SEGREDO_NOME_RE.finditer(linha):
        nome, valor = m.group(1), m.group(2)
        if m.start(2) in vistos:
            continue
        if not _nome_e_identificador(linha, m.start(1), nome):
            continue
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
