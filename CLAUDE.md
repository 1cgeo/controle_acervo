# CLAUDE.md - Controle do Acervo

## Git Rules

- **NEVER create commits automatically.** The user will always review changes and commit manually. Do not run `git add`, `git commit`, or `git push` unless the user explicitly asks for it in that specific message.
- **NEVER commit changes** unless the user explicitly asks in that specific message. Always let the user review first.

## Intentional Design Decisions

- **`/api/integracao/*` routes have no authentication** — This is intentional. They are public, read-only GET endpoints created so the DGEO chief's vault (demand routing + RPCMTec generation) can consume the SCA over HTTP without credentials, consistent with the intranet posture. They expose only acervo coverage, products finalized in a month (by `acervo.versao.data_edicao`, not registration date), and the mapoteca aggregate strictly required by the RPCMTec (no client address/contact/print observations). See `server/src/integracao/` and `api_documentation.md` section 21.
- **`/logs` endpoint has no authentication** — This is intentional. The system runs on an internal local network (intranet), so unauthenticated log access is acceptable.
- **CORS allows all origins** — This is intentional. The system runs on an internal local network, so open CORS is acceptable.
- **DB credentials in QGIS layer URIs** — This is intentional. The plugin connects directly to PostgreSQL to load layers, exposing credentials in the layer URI. Acceptable for an internal network application.
- **Mapoteca uses `usuario_id` (INTEGER) while Acervo uses `usuario_uuid` (UUID)** — This is intentional. The `dgeo.usuario` table has both `id` (INTEGER PK) and `uuid` (UUID UNIQUE). The `mapoteca` schema references `usuario.id` and the `acervo` schema references `usuario.uuid`. Both are valid foreign key references to the same user. New tables should follow the `acervo` convention (UUID) for consistency.
- **Client web (`acervo_client/`) nao inclui dados de Mapoteca** — A Mapoteca tem seu proprio cliente web separado em `mapoteca_client/` (vanilla JS + Vite, porta dev 3001). O dashboard em `acervo_client/` exibe apenas dados do acervo (produtos, versoes, arquivos, projetos, volumes, usuarios).

## Business Rules

### Mapoteca - Material Consumption
- **Consumo de material** can only occur from the **Seção** location (`tipo_localizacao` code=1). Materials must first be transferred to Seção before they can be consumed.
- Location types: 1=Seção, 2=Almoxarifado, 3=Aquisição realizada, 4=Saldo no empenho.

## Project Overview

**Controle do Acervo (SCA)** is a geospatial data collection management system built by the Brazilian Army Geographic Service (DSG/1CGEO). It manages versioned geographic products (maps, orthophotos, digital elevation models, etc.), their files, storage volumes, and a physical map library (mapoteca) for order fulfillment.

The system consists of five active components:

1. **Server** (`server/`) - Node.js/Express REST API with PostgreSQL/PostGIS
2. **QGIS Plugin** (`ferramentas_acervo/`) - Python/PyQt plugin for QGIS 4 desktop integration (Qt6)
3. **Acervo Client** (`acervo_client/`) - Vanilla JS SPA with Vite (admin dashboard)
4. **Mapoteca QGIS Plugin** (`ferramentas_mapoteca/`) - Python/PyQt plugin for QGIS 4 (Qt6): active orders, PDF download for printing, and per-item print quantity tracking (`mapoteca.impressao_item` history — multiple operators can resume work)
5. **Mapoteca Client** (`mapoteca_client/`) - Vanilla JS SPA with Vite (port 3001): mapoteca dashboard (operational — incl. tempo de atendimento, clientes mais ativos, consumo de material e status dos plotters — + annual with CSV export), clients, orders (4-step wizard with acervo catalog search; print-record corrections via histórico de impressão), materials/stock/consumption, plotters, annual reports page (`#/relatorios` — abas Mil/Detalhado/Civ/Temáticos with CSV export), and public order lookup by localizador

> A former React/TypeScript SPA (`client_admin_mapoteca_deprecated/`) existed for Mapoteca administration and has been **fully removed** from the repo. The Mapoteca's dedicated web client lives in `mapoteca_client/` as a vanilla JS + Vite SPA (sibling to the `acervo_client/` dashboard). Do not recreate the React one.

