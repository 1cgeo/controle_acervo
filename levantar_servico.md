# Levantar o Controle do Acervo (SCA)

O SCA server **aborta o boot se o Auth Server nao estiver operacional** (`main.js`: `db -> verifyAuthServer -> cron -> startServer`). Suba o auth antes.

## Componentes e portas

| Componente | Porta | Observacao |
|---|---|---|
| PostgreSQL + PostGIS | 5432 (dev) / 5434 (prod) | banco `sca` |
| Auth Server | 3010 (dev) / 4000 (prod) | dependencia; subir primeiro |
| SCA server | 3015 | API REST + dashboard do acervo (`/`) + client da mapoteca (`/mapoteca`) |

Em **producao** o server serve os dois clients (mesma origem, sem proxy nem porta extra): `npm run build` builda o `acervo_client` para `server/src/build` (servido em `/`) e o `mapoteca_client` para `server/src/build/mapoteca` (servido em `/mapoteca`, com `base: '/mapoteca/'` no vite.config). As chamadas de API dos dois sao `/api/...` na mesma origem.

## Producao (rede da DGEO)

Banco `sca` em `10.25.163.12:5434`; auth em `http://10.25.163.7:4000`; clientes `sca_web`/`sca_qgis`. Arquivos no share `\\10.25.163.8\sca\sca_acervo` (referenciado em `acervo.volume_armazenamento`, no banco).

1. `server/config.env`: `DB_*` do banco de producao, `DB_USER_READONLY=sca_readonly`, `AUTH_SERVER=http://10.25.163.7:4000`, `USE_PROXY=false`. (Role `sca_readonly` precisa existir no banco.)
2. Deploy (build dos dois clients + PM2, idempotente):
   ```bash
   npm run deploy   # = npm run build (acervo + mapoteca) + pm2 startOrReload ecosystem.config.cjs + pm2 save
   ```
   Sobe um processo PM2: `controle-acervo` (3015). Dashboard em `/`, mapoteca em `/mapoteca`.
3. Auto-start no boot: `pm2 startup` (uma vez, como admin) + `pm2 save`.

## Desenvolvimento (local)

Banco `sca` e auth em `localhost`. Os clients rodam em servidores Vite separados (com proxy `/api` -> 3015):
```bash
cd /d/desenvolvimento/servico_autenticacao/server && node dist/index.js   # auth 3010
cd /d/desenvolvimento/controle_acervo/server && npm run dev               # SCA 3015
cd ../acervo_client && npm run dev      # dashboard 3000
cd ../mapoteca_client && npm run dev    # mapoteca 3001
```

## Smoke tests
```bash
curl -s http://localhost:3010/api | grep operacional                            # auth (4000 em prod)
curl -s http://localhost:3015/api | grep operacional                            # SCA
curl -s http://localhost:3015/api/gerencia/dominio/tipo_produto | head -c 120   # SCA + banco
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3015/                 # dashboard acervo
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3015/mapoteca/        # mapoteca (prod)
```
URLs (prod): dashboard <http://HOST:3015>; mapoteca <http://HOST:3015/mapoteca>; Swagger <http://HOST:3015/api/api_docs>.

## Troubleshooting
- **SCA sobe e cai na hora** -> quase sempre o Auth Server fora do ar; confirme o `curl` do auth (3010 dev / 4000 prod).
- **Erro de conexao com banco** -> PostgreSQL parado ou `DB_*` errado no `config.env`.
- **mapoteca em branco / 404 nos assets** -> faltou `base: '/mapoteca/'` no `mapoteca_client/vite.config.js` ou o `build/mapoteca` nao foi gerado (`npm run build`); o mount `/mapoteca` no `app.js` vem antes do static do acervo.
