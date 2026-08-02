# Levantar o Controle do Acervo (SCA)

Desde 2026-08-02 o SCA **nao depende de servico externo para subir**: a autenticacao veio para dentro (`dgeo.usuario.senha`, hash bcrypt), e o `verifyAuthServer` saiu do boot (`main.js`: `db -> versao -> cron -> startServer`). Basta o PostgreSQL.

## Componentes e portas

| Componente | Porta | Observacao |
|---|---|---|
| PostgreSQL + PostGIS | 5432 (dev) / 5434 (prod) | banco `sca`; unica dependencia |
| SCA server | 3015 | API REST + a interface unica em `/` |
| Client (dev) | 3003 | Vite, com proxy `/api` -> 3015 |

Em **producao** o server serve a interface na mesma origem, sem proxy nem porta extra: `npm run build` builda `client/` para `server/src/build`, servido em `/`. As chamadas de API sao `/api/...` na mesma origem.

## Desenvolvimento (local)

Banco `sca` em `localhost`:
```bash
cd <sca>/server && npm run dev                  # SCA 3015
cd <sca> && npm run dev-client                  # interface 3003
```

Para trabalhar contra o banco de **producao** a partir da maquina local, aponte `DB_*` do `config.env` para producao. Vale para ler e depurar; escrever assim mexe em dado real.

## Producao (rede da DGEO)

Este repositorio e PUBLICO. Endereco de servidor, porta acoplada a host, pasta de rede e credencial vivem so no `server/config.env`, que e gitignored. Aqui se cita a CHAVE; o catalogo comentado esta em `.env.example`.

O banco `sca` fica na rede interna: veja `DB_SERVER` e `DB_PORT`. Clientes de login: `sca_web` (interface) e `sca_qgis` (plugin), que e o que a coluna `dgeo.login.cliente` guarda. Os arquivos do acervo ficam no volume descrito na coluna `acervo.volume_armazenamento.volume`, no proprio banco, que e a fonte canonica do caminho.

1. `server/config.env`: `DB_*` do banco de producao, `DB_USER_READONLY` e `DB_PASSWORD_READONLY`. (A role de leitura precisa existir no banco antes do deploy.) `AUTH_SERVER` e `USE_PROXY` sairam em 2026-08-02 e podem ficar no arquivo sem efeito.
2. Deploy (build da interface + PM2, idempotente):
   ```bash
   npm run deploy   # = npm run build + pm2 startOrReload ecosystem.config.cjs + pm2 save
   ```
   Sobe um processo PM2: `controle-acervo` (3015). A interface fica em `/`.
3. Auto-start no boot: `pm2 startup` (uma vez, como admin) + `pm2 save`.

O banco precisa estar na versao **1.12.0**. O server recusa subir com banco abaixo do `MIN_DATABASE_VERSION` (`semver.lt`), e aceita banco a frente. Migracoes em `migrations/`, aplicadas em ordem de data.

## Smoke tests

**Depois de todo deploy, rode a fumaca inteira.** Ela exercita os tres modulos de ponta a ponta, so com leitura, e sai com codigo 1 se algo falhar (serve de portao num script de deploy):

```bash
SCA_URL=http://localhost:3015 SCA_USER=<login> SCA_SENHA=<senha> python scripts/fumaca.py
```

Cada checagem imprime o que esperava e o que veio. Duas delas conferem CONTAGEM, e nao so o HTTP: as subsecoes do RPCMTec e as linhas de cada bloco do Anuario. Sao os dois numeros que caem em silencio se uma subsecao sumir do gerador ou se a planilha-semente for trocada por uma de outro formato.

Os minimos da fumaca sao do acervo da DGEO em 2026-07. Instalacao nova devolve menos: ajuste os minimos ou rode so as checagens de rota.

Conferencia rapida, sem credencial:
```bash
curl -s http://localhost:3015/api | grep operacional                            # SCA
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3015/                 # interface
```

URLs (prod): interface <http://HOST:3015>; Swagger <http://HOST:3015/api/api_docs>.

## Guard anti-vazamento (rode uma vez por clone)

```bash
git config core.hooksPath .githooks
```

Sem isso o `.githooks/pre-commit` nao roda, porque o git nao versiona `.git/hooks`. O guard e o `scripts/check_vazamento.py`: ele barra o commit que leve IP interno, pasta de rede, caminho de maquina ou segredo com valor para este repositorio, que e PUBLICO.

## Troubleshooting

- **SCA sobe e cai na hora** -> banco fora do ar ou `DB_*` errado. Ate 2026-08-02 a causa comum era outra (o Auth Server fora do ar), e ela deixou de existir com a fusao.
- **Ninguem consegue entrar, com "Usuario sem senha cadastrada"** -> a migracao `2026-08-02_autenticacao_local.sql` foi aplicada e a copia dos hashes nao. Rode `scripts/copiar_usuarios_auth.js` (em ensaio primeiro). A tela `#/usuarios` marca quem esta sem senha.
- **Erro de conexao com banco** -> PostgreSQL parado ou `DB_*` errado no `config.env`.
- **Boot recusado por versao** -> banco abaixo de `MIN_DATABASE_VERSION`; falta aplicar migracao de `migrations/`.
- **Interface em branco / 404 nos assets** -> `base` no `client/vite.config.js` tem que ser `'/'`, e o `build/` precisa ter sido gerado (`npm run build`).
- **Modulo some do seletor** -> a pessoa nao tem linha em `dgeo.usuario_perfil` para aquele modulo, e nao e `administrador`. Conceder e ato explicito, pela tela de usuarios. Se `modulos` vier vazio no corpo do `POST /api/login`, o problema esta no banco, nao na tela.
- **Rota do orcamento devolve 403 para quem tem perfil** -> a rota pode ter ficado sem o segundo argumento do `verifyPerfil`, e estar cobrando perfil no acervo. O teste `routes/orcamento/modulo_em_toda_rota.test.js` barra isso.
- **`confirm-upload` responde "Arquivo nao encontrado" para todo arquivo, em servidor Linux** -> a coluna `acervo.volume_armazenamento.volume` guarda caminho UNC do Windows. Em Linux a contrabarra e caractere comum de nome, e o `path.join` junta com barra normal, produzindo caminho relativo inexistente. Monte o compartilhamento por CIFS e grave o PONTO DE MONTAGEM na coluna. As duas coisas sao a MESMA mudanca: separadas, o cadastro para de validar checksum. Medido no banco de producao em 2026-07-27.
