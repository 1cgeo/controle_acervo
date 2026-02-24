# Especificacao Completa — Client Dashboard (SCA)

Documento de referencia para reescrita do client/ (React 18 + MUI 5) em JavaScript puro com Vite.

---

## 1. Visao Geral

O dashboard SCA e uma SPA de uso **exclusivo de administradores**. Tem uma unica pagina funcional (Dashboard) com 4 abas de graficos e tabelas. A sidebar prevê uma segunda pagina "Volumes" que ainda nao esta implementada.

**Acesso:** Requer login. Apos autenticacao, redireciona para `/dashboard`. Apenas admins acessam.

---

## 2. Rotas

| Rota | Pagina | Protecao | Descricao |
|---|---|---|---|
| `/login` | Login | Publica | Formulario de login |
| `/` | Redirect | `authLoader` | Redireciona para `/dashboard` |
| `/dashboard` | Dashboard | `authLoader` + `adminLoader` | Dashboard principal com 4 abas |
| `/unauthorized` | Unauthorized | Publica | Erro 403 — usuario nao e admin |
| `/404` | NotFound | Publica | Erro 404 |
| `*` | Redirect | Nenhuma | Redireciona para `/404` |

### Protecao de Rotas

**authLoader:** Verifica se existe token em localStorage (`@sca_dashboard-Token`) e se nao expirou (`@sca_dashboard-Token-Expiry`). Se invalido, redireciona para `/login?from={currentPath}`.

**adminLoader:** Verifica se `@sca_dashboard-User-Authorization` === `'ADMIN'`. Se nao, redireciona para `/unauthorized`.

---

## 3. Autenticacao

### 3.1 Login

**Endpoint:** `POST /api/login`

**Request:**
```json
{
  "usuario": "string",
  "senha": "string",
  "cliente": "sca_web"
}
```

**Response:**
```json
{
  "success": true,
  "dados": {
    "token": "jwt-string",
    "administrador": true,
    "uuid": "uuid-string"
  }
}
```

### 3.2 Armazenamento (localStorage)

| Chave | Valor | Quando |
|---|---|---|
| `@sca_dashboard-Token` | JWT token | Login |
| `@sca_dashboard-Token-Expiry` | ISO date string (now + 1h) | Login |
| `@sca_dashboard-User-Authorization` | `"ADMIN"` ou `"USER"` | Login |
| `@sca_dashboard-User-uuid` | UUID string | Login |

### 3.3 Logout

1. Remove todas as chaves acima do localStorage
2. Limpa o Zustand store
3. Redireciona para `/login`

### 3.4 Interceptor HTTP

Toda requisicao HTTP adiciona `Authorization: Bearer {token}` no header.
Se a resposta for 401 ou 403: limpa token e redireciona para `/login`.

---

## 4. Pagina de Login

### Layout

Tela cheia com imagem de fundo aleatoria (1 de 5 imagens em `/assets/backgrounds/`). Centraliza um card translucido com backdrop blur.

### Formulario

| Campo | Tipo | Validacao |
|---|---|---|
| `usuario` | text | Obrigatorio (min 1 char) |
| `senha` | password (com toggle visibilidade) | Obrigatorio (min 1 char) |

**Botao:** "Entrar" (desabilitado enquanto submitting, mostra "Entrando...")

**Erro:** Alert vermelho com a mensagem de erro da API.

**Redirecionamento pos-login:** Para `from` (query param) ou `/`.

Se ja autenticado, redireciona automaticamente.

---

## 5. Layout do App

### Estrutura

```
+-------- Navbar (fixed, topo) -----------------------------------+
| [Hamburger] [titulo]            [Theme Toggle] [AuthStatus] [Avatar v] |
+--+--------------------------------------------------------------+
|S |                                                              |
|i |          Area de conteudo principal                          |
|d |          (margem superior para compensar navbar)             |
|e |                                                              |
|b |                                                              |
|a |                                                              |
|r |                                                              |
+--+--------------------------------------------------------------+
```

### Navbar

