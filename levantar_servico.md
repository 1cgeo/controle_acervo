# Levantar o Controle do Acervo (ambiente de desenvolvimento)

Guia para subir o sistema completo localmente. A ordem importa: o **SCA server aborta o boot** se o Auth Server não estiver operacional (`main.js`: `db → verifyAuthServer → cron → startServer`).

## Componentes e portas

| Componente | Diretório | Porta | Como subir |
|---|---|---|---|
| PostgreSQL + PostGIS | (serviço do SO) | 5432 | precisa estar rodando antes de tudo |
| Auth Server (dependência externa) | `D:\desenvolvimento\servico_autenticacao\server` | 3010 | `node dist/index.js` |
| SCA Server (API REST) | `server` | 3015 | `npm run dev` |
| Acervo Client (dashboard) | `acervo_client` | 3000 | `npm run dev` |
| Mapoteca Client | `mapoteca_client` | 3001 | `npm run dev` |

Bancos: SCA usa `sca`; Auth Server usa `servico_autenticacao` — ambos em `localhost:5432`.

## Pré-checagem

```bash
# Config e dependências existem?
ls server/config.env                      # precisa existir (gerar com: npm run config)
ls server/node_modules acervo_client/node_modules mapoteca_client/node_modules

# Portas livres / dependências de pé? (Windows)
netstat -ano -p TCP | grep LISTENING | grep -E ":(3000|3001|3010|3015|5432) "
```

- `5432` deve estar **LISTENING** (PostgreSQL).
- `3010/3015/3000/3001` devem estar **livres** antes de subir.
- Se a porta `3000` estiver ocupada por outro projeto, o Vite do acervo_client escolhe outra porta automaticamente. Para forçar a 3000, libere-a primeiro:
  ```bash
  PID=$(netstat -ano -p TCP | grep LISTENING | grep ":3000 " | awk '{print $NF}' | head -1)
  taskkill //PID $PID //F //T
  ```

## Sequência de subida

### 1. Auth Server (porta 3010) — primeiro, sempre

```bash
cd /d/desenvolvimento/servico_autenticacao/server
node dist/index.js        # usa o build em dist/; para hot-reload: npm run dev (nodemon)
```

Confirmar que está operacional **antes** de subir o SCA:

```bash
curl -s http://localhost:3010/api
# Esperado: {"success":true,"message":"Serviço de autenticação operacional", ...}
```

### 2. SCA Server (porta 3015)

```bash
cd /d/desenvolvimento/controle_acervo/server
npm run dev               # nodemon (HTTP). HTTPS: npm run dev-https
```

Log de sucesso: `Servidor HTTP do Serviço iniciado ... "port":"3015"`.

### 3. Clients web (portas 3000 e 3001)

```bash
cd /d/desenvolvimento/controle_acervo/acervo_client   && npm run dev   # 3000
cd /d/desenvolvimento/controle_acervo/mapoteca_client && npm run dev   # 3001
```

Ambos os Vite fazem proxy de `/api` para o server na 3015.

## Verificação final (smoke tests)

```bash
# Auth Server
curl -s http://localhost:3010/api | grep operacional

# SCA Server + banco (rota de domínio pública, não exige auth)
curl -s http://localhost:3015/api/gerencia/dominio/tipo_produto | head -c 200

# Clients (devem responder 200)
curl -s -o /dev/null -w "acervo  %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "mapoteca %{http_code}\n" http://localhost:3001/
```

URLs úteis:
- Dashboard do acervo: <http://localhost:3000>
- Client da mapoteca: <http://localhost:3001>
- Swagger da API: <http://localhost:3015/api/api_docs>

## Troubleshooting

- **SCA server sobe e cai na hora** → quase sempre é o Auth Server fora do ar (3010). O boot chama `verifyAuthServer` e, se falhar, `errorHandler.critical` encerra o processo. Suba a 3010 primeiro e confirme com o `curl` acima.
- **Erro de conexão com banco** → PostgreSQL parado ou credenciais erradas em `server/config.env` (`DB_*`). Verifique `5432` LISTENING.
- **Porta ocupada** → identifique e libere com `netstat`/`taskkill` (ver pré-checagem).
- **Auth Server sem `dist/`** → buildar com `npm run build` (tsc) no diretório do auth server, ou rodar `npm run dev`.

## Produção (referência)

- SCA: `npm start` na raiz (PM2: `controle-acervo`) — serve a build estática do acervo_client de `server/src/build` (gerar com `npm run build`).
- Auth Server: `npm start` (PM2: `auth-server`).
