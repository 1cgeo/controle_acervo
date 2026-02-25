# CLAUDE.md - Controle do Acervo

## Git Rules

- **NEVER create commits automatically.** The user will always review changes and commit manually. Do not run `git add`, `git commit`, or `git push` unless the user explicitly asks for it in that specific message.

## Project Overview

**Controle do Acervo (SCA)** is a geospatial data collection management system built by the Brazilian Army Geographic Service (DSG/1CGEO). It manages versioned geographic products (maps, orthophotos, digital elevation models, etc.), their files, storage volumes, and a physical map library (mapoteca) for order fulfillment.

The system consists of two active components:

1. **Server** (`server/`) - Node.js/Express REST API with PostgreSQL/PostGIS
2. **QGIS Plugin** (`ferramentas_acervo/`) - Python/PyQt plugin for QGIS 3 desktop integration

> `client_deprecated/` and `client_admin_mapoteca_deprecated/` contain former React/TypeScript SPAs. They are fully deprecated and should not be modified. New web clients will be built from scratch.

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
│   │   ├── mapoteca/               # Map library CRUD & dashboard
│   │   ├── dashboard/              # Main dashboard endpoints
│   │   └── utils/                  # Shared utilities
│   └── package.json
├── ferramentas_acervo/             # QGIS 3 Plugin (Python/PyQt)
│   ├── main.py                     # Plugin entry point
│   ├── config.py                   # Plugin name and version
│   ├── core/                       # Core modules
│   │   ├── api_client.py           # HTTP client (requests + auto-relogin)
│   │   ├── settings.py             # QgsSettings wrapper
│   │   ├── file_transfer.py        # Threaded file copy (Windows) / SMB (Linux)
│   │   ├── authSMB.py              # SMB auth dialog for Linux
│   │   └── getFileBySMB.py         # SMB file retrieval script
│   └── gui/                        # Dialog windows (one folder per feature)
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
├── er/                             # Database SQL schema definitions
│   ├── versao.sql                  # DB version tracking
│   ├── dominio.sql                 # Domain/lookup tables
│   ├── dgeo.sql                    # User schema
│   ├── acervo.sql                  # Main archive schema
│   ├── mapoteca.sql                # Map library schema
│   ├── acompanhamento.sql          # Materialized views
│   └── permissao.sql               # DB permissions
├── create_config.js                # Interactive setup (DB creation, config.env generation)
├── create_build.js                 # Client build script (currently no active client)
├── package.json                    # Root package with install/config/build/start scripts
└── api_documentation.md            # API documentation
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

### QGIS Plugin
- **Language**: Python 3
- **UI Framework**: PyQt (via QGIS)
- **HTTP Client**: requests (with auto-relogin on 401)
- **File Transfer**: Native copy (Windows), SMB via subprocess (Linux)
- **Settings**: QgsSettings (persisted per QGIS profile)
- **Min QGIS Version**: 3.0

## Common Commands

### Root Level
```bash
npm run install-all    # Install root + server dependencies
npm run config         # Interactive setup: create DB + config.env
npm start              # Start production server via PM2
npm run start-dev      # Start dev server (server only, via nodemon)
```

### Server (`server/`)
```bash
npm run dev            # Start with nodemon (HTTP)
npm run dev-https      # Start with nodemon (HTTPS)
npm run production     # Start via PM2 (HTTP)
npm run production-https  # Start via PM2 (HTTPS)
```

## Configuration

### Environment Variables (server/config.env)
```
PORT=3015              # Server port
DB_SERVER=localhost    # PostgreSQL host
DB_PORT=5432           # PostgreSQL port
DB_NAME=sca            # Database name
DB_USER=postgres       # Database user
DB_PASSWORD=***        # Database password
JWT_SECRET=***         # JWT signing secret (auto-generated by config script)
AUTH_SERVER=https://... # External auth server URL
```

Run `npm run config` to create this file interactively, or use CLI flags:
```bash
node create_config.js --db-server localhost --db-port 5432 --db-user postgres ...
```

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

### Error Handling
- `AppError(message, statusCode, errorTrace)` for application errors
- `asyncHandler` wraps all async route handlers to catch rejections
- Global error middleware logs errors and returns standardized JSON
- `errorHandler.critical()` logs and exits process on startup failures

### Plugin Architecture
- **Entry point**: `main.py` → creates `Settings`, `APIClient`, toolbar action
- **Login**: `LoginDialog` authenticates user, sets `api_client.base_url` and token
- **Main panel**: `DockablePanel` renders collapsible menu categories from `PANEL_MAPPING`
- **Dialogs**: Each feature has its own folder under `gui/` with a `.py` dialog and a `.ui` Qt Designer file
- **File transfer**: `FileTransferThread` (QThread) handles file copy with retry, progress signals, and cancellation
- **Settings persistence**: Uses `QgsSettings` under the group `"Controle do Acervo"` (keys: `saved_server`, `saved_user`, `remember_me`, `ignore_proxy`)

### Plugin Menu Categories
| Category | Access | Features |
|---|---|---|
| Funções Gerais | All users | Load layers, product info, download, search, settings |
| Funções de Administrador | Admin | Add product, load products, load systematic files |
| Administração Avançada | Admin | Manage volumes, volume-type associations, projects, batches, users |
| Operações em Lote | Admin | Batch create/load products, versions, files, relationships |
| Diagnóstico e Manutenção | Admin | Consistency checks, materialized views, cleanup, problem uploads |

## Database

### Schemas
- **acervo**: Main archive tables (projeto, lote, produto, versao, arquivo, download, upload sessions)
- **dominio**: Lookup/reference tables (tipo_produto, tipo_escala, tipo_arquivo, etc.)
- **dgeo**: User management (usuario table)
- **mapoteca**: Map library (cliente, pedido, produto_pedido, plotter, estoque_material, etc.)
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

### Materialized Views
Dynamically created views `mv_produto_{type}_{scale}` aggregate product/version/file data. Refreshed via:
- `POST /api/acervo/refresh_materialized_views` (admin)
- `POST /api/acervo/create_materialized_views` (admin)

### Schema Changes
SQL schema files are in `er/`. Execution order for fresh install:
1. `versao.sql` → 2. `dominio.sql` → 3. `dgeo.sql` → 4. `acervo.sql` → 5. `acompanhamento.sql` → 6. `mapoteca.sql` → 7. `permissao.sql`

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
| `/api/mapoteca` | mapoteca | Map library: clients, orders, plotters, materials |
| `/api/mapoteca/dashboard` | dashboard | Map library dashboard analytics |

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
- No test suite exists in the project currently
- No Docker configuration exists; deployment uses PM2 directly
- No CI/CD pipeline is configured

## Development Setup

1. Install dependencies: `npm run install-all`
2. Set up PostgreSQL with PostGIS extension
3. Run config: `npm run config` (creates DB and `server/config.env`)
4. Start dev server: `npm run start-dev` (server on configured PORT)
5. Install plugin in QGIS: symlink or copy `ferramentas_acervo/` to QGIS plugin directory

## Important Notes

- The server requires an external **Auth Server** to be running and accessible
- Minimum Node.js version is **16.15** (checked at startup)
- The database requires **PostGIS** extension
- JWT tokens expire after **1 hour**
- Rate limiting is set to **200 requests per 60 seconds**
- Upload sessions expire after **24 hours** (cleaned hourly by cron)
- Download tokens also expire and are cleaned hourly
- Logging output goes to `server/src/logs/` with 14-day retention
- The plugin saves credentials in QgsSettings under keys `saved_server`, `saved_user`
- File transfer on Linux requires SMB access configured with valid domain credentials