- **Esquerda:** Botao hamburger (toggle sidebar)
- **Centro:** Titulo — "SCA" no mobile, "Sistema de Controle do Acervo" no desktop
- **Direita:**
  - Toggle tema claro/escuro (Switch customizado no desktop, icone no mobile)
  - Nome do usuario logado (oculto no mobile)
  - Avatar com inicial do nome + seta dropdown
  - Menu dropdown com opcao "Sair"

### Sidebar

**Desktop:** Drawer permanente que colapsa (largura 280px aberto → 56px colapsado). Animacao de transicao.

**Mobile:** Drawer temporario que fecha ao selecionar item.

**Itens do menu:**

| Item | Icone | Rota | Visibilidade |
|---|---|---|---|
| Dashboard | DashboardIcon | `/dashboard` | Todos |
| Volumes | StorageIcon | `/volumes` | Apenas admin |

Item ativo recebe destaque visual (cor primaria).

### Tema

Dois temas: claro e escuro. Preferencia salva em localStorage (`sca-theme-mode`). Respeita preferencia do sistema se nao houver valor salvo. Meta tag `theme-color` atualizada dinamicamente.

---

## 6. Dashboard — Aba "Visao Geral"

Mostra 3 cards de estatisticas em grid (3 colunas no desktop, 1 no mobile).

### Cards

| Card | Icone | Cor | Endpoint | Campo |
|---|---|---|---|---|
| Total de Produtos | StorageIcon | primary | `GET /api/dashboard/produtos_total` | `total_produtos` |
| Armazenamento Total | DataUsageIcon | warning | `GET /api/dashboard/arquivos_total_gb` | `total_gb` (formatado com sufixo "GB") |
| Total de Usuarios | PeopleIcon | success | `GET /api/dashboard/usuarios_total` | `total_usuarios` |

### Componente StatsCard

Props: `title`, `value`, `icon`, `color`, `loading`, `progress` (barra %), `suffix`

- Exibe icone em circulo com fundo claro
- LinearProgress enquanto carrega
- Suporta barra de progresso determinada (nao usada nesta aba)

---

## 7. Dashboard — Aba "Distribuicao"

Mostra 3 graficos de distribuicao.

### 7.1 Grafico de Pizza: Produtos por Tipo

**Endpoint:** `GET /api/dashboard/produtos_tipo`

**Response:** Array de `{ tipo_produto_id, tipo_produto, quantidade }`

Exibe pizza com label do tipo e % dentro de cada fatia. Legenda na lateral (desktop) ou abaixo (mobile). Se um segmento > 95%, mostra label centralizado.

### 7.2 Grafico de Barras: Armazenamento por Tipo de Produto

**Endpoint:** `GET /api/dashboard/gb_tipo_produto`

**Response:** Array de `{ tipo_produto_id, tipo_produto, total_gb }`

Eixo X: `tipo_produto`. Serie unica: total_gb (cor primaria).

### 7.3 Grafico de Barras Empilhadas: Armazenamento por Volume

**Endpoint:** `GET /api/dashboard/gb_volume`

**Response:** Array de `{ volume_armazenamento_id, nome_volume, volume, capacidade_gb_volume, total_gb }`

Calcula `available_gb = capacidade_gb - total_gb` e `usage_percentage`. Exibe barras empilhadas: "Usado (GB)" + "Disponivel (GB)". Eixo X: `nome_volume`.

---

## 8. Dashboard — Aba "Atividade"

### 8.1 Grafico de Barras: Atividade Diaria (Ultimos 30 Dias)

Combina dados de dois endpoints:

**Endpoint 1:** `GET /api/dashboard/arquivos_dia` — uploads por dia
**Endpoint 2:** `GET /api/dashboard/downloads_dia` — downloads por dia

**Response:** Array de `{ dia: "YYYY-MM-DD", quantidade }`

