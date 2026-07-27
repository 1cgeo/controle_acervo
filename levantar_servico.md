# Levantar o Controle do Acervo (SCA)

O SCA server **aborta o boot se o Auth Server nao estiver operacional** (`main.js`: `db -> verifyAuthServer -> cron -> startServer`). Suba o auth antes.

## Componentes e portas

| Componente | Porta | Observacao |
|---|---|---|
| PostgreSQL + PostGIS | 5432 (dev) / 5434 (prod) | banco `sca` |
| Auth Server | 3010 (dev) / 4000 (prod) | dependencia; subir primeiro |
| SCA server | 3015 | API REST + a interface unica em `/` |
| Client (dev) | 3003 | Vite, com proxy `/api` -> 3015 |

Desde 2026-07-27 existe **uma interface so**, em `client/`, com os tres modulos dentro: acervo, mapoteca e orcamento. Trocar de modulo e trocar de rota (`#/acervo/...`, `#/mapoteca/...`, `#/orcamento/...`), sem recarregar e sem novo login. Os clients antigos (`acervo_client` e `mapoteca_client`) foram apagados; o historico do git os guarda.

Em **producao** o server serve a interface na mesma origem, sem proxy nem porta extra: `npm run build` builda `client/` para `server/src/build`, servido em `/`. As chamadas de API sao `/api/...` na mesma origem.

## Producao (rede da DGEO)

Banco `sca` em `10.25.163.12:5434`; auth em `http://10.25.163.7:4000`; clientes `sca_web`/`sca_qgis`. Arquivos no share `\\10.25.163.8\sca\sca_acervo` (referenciado em `acervo.volume_armazenamento`, no banco).

1. `server/config.env`: `DB_*` do banco de producao, `DB_USER_READONLY=sca_readonly`, `AUTH_SERVER=http://10.25.163.7:4000`, `USE_PROXY=false`. (Role `sca_readonly` precisa existir no banco.)
2. Deploy (build da interface + PM2, idempotente):
   ```bash
   npm run deploy   # = npm run build + pm2 startOrReload ecosystem.config.cjs + pm2 save
   ```
   Sobe um processo PM2: `controle-acervo` (3015). A interface fica em `/`.
3. Auto-start no boot: `pm2 startup` (uma vez, como admin) + `pm2 save`.

O banco precisa estar na versao **1.5.0**. O server recusa subir com banco abaixo do `MIN_DATABASE_VERSION` (`semver.lt`), e aceita banco a frente. Migracoes em `migrations/`, aplicadas em ordem de data.

## Desenvolvimento (local)

Banco `sca` e auth em `localhost`:
```bash
cd /d/desenvolvimento/servico_autenticacao/server && node dist/index.js   # auth 3010
cd /d/desenvolvimento/controle_acervo/server && npm run dev               # SCA 3015
cd /d/desenvolvimento/controle_acervo && npm run dev-client               # interface 3003
```

Para trabalhar contra o banco e o auth de **producao** a partir da maquina local, aponte `DB_*` e `AUTH_SERVER` do `config.env` para producao. Vale para ler e depurar; escrever assim mexe em dado real.

## Smoke tests

**Depois de todo deploy, rode a fumaça inteira.** Ela exercita os tres modulos de ponta a ponta, so com leitura, e sai com codigo 1 se algo falhar (serve de portao num script de deploy):

```bash
SCA_URL=http://localhost:3015 SCA_USER=<login> SCA_SENHA=<senha> python scripts/fumaca.py
```

Sao 31 checagens: interface na raiz, login com o catalogo dos tres modulos, dominios e leituras de cada modulo, a consulta publica por localizador (com um pedido REAL, porque com codigo inventado ela mede o 404 e nao a rota), a secao 3 do RPCMTec, os anexos em BYTEA, e as duas colisoes de nome (`/relatorio` e `/arquivo`) que so o prefixo `/api/orcamento/` faz conviver.

Conferencia rapida, sem credencial:
```bash
curl -s http://localhost:3010/api | grep operacional                            # auth (4000 em prod)
curl -s http://localhost:3015/api | grep operacional                            # SCA
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3015/                 # interface
```

Depois de logar, o corpo da resposta de `POST /api/login` traz `perfis` (nivel por modulo) e `modulos` (o catalogo de `dominio.modulo`). Se `modulos` vier vazio, o seletor de modulo nao aparece: o problema esta no banco, nao na tela.

URLs (prod): interface <http://HOST:3015>; Swagger <http://HOST:3015/api/api_docs>.

## Troubleshooting
- **SCA sobe e cai na hora** -> quase sempre o Auth Server fora do ar; confirme o `curl` do auth (3010 dev / 4000 prod).
- **Erro de conexao com banco** -> PostgreSQL parado ou `DB_*` errado no `config.env`.
- **Boot recusado por versao** -> banco abaixo de `MIN_DATABASE_VERSION`; falta aplicar migracao de `migrations/`.
- **Interface em branco / 404 nos assets** -> `base` no `client/vite.config.js` tem que ser `'/'`, e o `build/` precisa ter sido gerado (`npm run build`).
- **Modulo some do seletor** -> a pessoa nao tem linha em `dgeo.usuario_perfil` para aquele modulo, e nao e `administrador`. Conceder e ato explicito, pela tela de usuarios.
- **Rota do orcamento devolve 403 para quem tem perfil** -> a rota pode ter ficado sem o segundo argumento do `verifyPerfil`, e estar cobrando perfil no acervo. O teste `routes/orcamento/modulo_em_toda_rota.test.js` barra isso.
