# Controle do Acervo (SCA)

Sistema de gerenciamento de dados geoespaciais produzidos pelo Serviço Geográfico do Exército Brasileiro (DSG/1CGEO). Gerencia produtos geográficos versionados (cartas, ortoimagens, modelos digitais de elevação, etc.), seus arquivos, volumes de armazenamento e uma mapoteca física para atendimento de pedidos.

Para sua utilização é necessária a utilização do [Serviço de Autenticação](https://github.com/1cgeo/auth_server).

## Componentes

| Componente | Diretório | Tecnologia | Descrição |
|---|---|---|---|
| **Server** | `server/` | Node.js / Express 5 | API REST com PostgreSQL/PostGIS |
| **Plugin QGIS** | `ferramentas_acervo/` | Python / PyQt | Plugin para QGIS 3 |
| **Client Dashboard** | `client/` | React / TypeScript | SPA do painel principal |
| **Mapoteca Admin** | `client_admin_mapoteca/` | React / TypeScript | SPA de administração da mapoteca |

---

## Server (API REST)

### Requisitos

- Node.js >= 16.15
- PostgreSQL com extensão PostGIS
- [Serviço de Autenticação](https://github.com/1cgeo/auth_server) em execução

### Instalação

```bash
# Instalar dependências de todos os componentes
npm run install-all

# Configuração interativa (cria banco de dados e config.env)
npm run config

# Ou via flags de linha de comando
node create_config.js --db-server localhost --db-port 5432 --db-user postgres --db-password <senha> --db-name sca --auth-server https://<auth_server_url>
```

### Execução

```bash
# Desenvolvimento (HTTP, com hot-reload via nodemon)
cd server && npm run dev

# Desenvolvimento (HTTPS)
cd server && npm run dev-https

# Produção (HTTP, via PM2)
npm start

# Produção (HTTPS, via PM2)
cd server && npm run production-https
```

### Testes

```bash
cd server

npm test              # Suite completa
npm run test:unit     # Testes unitários
npm run test:integration  # Testes de integração
npm run test:routes   # Testes de rotas
npm run test:coverage # Relatório de cobertura
```

Os testes utilizam `config_testing.env` como arquivo de configuração.

### Variáveis de Ambiente

Arquivo: `server/config.env` (gerado pelo `npm run config`)

| Variável | Tipo | Obrigatória | Descrição |
|---|---|---|---|
| `PORT` | inteiro | Sim | Porta HTTP do servidor |
| `DB_SERVER` | string | Sim | Host do PostgreSQL |
| `DB_PORT` | inteiro | Sim | Porta do PostgreSQL |
| `DB_NAME` | string | Sim | Nome do banco de dados |
| `DB_USER` | string | Sim | Usuário de escrita do banco |
| `DB_PASSWORD` | string | Sim | Senha do usuário de escrita |
| `DB_USER_READONLY` | string | Não | Usuário somente leitura |
| `DB_PASSWORD_READONLY` | string | Não | Senha do usuário somente leitura |
| `JWT_SECRET` | string | Sim | Segredo para assinatura JWT |
| `AUTH_SERVER` | URI | Sim | URL do servidor de autenticação |

### Endpoints da API

Todos os endpoints são servidos sob `/api`. Documentação Swagger disponível em `GET /api/api_docs`.

| Prefixo | Módulo | Descrição |
|---|---|---|
| `/api/login` | login | Autenticação (JWT, expiração: 1h) |
| `/api/acervo` | acervo | Operações do acervo, downloads, visões materializadas |
| `/api/arquivo` | arquivo | Gerenciamento de upload/download de arquivos |
| `/api/produtos` | produto | CRUD de produtos e versões |
| `/api/projetos` | projeto | Gerenciamento de projetos e lotes |
| `/api/volumes` | volume | Configuração de volumes de armazenamento |
| `/api/usuarios` | usuario | Gerenciamento de usuários (admin) |
| `/api/gerencia` | gerencia | Dados de domínio, verificação de inconsistências |
| `/api/mapoteca` | mapoteca | CRUD da mapoteca |
| `/api/mapoteca/dashboard` | dashboard | Analytics da mapoteca |

**Formato padrão de resposta:**

```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Mensagem descritiva",
  "dados": { },
  "error": null
}
```

### Segurança

- Rate limiting: 200 requisições por 60 segundos por IP
- Proteção contra HTTP Parameter Pollution (HPP)
- CORS habilitado
- Cache desabilitado (no-cache)
- Tokens JWT com expiração de 1 hora

### Jobs Agendados

Um cron job roda a cada hora para:
- Limpar tokens de download expirados
- Limpar sessões de upload expiradas

### Estrutura do Servidor

```
server/src/
├── index.js              # Entry point (verifica versão do Node.js)
├── main.js               # Sequência de boot: DB → auth → cron → start
├── config.js             # Configuração com validação Joi
├── routes.js             # Agregador de rotas
├── server/               # App Express, Swagger
├── database/             # Conexão pg-promise, verificação de versão
├── authentication/       # Integração com servidor de autenticação
├── login/                # Middleware JWT
├── acervo/               # Endpoints do acervo
├── arquivo/              # Upload/download de arquivos
├── produto/              # CRUD de produtos
├── projeto/              # Projetos e lotes
├── volume/               # Volumes de armazenamento
├── usuario/              # Gerenciamento de usuários
├── gerencia/             # Dados de domínio e operações admin
├── mapoteca/             # CRUD da mapoteca
├── dashboard/            # Dashboard da mapoteca
└── utils/                # Utilitários compartilhados
```

Cada módulo segue o padrão de 4 arquivos:

```
modulo/
├── index.js              # Re-exporta a rota
├── modulo_ctrl.js        # Controller: lógica de negócio, queries SQL
├── modulo_route.js       # Definições de rotas com middleware
└── modulo_schema.js      # Schemas de validação Joi
```

### Banco de Dados

Schemas SQL em `er/`, executados nesta ordem para instalação limpa:

1. `versao.sql` — Versionamento do banco
2. `dominio.sql` — Tabelas de domínio/lookup
3. `dgeo.sql` — Schema de usuários
4. `acervo.sql` — Schema principal do acervo
5. `acompanhamento.sql` — Visões materializadas
6. `mapoteca.sql` — Schema da mapoteca
7. `permissao.sql` — Permissões do banco

**Modelo de dados principal:**

```
projeto (1) → (N) lote → (N) versao → (N) arquivo
                              ↓
                          produto (1)
```

- **produto**: produto geográfico com geometria PostGIS (POLYGON, EPSG:4674)
- **versao**: edição versionada de um produto (metadados JSONB)
- **arquivo**: arquivos físicos com checksums e referência a volumes

---

## Plugin QGIS

### Requisitos

- QGIS >= 3.0
- Servidor SCA em execução

### Instalação

Copie a pasta `ferramentas_acervo/` para o diretório de plugins do QGIS:

| SO | Diretório |
|---|---|
| Windows | `%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\` |
| Linux | `~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/` |
| macOS | `~/Library/Application Support/QGIS/QGIS3/profiles/default/python/plugins/` |

### Desenvolvimento

Scripts de setup criam symlinks para desenvolvimento live:

```bash
# Windows (executar como administrador)
ferramentas_acervo/.dev/setup_dev_windows.bat

# Linux
ferramentas_acervo/.dev/setup_dev_linux.sh

# macOS
ferramentas_acervo/.dev/setup_dev_macos.sh
```

### Autenticação

1. Ao abrir o plugin, o diálogo de login solicita: URL do servidor, usuário e senha
2. O plugin envia `POST /api/login` com as credenciais
3. Recebe um token JWT que é usado em todas as requisições subsequentes
4. Em caso de expiração (HTTP 401), re-autenticação automática é tentada silenciosamente
5. Opção "Lembrar-me" persiste credenciais no QgsSettings

### Funcionalidades

O plugin organiza suas funcionalidades em categorias no painel lateral:

#### Funções Gerais (todos os usuários)

| Funcionalidade | Descrição |
|---|---|
| Carregar Camadas de Produtos | Carrega visões materializadas (`mv_produto_*`) como camadas vetoriais no QGIS |
| Informações do Produto | Visualização detalhada: 3 abas (Visão Geral, Histórico de Versões, Relacionamentos) com download e ações de edição |
| Download de Produtos | Seleciona feições da camada ativa e faz download dos arquivos com verificação SHA-256 |
| Download da Situação Geral | Baixa snapshot GeoJSON da situação geral do acervo |
| Buscar Produtos | Busca de produtos com filtros (tipo, escala, projeto, lote) e paginação |
| Visualizar Relacionamentos entre Versões | Listagem de relacionamentos entre versões com exportação CSV |
| Configurações | Configurações do plugin |

#### Funções de Administrador

| Funcionalidade | Descrição |
|---|---|
| Adicionar Produto | Cria um novo produto geográfico |
| Adicionar Produto com Versão Histórica | Cria produto com versão histórica associada |
| Carregar Produtos | Carrega produtos a partir de camada tabular do QGIS |
| Carregar Arquivos Sistemáticos | Carregamento sistemático de arquivos em lote |

#### Administração Avançada

| Funcionalidade | Descrição |
|---|---|
| Gerenciar Volumes | CRUD de volumes de armazenamento |
| Gerenciar Relacionamento Volume e Tipo de Produto | Associações volume/tipo de produto |
| Gerenciar Projetos | CRUD de projetos |
| Gerenciar Lotes | CRUD de lotes dentro de projetos |
| Gerenciar Usuários | Visualização/edição de usuários, importação do servidor de autenticação |

#### Diagnóstico e Manutenção

| Funcionalidade | Descrição |
|---|---|
| Verificar Inconsistências | Executa verificação de inconsistências no servidor |
| Limpar Downloads Expirados | Remove tokens de download expirados |
| Atualizar Visões Materializadas | Atualiza visões materializadas do banco |
| Criar Visão Materializada | Cria novas visões materializadas |
| Gerenciar Arquivos com Problemas | Gerencia arquivos com problemas reportados |
| Gerenciar Arquivos Excluídos | Revisão de arquivos excluídos |
| Visualizar Uploads com Problemas | Sessões de upload com falha |
| Gerenciar Sessões de Upload | Visualiza e cancela sessões de upload ativas |
| Gerenciar Downloads Excluídos | Revisão de downloads excluídos com paginação |

#### Operações em Lote

| Funcionalidade | Descrição |
|---|---|
| Adicionar Arquivos em Lote | Carregamento de arquivos em lote |
| Adicionar Produtos Completos em Lote | Upload em 2 fases (prepare → transfer → confirm) a partir de camada tabular |
| Adicionar Versões a Produtos em Lote | Adiciona versões a produtos existentes em lote |
| Criar Produtos em Lote | Criação de produtos em lote |
| Adicionar Produtos com Versões Históricas em Lote | Produtos com versões históricas em lote |
| Criar Relacionamentos entre Versões em Lote | Criação de relacionamentos em lote |
| Adicionar Versões Históricas em Lote | Versões históricas em lote |

### Transferência de Arquivos

**Download:**
1. Prepara download via API (recebe tokens e caminhos)
2. `FileTransferThread` copia o arquivo (Windows: cópia direta/shell; Linux: `smbclient`)
3. 3 tentativas com backoff exponencial (2s, 4s, 8s)
4. Verificação de checksum SHA-256 após transferência
5. Confirmação de download via API

**Upload:**
1. Validação da estrutura da camada tabular no QGIS
2. Cálculo de checksum SHA-256 e tamanho por arquivo
3. Prepara upload via API (recebe `session_uuid` e caminhos de destino)
4. Copia arquivos para os caminhos designados
5. Confirmação de upload via API

### Estrutura do Plugin

```
ferramentas_acervo/
├── __init__.py           # classFactory() - entry point QGIS
├── main.py               # Classe principal do plugin
├── config.py             # Nome e versão do plugin
├── metadata.txt          # Metadados QGIS
├── core/
│   ├── api_client.py     # Cliente HTTP (requests + JWT)
│   ├── settings.py       # Wrapper QgsSettings
│   └── file_transfer.py  # Thread de transferência (QThread)
└── gui/
    ├── panel.py           # Registro central de funcionalidades
    ├── dockable_panel.py  # Painel dockable principal
    ├── login_dialog.py    # Diálogo de login
    └── [pastas de diálogos]/  # Uma pasta por funcionalidade (.py + .ui)
```

---

## Build do Cliente Web

```bash
# Builda o client/ e copia para server/src/build/
npm run build
```

O Express serve os arquivos estáticos buildados com fallback SPA para `index.html`.

---

## Licença

MIT