Cria mapa dos ultimos 30 dias preenchendo com 0 onde nao ha dados. Duas series: "Uploads" (verde #4caf50) e "Downloads" (azul #2196f3).

### 8.2 Tabelas de Atividade (Tabs)

4 sub-abas dentro de um Card com Tabs:

#### Tab "Uploads Recentes"

**Endpoint:** `GET /api/dashboard/ultimos_carregamentos` (10 ultimos)

**Colunas:** Nome (com tooltip do nome_arquivo), Tamanho (MB), Tipo (extensao), Data (data_cadastramento)

#### Tab "Modificacoes Recentes"

**Endpoint:** `GET /api/dashboard/ultimas_modificacoes` (10 ultimos)

**Colunas:** Mesmo que uploads.

#### Tab "Exclusoes Recentes"

**Endpoint:** `GET /api/dashboard/ultimos_deletes` (10 ultimos)

**Colunas:** Nome, Tamanho, Tipo, Data (data_delete), Motivo da Exclusao (motivo_exclusao, com tooltip)

#### Tab "Historico de Downloads"

**Endpoint:** `GET /api/dashboard/download` (50 ultimos)

**Colunas:** ID, ID do Arquivo, Data de Download, Status (Chip: "Disponivel" verde / "Arquivo Excluido" vermelho)

### Tabela (Componente FileActivityTable)

- Paginacao client-side (5, 10 ou 25 por pagina)
- Reset pagina quando dados mudam
- Skeleton enquanto carrega
- Mensagem vazia quando sem dados

---

## 9. Dashboard — Aba "Analises Avancadas"

### 9.1 Timeline de Atividade de Produtos

**Endpoint:** `GET /api/dashboard/produto_activity_timeline?months={6|12|24}`

**Response:** Array de `{ month: "YYYY-MM", new_products, modified_products }`

Grafico de barras com 2 series: "Novos Produtos" (verde) e "Produtos Modificados" (laranja). Dropdown para selecionar periodo (6/12/24 meses).

### 9.2 Tabs de Analises

4 sub-abas:

#### Tab "Estatisticas de Versoes"

**Endpoint:** `GET /api/dashboard/version_statistics`

**Response:**
```json
{
  "stats": {
    "total_versions": number,
    "products_with_versions": number,
    "avg_versions_per_product": number,
    "max_versions_per_product": number
  },
  "distribution": [{ "versions_per_product": number, "product_count": number }],
  "type_distribution": [{ "version_type": string, "version_count": number }]
}
```

**Exibicao:**
- 4 cards de resumo: Total de Versoes, Produtos com Versoes, Media de Versoes, Maximo de Versoes
- Pizza: Distribuicao de Versoes por Produto (label: "N versoes")
- Pizza: Tipos de Versao

#### Tab "Tendencias de Armazenamento"

**Endpoint:** `GET /api/dashboard/storage_growth_trends?months={6|12|24}`

**Response:** Array de `{ month: "YYYY-MM", gb_added, cumulative_gb }`

Grafico de barras com 2 series: "GB Adicionados" (verde) e "GB Acumulados" (azul). Dropdown de periodo.

#### Tab "Status de Projetos"

**Endpoint:** `GET /api/dashboard/project_status_summary`

**Response:**
```json
{
  "project_status": [{ "status": string, "project_count": number }],
  "lot_status": [{ "status": string, "lot_count": number }],
  "projects_without_lots": number
}
```

**Exibicao:**
- Card numerico: "Projetos sem Lotes"
- Pizza: Status de Projetos
- Pizza: Status de Lotes

#### Tab "Atividade de Usuarios"

**Endpoint:** `GET /api/dashboard/user_activity_metrics?limit=10`

**Response:** Array de `{ usuario_nome, usuario_login, uploads, modifications, downloads, total_activity }`

Tabela HTML simples: coluna Usuario, Uploads, Modificacoes, Downloads, Total.

---

## 10. Componentes de Grafico

### BarChart

**Props:** `title`, `data[]`, `series[]` (`{ dataKey, name, color }`), `xAxisDataKey`, `height`, `stacked`, `isLoading`

**Comportamento responsivo:**
- Mobile: mostra apenas ultimos 6 itens e max 3 series
- Altura reduzida em mobile/tablet
- Grid, tooltip e legenda adaptam tamanho de fonte
- Barras menores em mobile (10px vs 20px)

**Estados:** Loading (spinner), vazio ("Sem dados disponiveis"), com dados

### PieChart

**Props:** `title`, `data[]` (`{ label, value, color? }`), `height`, `showLegend`, `showLabels`, `isLoading`

**Comportamento:**
- Segmento dominante (>95%): label centralizado em vez de labels nas fatias
- Mobile: labels ocultos se fatia < 10%
- 10 cores do tema em rotacao
- Legenda vertical na lateral (desktop) ou horizontal abaixo (mobile)

---

## 11. Endpoints Completos do Dashboard (Nao Montados em routes.js)

**ATENCAO:** O modulo `server/src/dashboard/` NAO esta montado em `routes.js`. O prefixo seria `/api/dashboard/` se fosse montado. Se for fazer a reescrita, o backend precisa montar esta rota primeiro.

| Metodo | Endpoint | Descricao |
|---|---|---|
| GET | `/api/dashboard/produtos_total` | Total de produtos |
| GET | `/api/dashboard/arquivos_total_gb` | Total de armazenamento em GB |
| GET | `/api/dashboard/usuarios_total` | Total de usuarios |
| GET | `/api/dashboard/produtos_tipo` | Produtos agrupados por tipo |
| GET | `/api/dashboard/gb_tipo_produto` | GB por tipo de produto |
| GET | `/api/dashboard/gb_volume` | GB por volume (com capacidade) |
| GET | `/api/dashboard/arquivos_dia` | Arquivos carregados por dia (30 ultimos) |
| GET | `/api/dashboard/downloads_dia` | Downloads por dia (30 ultimos) |
| GET | `/api/dashboard/ultimos_carregamentos` | 10 ultimos uploads |
| GET | `/api/dashboard/ultimas_modificacoes` | 10 ultimas modificacoes |
| GET | `/api/dashboard/ultimos_deletes` | 10 ultimos deletes |
| GET | `/api/dashboard/download` | 50 ultimos downloads |
| GET | `/api/dashboard/produto_activity_timeline?months=N` | Timeline de atividade de produtos |
| GET | `/api/dashboard/version_statistics` | Estatisticas de versoes |
| GET | `/api/dashboard/storage_growth_trends?months=N` | Tendencias de armazenamento |
| GET | `/api/dashboard/project_status_summary` | Status de projetos e lotes |
| GET | `/api/dashboard/user_activity_metrics?limit=N` | Top N usuarios mais ativos |

**Formato de resposta (todos):**
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Descricao",
  "dados": { ... }
}
```

---

## 12. Paginas de Erro

### Unauthorized (`/unauthorized`)

Exibe mensagem de acesso negado (403). Link para voltar ao dashboard.

### NotFound (`/404`)

Exibe mensagem de pagina nao encontrada (404). Link para voltar ao dashboard.

---

## 13. Comportamentos Transversais

### Requisicoes HTTP

- Base URL: proxy do Vite redireciona `/api` para `http://localhost:3013` (ou `VITE_API_URL`)
- Token JWT no header `Authorization: Bearer {token}`
- Interceptor de resposta: 401/403 -> logout automatico

### Cache de Dados

Todos os dados do dashboard usam stale time de 1 minuto (FREQUENT_DATA). Apos 1 minuto, refetch automatico em background. Retry: 1 vez para queries, 0 para mutations.

### Tema

- Claro e escuro, toggle na navbar
- Persistido em `localStorage['sca-theme-mode']`
- Meta tag `theme-color` atualizada
- Cores do tema usadas em todos os graficos
- AppBar: backdrop-blur + transparencia adaptada ao tema

### Responsividade

- Breakpoints: xs (0), sm (600), md (900), lg (1200), xl (1536)
- Sidebar: permanente colapsavel no desktop (lg+), temporaria no mobile
- Graficos: altura e dados reduzidos em mobile
- Navbar: titulo encurtado, toggle de tema simplificado
- Login: variant dos inputs muda (standard vs outlined)
- Grid: de 3 colunas para 1 em mobile