External dependency: [Auth Server](https://github.com/1cgeo/auth_server) for user authentication.

## Repository Structure

```
controle_acervo/
├── server/                         # Express REST API (Node.js, CommonJS)
│   ├── src/
│   │   ├── index.js                # Entry point (Node.js version check)
│   │   ├── main.js                 # Boot sequence: DB → auth verify → cron → start
│   │   ├── config.js               # Env config with Joi validation
│   │   ├── routes.js               # Route aggregator
│   │   ├── server/                 # Express app, startup, Swagger
│   │   ├── database/               # pg-promise connection, version check, view refresh
│   │   ├── authentication/         # Auth server integration
│   │   ├── login/                  # JWT auth, token validation, middleware
│   │   ├── acervo/                 # Archive/collection endpoints
│   │   ├── arquivo/                # File upload/download management
│   │   ├── produto/                # Product CRUD
│   │   ├── projeto/                # Project/batch management
│   │   ├── volume/                 # Storage volume management
│   │   ├── usuario/                # User management
│   │   ├── gerencia/               # Domain data & admin operations
│   │   ├── mapoteca/               # Map library: CRUD, dashboard, relatórios CSV (query_fragments/relatorio_ctrl) e controle de impressão
│   │   ├── dashboard/              # Main (acervo) dashboard endpoints
│   │   ├── integracao/             # Public read-only routes for the DGEO vault (acervo coverage + RPCMTec)
│   │   ├── utils/                  # Shared utilities (domain_constants, csv_export, error handling, logging, cleanup jobs, generate_localizador, http_client, schema_validation, send_json_and_log, serialize_error_loader, async_handler, async_handler_with_queue)
│   │   └── __tests__/              # Jest test suite (unit, integration, routes) + helpers
│   └── package.json
├── ferramentas_acervo/             # QGIS 4 Plugin (Python/PyQt, Qt6)
│   ├── main.py                     # Plugin entry point
│   ├── config.py                   # Plugin name and version
│   ├── metadata.txt                # QGIS plugin manifest (qgisMinimumVersion=4.0, supportsQt6=True)
│   ├── icons/                      # Plugin icons (icon.png, config.png, DSG.svg)
│   ├── core/                       # Core modules
│   │   ├── api_client.py           # HTTP client (requests + auto-relogin)
│   │   ├── settings.py             # QgsSettings wrapper
│   │   ├── file_transfer.py        # Threaded file copy (Windows) / SMB (Linux)
│   │   ├── authSMB.py              # SMB auth dialog for Linux
│   │   ├── getFileBySMB.py         # SMB file retrieval script
│   │   └── ui/                     # Qt Designer forms for core dialogs (authSMB.ui)
│   └── gui/                        # Dialog windows (one folder per feature)
│       ├── ui/                     # Shared Qt Designer forms (dockable_panel.ui, login.ui)
│       ├── panel.py                # PANEL_MAPPING — menu categories and dialog registry
│       ├── dockable_panel.py       # Main dockable panel with collapsible menu
│       ├── login_dialog.py         # Login dialog with saved credentials
│       ├── configuracoes/          # Plugin settings dialog
│       ├── usuarios/               # User management (import, sync, admin/ativo flags)
│       ├── volumes/                # Storage volume CRUD
│       ├── volume_tipo_produto/    # Volume ↔ Product Type association
│       ├── projetos/               # Project CRUD
│       ├── lotes/                  # Batch (lote) CRUD
│       ├── carregar_camadas_produto/ # Load product layers into QGIS
│       ├── carregar_produtos/      # Load products into QGIS
│       ├── informacao_produto/     # Product info viewer
│       ├── download_produtos/      # Product file download
│       ├── situacao_geral/         # General status download
│       ├── busca_produtos/         # Product search
│       ├── versao_relacionamento/  # Version relationship viewer
│       ├── adicionar_produto/      # Add single product
│       ├── adicionar_produto_historico/ # Add product with historical version
│       ├── bulk_carrega_arquivos/  # Batch: add files to existing versions
│       ├── bulk_carrega_produtos_versoes_arquivos/ # Batch: add complete products
│       ├── bulk_carrega_versoes_arquivos/ # Batch: add versions to products
│       ├── bulk_produtos/          # Batch: create products (no files)
│       ├── bulk_produtos_versoes_historicas/ # Batch: add historical products
│       ├── bulk_versoes_historicas/ # Batch: add historical versions
│       ├── bulk_versao_relacionamento/ # Batch: create version relationships
│       ├── materialized_views/     # Create/refresh materialized views
│       ├── verificar_inconsistencias/ # Consistency checks
│       ├── arquivos_incorretos/    # Manage incorrect files
│       ├── arquivos_deletados/     # Manage deleted files
│       ├── downloads_deletados/    # Manage deleted downloads
│       ├── limpeza_downloads/      # Cleanup expired downloads
│       ├── problem_uploads/        # View problem uploads
│       └── upload_sessions/        # Manage upload sessions
├── ferramentas_mapoteca/           # QGIS 4 Plugin da Mapoteca (Python/PyQt, Qt6)
│   ├── main.py                     # Plugin entry point (login → diálogo de pedidos)
│   ├── config.py                   # Nome e versão (grupo QgsSettings próprio)
│   ├── metadata.txt                # Manifest QGIS (qgisMinimumVersion=4.0, supportsQt6=True)
│   ├── icons/                      # Ícones
│   ├── core/                       # api_client, settings, file_transfer, SMB (compartilham padrão do plugin do acervo)
│   └── gui/
│       ├── login_dialog.py + ui/   # Login (mesmo fluxo do plugin do acervo)
│       └── pedidos/                # Diálogo principal: pedidos ativos, itens com quantitativos
│           ├── pedidos_dialog.py   #   de impressão, download dos PDFs (manifesto CSV) e
│           ├── impressao_manager.py#   registro/histórico de impressão por item
│           └── registrar_impressao_dialog.py
├── acervo_client/                   # Dashboard SPA do acervo (Vanilla JS + Vite)
│   ├── index.html                   # Entry point
│   ├── vite.config.js               # Vite config (aliases, proxy, code splitting)
│   ├── package.json                 # Dependencies: chart.js, vite
│   ├── public/backgrounds/          # Login page background SVGs
│   └── src/
│       ├── css/                     # Modular CSS with design tokens
│       │   ├── style.css            # Main entry (imports all CSS)
│       │   ├── design-tokens.css    # CSS variables (light + dark theme)
│       │   ├── base.css             # Reset, typography, utilities
│       │   ├── login.css            # Login page
│       │   ├── layout.css           # Navbar, sidebar
│       │   ├── dashboard.css        # Dashboard cards, tabs, grids
│       │   ├── charts.css           # Chart containers
│       │   ├── tables.css           # Data tables, pagination
│       │   └── error-pages.css      # 403/404 pages
│       └── js/
│           ├── index.js             # App entry point (theme, router, layout)
│           ├── router.js            # Hash-based router with auth guards
│           ├── store/auth-store.js  # Auth state via localStorage
│           ├── services/            # API client, cache, dashboard service
│           ├── utils/               # DOM helpers, formatting, theme, toast
│           ├── pages/               # Login, dashboard, unauthorized, not-found
│           ├── components/          # Reusable: layout, charts, tabs, tables, cards
│           └── features/dashboard/  # 4 dashboard tabs (overview, distribution, activity, advanced)
├── er/                              # Database SQL schema definitions
│   ├── versao.sql                   # DB version tracking
│   ├── dominio.sql                  # Domain/lookup tables
│   ├── dgeo.sql                     # User schema
│   ├── acervo.sql                   # Main archive schema
│   ├── mapoteca.sql                 # Map library schema
│   ├── acompanhamento.sql           # Materialized views
│   ├── permissao.sql                # DB permissions (main service user)
│   └── permissao_readonly.sql       # Read-only user grants (QGIS layer URIs)
├── mapoteca_client/                 # Vanilla JS + Vite SPA da mapoteca (porta 3001; localStorage @mapoteca-*)
├── create_config.js                 # Interactive setup (DB creation, config.env generation)
├── create_build.js                  # Client build script
├── package.json                     # Root package with install/config/build/start scripts
└── api_documentation.md             # API documentation
```

## Tech Stack

### Server
- **Runtime**: Node.js >= 16.15 (CommonJS modules)
- **Framework**: Express 5
- **Database**: PostgreSQL with PostGIS (via pg-promise)
- **Auth**: JWT (jsonwebtoken), external auth server integration
- **Validation**: Joi
- **Logging**: Winston with daily rotating files
- **API Docs**: Swagger/OpenAPI 3.0 (swagger-jsdoc + swagger-ui-express)
- **Security**: Helmet, HPP, CORS, rate limiting (200 req/60s), nocache
- **Scheduling**: node-cron (hourly cleanup jobs)
- **Process Manager**: PM2 (production)
- **Dev Server**: Nodemon
- **Linting**: StandardJS (devDependency)

### Acervo Client (Dashboard SPA)
- **Language**: Vanilla JavaScript (ES modules, no TypeScript)
- **Build Tool**: Vite 6
- **Charts**: Chart.js 4
- **Routing**: Hash-based custom router (#/login, #/dashboard)
- **State**: localStorage (auth tokens, theme preference)
- **Data Caching**: Custom TTL cache (1-minute stale time)
- **Styling**: Modular CSS with design tokens, BEM naming, dark/light theme via CSS variables
- **Icons**: Inline SVG (Material Design paths)
- **Auth**: JWT in localStorage, auto-logout on 401/403

### QGIS Plugin
- **Language**: Python 3
- **UI Framework**: PyQt6 (via QGIS 4)
- **HTTP Client**: requests (with auto-relogin on 401, optional system-proxy bypass)
- **File Transfer**: Native copy (Windows), SMB via subprocess (Linux)
- **Settings**: QgsSettings (persisted per QGIS profile)
- **Min QGIS Version**: 4.0 (Qt6) — declared in `metadata.txt` (`qgisMinimumVersion=4.0`, `supportsQt6=True`). The `qgis4` branch is the active migration from the legacy Qt5/QGIS 3 baseline.

## Common Commands

### Root Level
```bash
npm run install-all       # Install root + server + acervo_client + mapoteca_client dependencies
npm run install-mapoteca  # Install mapoteca_client dependencies only
npm run config            # Interactive setup: create DB + config.env
npm run build             # Build acervo_client/ and copy to server/src/build
npm run build-mapoteca    # Build mapoteca_client/
npm run dev-mapoteca      # Start mapoteca client dev server (port 3001)
npm start                 # Start production server via PM2
npm run start-dev         # Start dev server (server only, via nodemon)
```

### Server (`server/`)
```bash
npm run dev                 # Start with nodemon (HTTP)
npm run dev-https           # Start with nodemon (HTTPS)
npm run production          # Start via PM2 (HTTP)
npm run production-https    # Start via PM2 (HTTPS)
npm test                    # Run full Jest suite (--runInBand)
npm run test:unit           # Unit tests only (schemas, utils)
npm run test:integration    # Integration tests (require a running/test DB)
npm run test:routes         # Route-level tests (supertest)
npm run test:coverage       # Full suite with coverage report
```

### Acervo Client (`acervo_client/`)
```bash
npm run dev            # Start Vite dev server (port 3000, proxies /api to server)
npm run build          # Production build to dist/
npm run preview        # Preview production build
```

### Mapoteca Client (`mapoteca_client/`)
```bash
npm run dev            # Start Vite dev server (port 3001, proxies /api to server)
npm run build          # Production build to dist/
npm run preview        # Preview production build
npm run lint           # ESLint (--max-warnings 0)
```
Conventions specific to this SPA: localStorage prefix `@mapoteca-*` (distinct from the acervo client), same page/component contract as `acervo_client/`.

## Configuration

### Environment Variables (server/config.env)
```
PORT=3015              # Server port
DB_SERVER=localhost    # PostgreSQL host
DB_PORT=5432           # PostgreSQL port
DB_NAME=sca            # Database name
DB_USER=postgres       # Database user
DB_PASSWORD=***        # Database password
DB_USER_READONLY=***   # Read-only DB user for QGIS layer URIs (optional; falls back to DB_USER)
DB_PASSWORD_READONLY=*** # Read-only DB user password (optional)
JWT_SECRET=***         # JWT signing secret (auto-generated by config script)
AUTH_SERVER=https://... # External auth server URL
USE_PROXY=false        # Use system proxy for HTTP connections
```

Run `npm run config` to create this file interactively, or use CLI flags:
```bash
node create_config.js --db-server localhost --db-port 5432 --db-user postgres ...
```

The config script can also create a read-only PostgreSQL user (`--db-user-readonly` / `--db-password-readonly`, or interactively). Its grants live in `er/permissao_readonly.sql` (SELECT on `acervo`, `dominio` and `public` only — no `dgeo`/`mapoteca`; default privileges cover materialized views created at runtime). The server embeds these credentials in QGIS layer URIs instead of the main `DB_USER`.

## Architecture Patterns

### Server Module Structure
Each API domain follows a consistent 4-file pattern:
```
module_name/
├── index.js              # Re-exports route
├── module_name_ctrl.js   # Controller: business logic, DB queries
├── module_name_route.js  # Route definitions with middleware chain
└── module_name_schema.js # Joi validation schemas
```

### Route Handler Pattern
```javascript
router.post(
  '/endpoint',
  verifyAdmin,                          // Auth middleware
  schemaValidation({ body: schema }),   // Joi validation
  asyncHandler(async (req, res, next) => {
    const result = await ctrl.someMethod(req.body)
    return res.sendJsonAndLog(true, 'Message', httpCode.OK, result)
  })
)
```

### Standard JSON Response Format
All API responses use `res.sendJsonAndLog()`:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Description",
  "dados": { ... },
  "error": null
}
```

### Authentication Flow
1. `POST /api/login` validates credentials against external auth server
2. Returns JWT token (1-hour expiry) with `administrador` flag and `uuid`
3. Protected routes use `verifyLogin` middleware (extracts `req.usuarioUuid`, `req.usuarioId`, `req.administrador`)
4. Admin routes use `verifyAdmin` middleware (re-checks admin status in DB)
5. Plugin stores token in memory; re-authenticates silently on 401 using saved credentials

### Domain Constants
Server uses `server/src/utils/domain_constants.js` to centralize all domain table code values (STATUS_ARQUIVO, TIPO_ARQUIVO, TIPO_VERSAO, TIPO_ESCALA, SITUACAO_CARREGAMENTO, SUBTIPO_PRODUTO, TIPO_PRODUTO, TIPO_CLIENTE, SITUACAO_PEDIDO, TIPO_MIDIA, FORMA_ENTREGA, TIPO_LOCALIZACAO, TIPO_RELACIONAMENTO). Always use these constants instead of magic numbers in SQL queries. Values mirror `er/dominio.sql` and `er/mapoteca.sql` seed data.

### Error Handling
- `AppError(message, statusCode, errorTrace)` for application errors
- `asyncHandler` wraps all async route handlers to catch rejections
- Global error middleware logs errors and returns standardized JSON
- `errorHandler.critical()` logs and exits process on startup failures
- `serialize-error` v13 is ESM-only; loaded via `serialize_error_loader.js` with sync fallback

### Plugin Architecture
- **Entry point**: `main.py` → creates `Settings`, `APIClient`, toolbar action
- **Login**: `LoginDialog` authenticates user, sets `api_client.base_url` and token
- **Main panel**: `DockablePanel` renders collapsible menu categories from `PANEL_MAPPING`
- **Dialogs**: Each feature has its own folder under `gui/` with a `.py` dialog and a `.ui` Qt Designer file
- **File transfer**: `FileTransferThread` (QThread) handles file copy with retry, progress signals, and cancellation
- **Settings persistence**: Uses `QgsSettings` under the group `"Controle do Acervo"` (keys: `saved_server`, `saved_username`, `saved_password` — gravada apenas com "lembrar" marcado —, `remember_me`, `ignore_proxy`). O plugin da mapoteca usa o grupo próprio `"Mapoteca - Controle do Acervo"` com as mesmas chaves

### Plugin Menu Categories
| Category | Access | Features |
|---|---|---|
| Funções Gerais | All users | Load layers, product info, download, search, version relationships, settings |
| Funções de Administrador | Admin | Add product, add historical product, load products |
| Administração Avançada | Admin | Manage volumes, volume-type associations, projects, batches, users |
| Operações em Lote | Admin | Batch add files/products/versions, create products, historical versions, version relationships |
| Diagnóstico e Manutenção | Admin | Consistency checks, materialized views, cleanup, incorrect/deleted files, problem uploads, upload sessions, deleted downloads |

## Database

### Schemas
- **acervo**: Main archive tables (projeto, lote, produto, versao, arquivo, download, upload sessions)
- **dominio**: Lookup/reference tables (tipo_produto, tipo_escala, tipo_arquivo, etc.)
- **dgeo**: User management (usuario table)
- **mapoteca**: Map library (cliente, pedido, produto_pedido, impressao_item, plotter, estoque_material, etc.)
- **public**: DB version tracking and QGIS layer styles

### Key Tables and Relationships
```
projeto (1) → (N) lote → (N) versao → (N) arquivo
                              ↓
                          produto (1)
```

- **produto**: Geographic product with PostGIS geometry (POLYGON, EPSG:4674)
- **versao**: Versioned edition of a product (JSONB metadado, version format validation via trigger)
- **arquivo**: Physical files with checksums, storage volume references, and loading status
- **download/upload**: Token-based transfer management with auto-expiring sessions

### Database Constraints and Triggers
- **Temporal validations**: `projeto.data_fim >= data_inicio`, `lote.data_fim >= data_inicio`, `pedido.data_atendimento >= data_pedido`
- **Uniqueness**: `lote(projeto_id, pit)`, `volume_armazenamento.volume`, `estoque_material(tipo_material_id, localizacao_id)`, `versao_relacionamento(versao_id_1, versao_id_2, tipo_relacionamento_id)`
- **Self-reference prevention**: `versao_relacionamento.versao_id_1 != versao_id_2`
- **Inventory constraints**: `estoque_material.quantidade >= 0`, `consumo_material.quantidade > 0`
- **Consumo triggers**: INSERT/UPDATE/DELETE on `consumo_material` automatically synchronize `estoque_material` quantities in Seção (localizacao_id=1). The trigger enforces that consumption can only occur when there is sufficient stock in Seção.

### Materialized Views
Dynamically created views `mv_produto_{type}_{scale}` aggregate product/version/file data. Refreshed automatically via triggers on `produto`, `versao`, and `arquivo` tables (uses `FOR EACH STATEMENT` with transition tables for batch efficiency). Manual refresh also available via:
- `POST /api/acervo/refresh_materialized_views` (admin)
- `POST /api/acervo/create_materialized_views` (admin)

### Schema Changes
SQL schema files are in `er/`. Execution order for fresh install:
1. `versao.sql` → 2. `dominio.sql` → 3. `dgeo.sql` → 4. `acervo.sql` → 5. `acompanhamento.sql` → 6. `mapoteca.sql` → 7. `permissao.sql` (→ 8. `permissao_readonly.sql`, opcional, se o usuário somente leitura for configurado)

## API Endpoints Summary

All endpoints are under `/api/`. Domain endpoints (`GET /api/gerencia/dominio/*`) require no auth. Most other endpoints require `verifyLogin`. Admin-only endpoints require `verifyAdmin`.

| Route Prefix | Module | Description |
|---|---|---|
| `/api/login` | login | Authentication |
| `/api/acervo` | acervo | Archive operations, downloads, materialized views |
| `/api/arquivo` | arquivo | File upload/download management |
| `/api/produtos` | produto | Product and version CRUD |
| `/api/projetos` | projeto | Project and batch management |
| `/api/volumes` | volume | Storage volume configuration |
| `/api/usuarios` | usuario | User management (admin) |
| `/api/gerencia` | gerencia | Domain data, deleted files, inconsistency checks |
| `/api/dashboard` | dashboard | Acervo dashboard analytics (consumed by `acervo_client/`) |
| `/api/mapoteca` | mapoteca | Map library: clients, orders, plotters, materials, relatórios anuais (CSV) e controle de impressão (plugin QGIS) |
| `/api/mapoteca/dashboard` | mapoteca/dashboard | Map library dashboard analytics |
| `/api/integracao` | integracao | Public read-only routes for the DGEO vault: acervo coverage, products finalized in a month (by `data_edicao`), mapoteca deliveries (RPCMTec). No auth (intranet) |

Note: `/api/mapoteca/dashboard` is mounted before `/api/mapoteca` in `routes.js` so Express matches the more specific prefix first. Preserve that ordering when adding new routes.

Swagger docs available at `GET /api/api_docs` when server is running.

## Coding Conventions

### Server (JavaScript - CommonJS)
- Use `'use strict'` in all files
- StandardJS linting style (no semicolons at line ends is standard, but this project uses semicolons inconsistently - follow the pattern of the file being edited)
- Controller methods use `db.conn.task()` or `db.conn.tx()` for database operations
- All queries use parameterized SQL (pg-promise named parameters `$<param>`)
- Error messages and UI strings are in Portuguese (Brazilian)
- Module exports via `module.exports` pattern
- Each module has an `index.js` that re-exports

### Client (JavaScript - ESM)
- Vanilla JS with ES modules (`import`/`export`), no framework
- DOM manipulation via `el()` helper from `utils/dom.js`
- BEM CSS naming (`.block__element--modifier`)
- CSS variables for theming (light/dark via `[data-theme]` attribute)
- Design tokens in `design-tokens.css` for all colors, spacing, shadows
- Hash-based routing (`#/login`, `#/dashboard`)
- Auth state in `localStorage` (token, expiry, role, uuid)
- API calls via `fetch` wrapper in `services/api-client.js` (auto-logout on 401/403)
- Data caching via `services/cache.js` (TTL-based Map)
- Chart.js wrappers in `components/charts/` (bar-chart.js, pie-chart.js)
- Components expose `.update()` method for reactive updates
- Components expose `._cleanup()` method for resource disposal (chart instances, event listeners)
- Each page function receives a container element and optionally returns a cleanup function
- Vite aliases: `@js/`, `@css/`, `@utils/`, `@components/`, `@pages/`, `@services/`, `@store/`, `@features/`

### Plugin (Python)
- Each GUI feature lives in its own folder under `gui/` with a dialog `.py` and a `.ui` file
- Dialogs inherit from `QDialog` and use `uic.loadUiType()` to load the `.ui` form
- API calls go through `self.api_client.get/post/put/delete(endpoint, data)`
- Settings are accessed via `self.settings.get(key)` / `self.settings.set(key, value)`
- File transfer is handled by `FileTransferThread` (QThread with progress signals)
- All user-facing strings are in Portuguese (pt-BR)

### General
- All user-facing strings are in **Portuguese (pt-BR)**
- Database column names use **snake_case** in Portuguese
- JavaScript variables use **camelCase**
- Python variables use **snake_case**
- File names use **snake_case** (server and plugin)
- Server has a Jest test suite at `server/src/__tests__/` (unit + integration + routes, plus shared helpers). No tests exist for the QGIS plugin or the web client.
- No Docker configuration exists; deployment uses PM2 directly
- No CI/CD pipeline is configured

## Documentation

- `levantar_servico.md` — How to bring up the full dev environment (Auth Server → SCA Server → web clients): startup order, ports, smoke tests, troubleshooting. The SCA server aborts boot if the Auth Server (port 3010) is not operational.
- `tutorial_configuracao_inicial.md` — Step-by-step initial setup guide (plugin, volumes, products)
- `tutorial_client_dashboard.md` — Web dashboard usage guide (login, tabs, charts, theme)
- `fluxos_usuario_plugin.md` — User flows of the QGIS plugin dialogs
- `api_documentation.md` — API endpoint documentation

## Development Setup

1. Install dependencies: `npm run install-all`
2. Set up PostgreSQL with PostGIS extension
3. Run config: `npm run config` (creates DB and `server/config.env`)
4. Start dev server: `npm run start-dev` (server on configured PORT)
5. Start client dev server: `cd acervo_client && npm run dev` (port 3000, proxies /api to server on port 3015 — same default as `npm run config`; adjust the proxy `target` if the server uses another port)
6. Install plugin in QGIS: symlink or copy `ferramentas_acervo/` to QGIS plugin directory

## Important Notes

- The server requires an external **Auth Server** to be running and accessible
- Minimum Node.js version is **16.15** (checked at startup)
- The database requires **PostGIS** extension
- JWT tokens expire after **1 hour**
- Rate limiting is set to **200 requests per 60 seconds**
- Upload sessions expire after **24 hours** (cleaned hourly by cron)
- Download tokens also expire and are cleaned hourly
- Logging output goes to `server/src/logs/` with 14-day retention
- The plugin saves credentials in QgsSettings under keys `saved_server`, `saved_username`, `saved_password` (see Plugin Architecture section)
- File transfer on Linux requires SMB access configured with valid domain credentials
