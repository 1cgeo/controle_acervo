# CLAUDE.md - Controle do Acervo

## Git Rules

- **NEVER create commits automatically.** The user will always review changes and commit manually. Do not run `git add`, `git commit`, or `git push` unless the user explicitly asks for it in that specific message.

## Project Overview

**Controle do Acervo (SCA)** is a geospatial data collection management system built by the Brazilian Army Geographic Service (DSG/1CGEO). It manages versioned geographic products (maps, orthophotos, digital elevation models, etc.), their files, storage volumes, and a physical map library (mapoteca) for order fulfillment.

The system consists of four components:

1. **Server** (`server/`) - Node.js/Express REST API with PostgreSQL/PostGIS
2. **~~Client Dashboard~~** (`client/` → `client_deprecated/`) - **DEPRECATED.** Former React/TypeScript SPA for the main archive dashboard. Will be rebuilt without React or TypeScript.
3. **~~Mapoteca Admin Client~~** (`client_admin_mapoteca/` → `client_admin_mapoteca_deprecated/`) - **DEPRECATED.** Former React/TypeScript SPA for map library administration. Will be rebuilt without React or TypeScript.
4. **QGIS Plugin** (`ferramentas_acervo/`) - Python/PyQt plugin for QGIS 3 desktop integration

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
├── client/                         # Main dashboard (React 18, Vite, TypeScript)
│   └── src/
│       ├── components/             # Shared UI components
│       ├── features/               # Feature modules (auth, dashboard)
│       ├── hooks/                  # Custom React hooks
│       ├── lib/                    # Axios client, React Query, MUI theme
│       ├── routes/                 # Route definitions
│       ├── services/               # API service functions
│       ├── stores/                 # Zustand state stores
│       └── types/                  # TypeScript type definitions
├── client_admin_mapoteca/          # Mapoteca admin (React 19, Vite, TypeScript)
│   └── src/
│       ├── components/             # Shared UI components
│       ├── features/               # Feature modules (auth, clients, orders, materials, plotters, dashboard)
│       ├── hooks/                  # Custom React hooks
│       ├── lib/                    # Axios client, React Query, MUI theme
│       ├── routes/                 # Route definitions
│       ├── services/               # API service functions
│       ├── stores/                 # Zustand state stores
│       └── types/                  # TypeScript type definitions
├── ferramentas_acervo/             # QGIS 3 Plugin (Python/PyQt)
│   ├── main.py                     # Plugin entry point
│   ├── core/                       # API client, settings, file transfer
│   └── gui/                        # Dialog windows (one folder per feature)
├── er/                             # Database SQL schema definitions
│   ├── versao.sql                  # DB version tracking
│   ├── dominio.sql                 # Domain/lookup tables
│   ├── dgeo.sql                    # User schema
│   ├── acervo.sql                  # Main archive schema
│   ├── mapoteca.sql                # Map library schema
│   ├── acompanhamento.sql          # Materialized views
│   └── permissao.sql               # DB permissions
├── create_config.js                # Interactive setup (DB creation, config.env generation)
├── create_build.js                 # Client build script (builds client/ → server/src/build/)
├── package.json                    # Root package with install/config/build/start scripts
└── api_documentation.md            # API documentation
```

## Tech Stack

### Server
- **Runtime**: Node.js >= 16.15 (CommonJS modules)
- **Framework**: Express 4
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

### Client Apps
- **Framework**: React (client: v18, mapoteca: v19)
- **Language**: TypeScript (strict mode)
- **Build Tool**: Vite
- **UI Library**: MUI (Material UI) with Emotion
- **State Management**: Zustand (persisted auth store)
- **Server State**: TanStack React Query
- **Forms**: React Hook Form + Zod validation
- **HTTP Client**: Axios with interceptors
- **Routing**: React Router DOM
- **Charts**: Recharts

### QGIS Plugin
- **Language**: Python 3
- **UI Framework**: PyQt (via QGIS)
- **Min QGIS Version**: 3.0

## Common Commands

### Root Level
```bash
npm run install-all    # Install root + server + client dependencies
npm run config         # Interactive setup: create DB + config.env
npm run build          # Build client and copy to server/src/build/
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

### Client Apps (`client/` or `client_admin_mapoteca/`)
```bash
npm run dev            # Vite dev server on port 3000
npm run build          # TypeScript check + Vite production build
npm run type-check     # TypeScript type checking only (tsc --noEmit)
npm run lint           # ESLint with auto-fix
npm run format         # Prettier formatting
npm run preview        # Preview production build
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

### Vite Proxy
Both client apps proxy `/api` requests to the backend:
- `client/`: proxies to `VITE_API_URL` or `http://localhost:3013`
- `client_admin_mapoteca/`: proxies to `VITE_API_URL` or `http://localhost:3010`

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
5. Client stores token in localStorage with Zustand persisted store

### Error Handling
- `AppError(message, statusCode, errorTrace)` for application errors
- `asyncHandler` wraps all async route handlers to catch rejections
- Global error middleware logs errors and returns standardized JSON
- `errorHandler.critical()` logs and exits process on startup failures

### Client App Architecture
Both React clients follow identical patterns:
- **Feature-based structure**: `features/{name}/routes/` for pages, `features/{name}/components/` for feature-specific components
- **Zustand stores** in `stores/` for auth state (persisted to localStorage)
- **React Query hooks** in `hooks/` for server data
- **Service layer** in `services/` wraps axios API calls
- **Path aliases**: `@/` maps to `src/` (mapoteca client has additional granular aliases like `@components`, `@features`, etc.)

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

### Client (TypeScript)
- Strict TypeScript with `noUnusedLocals` and `noUnusedParameters`
- Functional components only
- Hooks for all state and side effects
- Zod schemas for form validation
- MUI components for all UI elements
- Feature-based directory organization
- Import paths use `@/` alias

### General
- All user-facing strings are in **Portuguese (pt-BR)**
- Database column names use **snake_case** in Portuguese
- JavaScript/TypeScript variables use **camelCase**
- File names use **snake_case** (server) or **PascalCase** for components (client)
- No test suite exists in the project currently
- No Docker configuration exists; deployment uses PM2 directly
- No CI/CD pipeline is configured

## Development Setup

1. Install dependencies: `npm run install-all`
2. Set up PostgreSQL with PostGIS extension
3. Run config: `npm run config` (creates DB and `server/config.env`)
4. Start dev server: `npm run start-dev` (server on configured PORT)
5. Start client dev: `cd client && npm run dev` (Vite on port 3000)
6. Start mapoteca client dev: `cd client_admin_mapoteca && npm run dev` (Vite on port 3000)

## Production Build

1. Build client: `npm run build` (builds `client/` and copies output to `server/src/build/`)
2. Start server: `npm start` (PM2 serves both API and static client files)
3. The Express app serves the built client files via `express.static` with SPA fallback to `index.html`

## Important Notes

- The server requires an external **Auth Server** to be running and accessible
- Minimum Node.js version is **16.15** (checked at startup)
- The database requires **PostGIS** extension
- JWT tokens expire after **1 hour**
- Rate limiting is set to **200 requests per 60 seconds**
- Upload sessions expire after **24 hours** (cleaned hourly by cron)
- Download tokens also expire and are cleaned hourly
- Logging output goes to `server/src/logs/` with 14-day retention
- The `create_build.js` script only builds the main `client/`, not `client_admin_mapoteca/`
