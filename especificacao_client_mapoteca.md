# Especificacao Completa — Client Admin Mapoteca

Documento de referencia para reescrita do client_admin_mapoteca/ (React 19 + MUI 6) em JavaScript puro com Vite.

---

## 1. Visao Geral

A Mapoteca Admin e uma SPA de administracao da mapoteca (biblioteca fisica de mapas). Permite gerenciar clientes, pedidos de impressao, estoque de materiais, consumo e plotters. Acesso exclusivo para administradores.

**Dominios:** Clientes, Pedidos (com produtos), Materiais (tipos, estoque, consumo), Plotters (com manutencoes), Dashboard analitico.

---

## 2. Rotas

| Rota | Pagina | Protecao | Descricao |
|---|---|---|---|
| `/login` | Login | Publica | Formulario de login |
| `/` | Redirect | `authLoader` | Redireciona para `/dashboard` |
| `/dashboard` | Dashboard | `authLoader` + `adminLoader` | Dashboard analitico |
| `/clientes` | ClientList | `authLoader` + `adminLoader` | Lista de clientes |
| `/clientes/:id` | ClientDetails | `authLoader` + `adminLoader` | Detalhes de um cliente |
| `/pedidos` | OrderList | `authLoader` + `adminLoader` | Lista de pedidos |
| `/pedidos/novo` | OrderCreate | `authLoader` + `adminLoader` | Criar novo pedido (wizard 4 etapas) |
| `/pedidos/:id` | OrderDetails | `authLoader` + `adminLoader` | Detalhes de um pedido |
| `/materiais` | MaterialList | `authLoader` + `adminLoader` | Lista de tipos de material |
| `/materiais/:id` | MaterialDetails | `authLoader` + `adminLoader` | Detalhes de um tipo de material |
| `/estoque` | StockList | `authLoader` + `adminLoader` | Gestao de estoque |
| `/consumo` | ConsumptionList | `authLoader` + `adminLoader` | Registros de consumo |
| `/plotters` | PlotterList | `authLoader` + `adminLoader` | Lista de plotters |
| `/plotters/:id` | PlotterDetails | `authLoader` + `adminLoader` | Detalhes de um plotter |
| `/unauthorized` | Unauthorized | Publica | Erro 403 |
| `/404` | NotFound | Publica | Erro 404 |
| `*` | Redirect | Nenhuma | Redireciona para `/404` |

### Protecao de Rotas

**authLoader:** Verifica token em localStorage (`@mapoteca-Token`) e expiracao (`@mapoteca-Token-Expiry`). Se invalido, redireciona para `/login?from={currentPath}`.

**adminLoader:** Verifica `@mapoteca-User-Authorization` === `'ADMIN'`. Se nao, redireciona para `/unauthorized`.

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
    "uuid": "uuid-string",
    "username": "string"
  }
}
```

### 3.2 Armazenamento (localStorage)

| Chave | Valor |
|---|---|
| `@mapoteca-Token` | JWT token |
| `@mapoteca-Token-Expiry` | ISO date string (**CORRIGIR: usar now + 1h, nao 24h**) |
| `@mapoteca-User-Authorization` | `"ADMIN"` ou `"USER"` |
| `@mapoteca-User-uuid` | UUID string |
| `@mapoteca-User-username` | Username string |

### 3.3 Logout

Remove todas as chaves acima. Limpa store. Redireciona para `/login`.

### 3.4 Interceptor HTTP

Header `Authorization: Bearer {token}` em toda requisicao. 401/403 -> logout automatico via `logoutAndRedirect()`.

---

## 4. Pagina de Login

Identica ao client dashboard (ver especificacao_client_dashboard.md secao 4), com as diferencas:

- Titulo: "Mapoteca Admin"
- Chaves de localStorage com prefixo `@mapoteca-`

---

## 5. Layout do App

### Estrutura

```
+-------- Navbar (fixed) ----------------------------------------+
| [Hamburger] "Mapoteca Admin"   [Theme Toggle] [Username] [Logout] |
+--+-------------------------------------------------------------+
|S |                                                              |
|i |          Area de conteudo principal                          |
|d |                                                              |
|e |                                                              |
|b |                                                              |
|a |                                                              |
|r |                                                              |
+--+-------------------------------------------------------------+
```

### Navbar

- Botao hamburger, titulo "Mapoteca Admin"
- Toggle tema (Switch desktop / icone mobile)
- Nome do usuario (AuthStatus)
- Botao logout (ExitToAppIcon)

### Sidebar (Drawer temporario)

| Item | Icone | Rota |
|---|---|---|
| Dashboard | DashboardIcon | `/dashboard` |
| Clientes | PeopleIcon | `/clientes` |
| Pedidos | ReceiptIcon | `/pedidos` |
| **Materiais** (colapsavel) | InventoryIcon | — |
|   Tipos de Material | InventoryIcon | `/materiais` |
|   Estoque | WarehouseIcon | `/estoque` |
|   Consumo | AddShoppingCartIcon | `/consumo` |
| Plotters | PrintIcon | `/plotters` |

A secao "Materiais" e colapsavel com icone de expandir/colapsar.

### Tema

Dois temas (claro/escuro). Persistido em `localStorage['mapoteca-theme-mode']`. Respeita preferencia do sistema.

---

## 6. Dashboard

### 6.1 Cards de Resumo (Topo)

4 cards em grid (4 colunas desktop, 2 tablet, 1 mobile):

| Card | Icone | Cor | Dado |
|---|---|---|---|
| Total de Pedidos | AssessmentIcon | primary | Soma de todos os pedidos |
| Pedidos em Andamento | ScheduleIcon | info | Pedidos com status "em andamento" |
| Pedidos Concluidos | AssessmentIcon | success | Pedidos com status "concluido" |
| Pedidos Pendentes | PeopleIcon | warning | Pedidos com status "pendente" |

**Endpoint:** `GET /api/mapoteca/dashboard/order_status`

**Response:** `{ total, em_andamento, concluidos, pendentes, by_status: [{ status, count }] }`

### 6.2 Graficos

#### Grafico de Pizza: Distribuicao por Status

Dados de `order_status.by_status`.

#### Grafico de Barras: Estoque por Localizacao

**Endpoint:** `GET /api/mapoteca/dashboard/stock_by_location`

#### Grafico de Linha: Timeline de Pedidos (6 meses)

**Endpoint:** `GET /api/mapoteca/dashboard/orders_timeline?meses=6`

**Response:** Array de `{ semana_inicio, semana_fim, total_pedidos, total_produtos }`

Eixo X: semanas. Serie: total_pedidos.

### 6.3 Tabela: Pedidos Pendentes

**Endpoint:** `GET /api/mapoteca/dashboard/pending_orders`

**Colunas:** ID, Data Pedido, Cliente, Prazo, Dias ate Prazo, Status (chip colorido), Indicador "Atrasado"

### 6.4 Dados Adicionais Carregados (para analise futura)

| Endpoint | Descricao | Params |
|---|---|---|
| `GET /api/mapoteca/dashboard/avg_fulfillment_time` | Tempo medio de atendimento | — |
| `GET /api/mapoteca/dashboard/client_activity?limite=10` | Top 10 clientes ativos | `limite` |
| `GET /api/mapoteca/dashboard/material_consumption?meses=12` | Tendencia de consumo | `meses` |
| `GET /api/mapoteca/dashboard/plotter_status` | Status dos plotters | — |

**Auto-refetch:** Dados do dashboard sao recarregados a cada 60 segundos.

---

## 7. Clientes

### 7.1 Lista de Clientes (`/clientes`)

**Endpoint:** `GET /api/mapoteca/cliente`

**Colunas da tabela:**

| Coluna | Campo | Formato |
|---|---|---|
| ID | `id` | Numero |
| Nome | `nome` | Texto |
| Tipo | `tipo_cliente` | Texto (nome do tipo) |
| Ponto de Contato | `ponto_contato_principal` | Texto |
| Total Pedidos | `total_pedidos` | Numero |
| Ultimo Pedido | `data_ultimo_pedido` | Data |
| Em Andamento | `pedidos_em_andamento` | Numero |

**Acoes:**

| Acao | Comportamento |
|---|---|
| Ver detalhes | Navega para `/clientes/:id` |
| Excluir | Confirmacao -> `DELETE /api/mapoteca/cliente` com `{ cliente_ids: [id] }` |
| Excluir selecionados | Multi-select -> delete em lote |
| Novo cliente | Abre dialog de criacao |
| Busca | Full-text client-side em todas as colunas |
| Exportar | CSV |

### 7.2 Detalhes do Cliente (`/clientes/:id`)

**Endpoint:** `GET /api/mapoteca/cliente/:id`

**Response:**
```json
{
  "id": number,
  "nome": "string",
  "tipo_cliente": "string",
  "tipo_cliente_id": number,
  "ponto_contato_principal": "string",
  "endereco_entrega_principal": "string",
  "total_pedidos": number,
  "pedidos_em_andamento": number,
  "pedidos_concluidos": number,
  "total_produtos": number,
  "data_primeiro_pedido": "date",
  "data_ultimo_pedido": "date",
  "pedidos_recentes": [{ pedido }]
}
```

**Layout:**

- Cabecalho: Nome + Chip com tipo_cliente + Botao editar
- Card info: ID, ponto_contato_principal, endereco_entrega_principal (com icones)
- Card estatisticas: total_pedidos, pedidos_em_andamento, pedidos_concluidos, total_produtos, data_primeiro_pedido, data_ultimo_pedido
- Tabela de pedidos recentes: ID, data_pedido, documento_solicitacao, Status (chip), Prazo, quantidade_produtos, icone ver

### 7.3 Dialog Criar/Editar Cliente

**Campos:**

| Campo | Tipo | Validacao |
|---|---|---|
| `nome` | text | Obrigatorio |
| `tipo_cliente_id` | select | Obrigatorio. Opcoes de `GET /api/mapoteca/dominio/tipo_cliente` |
| `ponto_contato_principal` | text | Opcional |
| `endereco_entrega_principal` | text | Opcional |

**Criar:** `POST /api/mapoteca/cliente`
**Atualizar:** `PUT /api/mapoteca/cliente` (inclui `id`)

---

## 8. Pedidos

### 8.1 Lista de Pedidos (`/pedidos`)

**Endpoint:** `GET /api/mapoteca/pedido`

**Colunas:**

| Coluna | Campo | Formato |
|---|---|---|
| ID | `id` | Numero |
| Data Pedido | `data_pedido` | Data |
| Cliente | `nome_cliente` | Texto |
| Documento | `documento_solicitacao` | Texto |
| Status | `situacao_pedido` | Chip colorido |
| Prazo | `prazo` | Data |
| Produtos | `quantidade_produtos` | Numero |
| Localizador | `localizador_pedido` | Texto (formato XXXX-XXXX-XXXX) |

**Cores dos status (por situacao_pedido_id):**

| ID | Cor |
|---|---|
| 1 | default |
| 2 | info |
| 3 | primary |
| 4 | secondary |
| 5 | success |
| 6 | error |

**Acoes:** Ver detalhes, Excluir (com confirmacao), Excluir selecionados, Novo pedido, Busca, Exportar CSV.

### 8.2 Criar Pedido (`/pedidos/novo`) — Wizard 4 Etapas

#### Etapa 1: Informacoes Basicas

| Campo | Tipo | Validacao |
|---|---|---|
| `cliente_id` | select | Obrigatorio. Opcoes de `GET /api/mapoteca/cliente` |
| `situacao_pedido_id` | select | Obrigatorio. Opcoes de `GET /api/mapoteca/dominio/situacao_pedido` |
| `data_pedido` | date picker | Obrigatorio |
| `data_atendimento` | date picker | Opcional |
| `documento_solicitacao` | text | Opcional |
| `documento_solicitacao_nup` | text | Opcional |
| `prazo` | date picker | Opcional |

#### Etapa 2: Informacoes Adicionais

| Campo | Tipo | Validacao |
|---|---|---|
| `ponto_contato` | text | Opcional |
| `endereco_entrega` | textarea (multiline) | Opcional |
| `palavras_chave` | chip input (array de strings) | Opcional |
| `operacao` | text | Opcional |
| `observacao` | textarea (multiline) | Opcional |
| `localizador_envio` | text | Opcional |
| `observacao_envio` | text | Opcional |
| `motivo_cancelamento` | text | Opcional |

**Palavras-chave:** Interface de adicionar/remover chips dinamicamente. Digita texto e pressiona Enter para criar chip. Clica X no chip para remover.

#### Etapa 3: Produtos

Para cada produto adicionado:

| Campo | Tipo | Validacao |
|---|---|---|
| `uuid_versao` | text | Obrigatorio, formato UUID |
| `tipo_midia_id` | select | Obrigatorio. Opcoes de `GET /api/mapoteca/dominio/tipo_midia` |
| `quantidade` | number | Obrigatorio, > 0, inteiro |
| `producao_especifica` | checkbox | Default false |

Pode adicionar multiplos produtos. Exibe lista dos adicionados.

#### Etapa 4: Confirmacao

Exibe mensagem de sucesso com ID e localizador gerado. Opcoes: ir para detalhes do pedido ou voltar a lista.

**Endpoint:** `POST /api/mapoteca/pedido`

**Request:**
```json
{
  "data_pedido": "2024-01-01",
  "cliente_id": 1,
  "situacao_pedido_id": 1,
  "ponto_contato": "...",
  "documento_solicitacao": "...",
  "documento_solicitacao_nup": "...",
  "endereco_entrega": "...",
  "palavras_chave": ["tag1", "tag2"],
  "operacao": "...",
  "prazo": "2024-02-01",
  "observacao": "...",
  "localizador_envio": "...",
  "observacao_envio": "...",
  "motivo_cancelamento": null,
  "data_atendimento": null
}
```

**Response:** `{ id: number, localizador_pedido: "XXXX-XXXX-XXXX" }`

Apos criar o pedido, os produtos sao adicionados um a um via:
`POST /api/mapoteca/produto_pedido` com `{ uuid_versao, pedido_id, quantidade, tipo_midia_id, producao_especifica }`

**Navegacao:** Stepper horizontal mostrando etapa atual. Botoes "Anterior", "Proximo", "Cancelar".

### 8.3 Detalhes do Pedido (`/pedidos/:id`)

**Endpoint:** `GET /api/mapoteca/pedido/:id`

**Response:**
```json
{
  "id": number,
  "data_pedido": "date",
  "data_atendimento": "date",
  "cliente_id": number,
  "nome_cliente": "string",
  "tipo_cliente": "string",
  "situacao_pedido_id": number,
  "situacao_pedido": "string",
  "localizador_pedido": "XXXX-XXXX-XXXX",
  "ponto_contato": "string",
  "documento_solicitacao": "string",
  "documento_solicitacao_nup": "string",
  "endereco_entrega": "string",
  "palavras_chave": ["string"],
  "operacao": "string",
  "prazo": "date",
  "observacao": "string",
  "localizador_envio": "string",
  "observacao_envio": "string",
  "motivo_cancelamento": "string",
  "produtos": [{
    "id": number,
    "produto_nome": "string",
    "mi": "string",
    "inom": "string",
    "escala": "string",
    "tipo_midia": "string",
    "quantidade": number,
    "producao_especifica": boolean
  }]
}
```

**Layout:**

- Cabecalho: "Pedido #ID" + Chip status + Chip localizador
- 4 cards de info em grid (large: 4 colunas, medium: 2):
  1. **Datas:** data_pedido, data_atendimento, prazo
  2. **Cliente:** nome (link para `/clientes/:id`), tipo_cliente, ponto_contato
  3. **Documento:** documento_solicitacao, documento_solicitacao_nup, operacao
  4. **Entrega:** endereco_entrega, localizador_envio, observacao_envio
- Secao adicional: observacao (multiline), palavras_chave (chips), motivo_cancelamento (cor erro)
- Tabela de produtos: ID, Produto, MI, INOM, Escala, Tipo Midia, Quantidade, Producao Especifica, Acao (excluir)

**Acoes:**
- Editar pedido (abre dialog de edicao)
- Adicionar produto (abre dialog)
- Excluir pedido (confirmacao)
- Excluir produto da lista

### 8.4 Dialog Editar Pedido

Todos os campos do pedido editaveis (exceto ID). Date pickers com locale pt-BR.

**Endpoint:** `PUT /api/mapoteca/pedido` (inclui `id`)

### 8.5 Dialog Adicionar Produto

| Campo | Tipo | Validacao |
|---|---|---|
| `uuid_versao` | text | Obrigatorio, formato UUID |
| `tipo_midia_id` | select | Obrigatorio |
| `quantidade` | number | Obrigatorio, > 0 |
| `producao_especifica` | checkbox | Default false |

**Endpoint:** `POST /api/mapoteca/produto_pedido`

### 8.6 Busca por Localizador

**Endpoint:** `GET /api/mapoteca/pedido/localizador/:localizador`

Formato do localizador: `XXXX-XXXX-XXXX` (letras maiusculas e numeros).

---

## 9. Materiais

### 9.1 Lista de Tipos de Material (`/materiais`)

**Endpoint:** `GET /api/mapoteca/tipo_material`

**Colunas:**

| Coluna | Campo |
|---|---|
| ID | `id` |
| Nome | `nome` |
| Descricao | `descricao` |
| Estoque Total | `estoque_total` |
| Localizacoes | `total_localizacoes` |

**Acoes:** Ver detalhes, Excluir, Excluir selecionados, Novo tipo, Busca, Exportar CSV.

### 9.2 Detalhes do Tipo de Material (`/materiais/:id`)

**Endpoint:** `GET /api/mapoteca/tipo_material/:id`

**Response:**
```json
{
  "id": number,
  "nome": "string",
  "descricao": "string",
  "estoque_total": number,
  "total_localizacoes": number,
  "estoque": [{ "localizacao": "string", "quantidade": number }],
  "consumo_recente": [{ "data_consumo": "date", "quantidade": number }],
  "consumo_mensal": [{ "mes": "string", "total": number }]
}
```

**Layout:**
- Info: nome e descricao
- Cards: estoque total, numero de localizacoes
- Subsecao estoque: lista de itens com localizacao e quantidade
- Subsecao consumo recente: registros com data e quantidade
- Subsecao consumo mensal: tabela de tendencia

### 9.3 Dialog Criar/Editar Tipo de Material

| Campo | Tipo | Validacao |
|---|---|---|
| `nome` | text | Obrigatorio |
| `descricao` | text | Opcional |

**Criar:** `POST /api/mapoteca/tipo_material`
**Atualizar:** `PUT /api/mapoteca/tipo_material` (inclui `id`)

---

## 10. Estoque

### 10.1 Lista de Estoque (`/estoque`)

**Endpoint:** `GET /api/mapoteca/estoque_material`

**Cards de resumo (topo):** Total por localizacao, usando `GET /api/mapoteca/estoque_por_localizacao`. Cada localizacao e um card com icone WarehouseIcon e quantidade total.

**Colunas da tabela:**

| Coluna | Campo |
|---|---|
| ID | `id` |
| Material | `nome_material` |
| Localizacao | `localizacao` |
| Quantidade | `quantidade` |
| Data Criacao | `data_criacao` |
| Criado por | `usuario_criacao` |

**Acoes:** Ver material (navega para `/materiais/:id`), Excluir, Excluir selecionados, Novo item, Busca, Exportar CSV.

### 10.2 Dialog Criar Item de Estoque

| Campo | Tipo | Validacao |
|---|---|---|
| `tipo_material_id` | select | Obrigatorio. Opcoes de `GET /api/mapoteca/tipo_material` |
| `localizacao_id` | select | Obrigatorio. Opcoes de `GET /api/mapoteca/dominio/tipo_localizacao` |
| `quantidade` | number (decimal) | Obrigatorio, > 0 |

**Endpoint:** `POST /api/mapoteca/estoque_material`

---

## 11. Consumo

### 11.1 Lista de Consumo (`/consumo`)

**Endpoint:** `GET /api/mapoteca/consumo_material` (aceita filtros: `data_inicio`, `data_fim`, `tipo_material_id`)

**Filtros (topo da pagina):**

| Filtro | Tipo | Descricao |
|---|---|---|
| Data inicio | date picker | Filtra consumo a partir desta data |
| Data fim | date picker | Filtra consumo ate esta data |
| Tipo de material | select | Filtra por material especifico |

**Colunas da tabela:**

| Coluna | Campo |
|---|---|
| ID | `id` |
| Material | `nome_material` |
| Quantidade | `quantidade` |
| Data Consumo | `data_consumo` |
| Usuario | `usuario_nome` |

**Resumo:** Total consumido e media por registro.

**Acoes:** Registrar novo consumo, Excluir, Excluir selecionados.

### 11.2 Dialog Registrar Consumo

| Campo | Tipo | Validacao |
|---|---|---|
| `tipo_material_id` | select | Obrigatorio |
| `quantidade` | number (decimal) | Obrigatorio, > 0 |
| `data_consumo` | date picker | Obrigatorio |

**Endpoint:** `POST /api/mapoteca/consumo_material`

### 11.3 Consumo Mensal

**Endpoint:** `GET /api/mapoteca/consumo_mensal?ano={ano}`

Retorna consumo agregado por mes e tipo de material para o ano especificado.

---

## 12. Plotters

### 12.1 Lista de Plotters (`/plotters`)

**Endpoint:** `GET /api/mapoteca/plotter`

**Colunas:**

| Coluna | Campo | Formato |
|---|---|---|
| ID | `id` | Numero |
| Status | `ativo` | Chip: "Ativo" (verde) / "Inativo" (vermelho) |
| N Serie | `nr_serie` | Texto |
| Modelo | `modelo` | Texto |
| Data Aquisicao | `data_aquisicao` | Data |
| Vida Util | `vida_util` | Numero (meses) |
| Ultima Manutencao | `data_ultima_manutencao` | Data |
| Qtd. Manutencoes | `total_manutencoes` | Numero |

**Acoes:** Ver detalhes, Excluir, Excluir selecionados, Novo plotter, Busca, Exportar CSV.

### 12.2 Detalhes do Plotter (`/plotters/:id`)

**Endpoint:** `GET /api/mapoteca/plotter/:id`

**Response:**
```json
{
  "id": number,
  "ativo": boolean,
  "nr_serie": "string",
  "modelo": "string",
  "data_aquisicao": "date",
  "vida_util": number,
  "data_ultima_manutencao": "date",
  "total_manutencoes": number,
  "valor_total_manutencoes": number,
  "valor_medio_manutencoes": number,
  "tempo_medio_entre_manutencoes_dias": number,
  "manutencoes": [{
    "id": number,
    "data_manutencao": "date",
    "valor": number,
    "descricao": "string",
    "usuario_nome": "string"
  }]
}
```

**Layout:**
- Info: nr_serie, modelo, data_aquisicao, vida_util, data_ultima_manutencao, status (ativo/inativo)
- Card estatisticas: total_manutencoes, valor_total_manutencoes, valor_medio_manutencoes, tempo_medio_entre_manutencoes_dias
- Tabela de manutencoes: data, valor (R$), descricao, usuario

**Acoes:** Editar plotter, Adicionar manutencao, Excluir plotter.

### 12.3 Dialog Criar/Editar Plotter

| Campo | Tipo | Validacao |
|---|---|---|
| `ativo` | toggle/checkbox | Default true |
| `nr_serie` | text | Obrigatorio |
| `modelo` | text | Obrigatorio |
| `data_aquisicao` | date picker | Opcional |
| `vida_util` | number | Opcional (meses) |

**Criar:** `POST /api/mapoteca/plotter`
**Atualizar:** `PUT /api/mapoteca/plotter` (inclui `id`)

### 12.4 Dialog Adicionar Manutencao

| Campo | Tipo | Validacao |
|---|---|---|
| `plotter_id` | hidden | Preenchido automaticamente |
| `data_manutencao` | date picker | Obrigatorio |
| `valor` | number (decimal, 2 casas) | Obrigatorio, > 0 |
| `descricao` | text | Opcional |

**Criar:** `POST /api/mapoteca/manutencao_plotter`
**Atualizar:** `PUT /api/mapoteca/manutencao_plotter` (inclui `id`)

---

## 13. Endpoints Completos

### 13.1 Dominios (sem autenticacao)

| Metodo | Endpoint | Retorno |
|---|---|---|
| GET | `/api/mapoteca/dominio/tipo_cliente` | `[{ code, nome }]` |
| GET | `/api/mapoteca/dominio/situacao_pedido` | `[{ code, nome }]` |
| GET | `/api/mapoteca/dominio/tipo_midia` | `[{ code, nome }]` |
| GET | `/api/mapoteca/dominio/tipo_localizacao` | `[{ code, nome }]` |

### 13.2 Clientes (requer login / admin para escrita)

| Metodo | Endpoint | Auth | Body/Params |
|---|---|---|---|
| GET | `/api/mapoteca/cliente` | login | — |
| GET | `/api/mapoteca/cliente/:id` | login | — |
| POST | `/api/mapoteca/cliente` | admin | `{ nome, tipo_cliente_id, ponto_contato_principal?, endereco_entrega_principal? }` |
| PUT | `/api/mapoteca/cliente` | admin | `{ id, nome, tipo_cliente_id, ponto_contato_principal?, endereco_entrega_principal? }` |
| DELETE | `/api/mapoteca/cliente` | admin | `{ cliente_ids: [int] }` |

### 13.3 Pedidos

| Metodo | Endpoint | Auth | Body/Params |
|---|---|---|---|
| GET | `/api/mapoteca/pedido` | login | — |
| GET | `/api/mapoteca/pedido/:id` | login | — |
| GET | `/api/mapoteca/pedido/localizador/:localizador` | nenhuma | Formato: `XXXX-XXXX-XXXX` |
| POST | `/api/mapoteca/pedido` | admin | Ver secao 8.2 |
| PUT | `/api/mapoteca/pedido` | admin | Mesmo que POST + `id` |
| DELETE | `/api/mapoteca/pedido` | admin | `{ pedido_ids: [int] }` |

### 13.4 Produtos do Pedido

| Metodo | Endpoint | Auth | Body |
|---|---|---|---|
| POST | `/api/mapoteca/produto_pedido` | admin | `{ uuid_versao, pedido_id, quantidade, tipo_midia_id, producao_especifica }` |
| PUT | `/api/mapoteca/produto_pedido` | admin | `{ id, uuid_versao, pedido_id, quantidade, tipo_midia_id, producao_especifica }` |
| DELETE | `/api/mapoteca/produto_pedido` | admin | `{ produto_pedido_ids: [int] }` |

### 13.5 Plotters

| Metodo | Endpoint | Auth | Body |
|---|---|---|---|
| GET | `/api/mapoteca/plotter` | login | — |
| GET | `/api/mapoteca/plotter/:id` | login | — |
| POST | `/api/mapoteca/plotter` | admin | `{ ativo, nr_serie, modelo, data_aquisicao?, vida_util? }` |
| PUT | `/api/mapoteca/plotter` | admin | `{ id, ativo, nr_serie, modelo, data_aquisicao?, vida_util? }` |
| DELETE | `/api/mapoteca/plotter` | admin | `{ plotter_ids: [int] }` |

### 13.6 Manutencao de Plotter

| Metodo | Endpoint | Auth | Body |
|---|---|---|---|
| GET | `/api/mapoteca/manutencao_plotter` | login | — |
| POST | `/api/mapoteca/manutencao_plotter` | admin | `{ plotter_id, data_manutencao, valor, descricao? }` |
| PUT | `/api/mapoteca/manutencao_plotter` | admin | `{ id, plotter_id, data_manutencao, valor, descricao? }` |
| DELETE | `/api/mapoteca/manutencao_plotter` | admin | `{ manutencao_ids: [int] }` |

### 13.7 Tipos de Material

| Metodo | Endpoint | Auth | Body |
|---|---|---|---|
| GET | `/api/mapoteca/tipo_material` | login | — |
| GET | `/api/mapoteca/tipo_material/:id` | login | — |
| POST | `/api/mapoteca/tipo_material` | admin | `{ nome, descricao? }` |
| PUT | `/api/mapoteca/tipo_material` | admin | `{ id, nome, descricao? }` |
| DELETE | `/api/mapoteca/tipo_material` | admin | `{ tipo_material_ids: [int] }` |

### 13.8 Estoque de Material

| Metodo | Endpoint | Auth | Body |
|---|---|---|---|
| GET | `/api/mapoteca/estoque_material` | login | — |
| GET | `/api/mapoteca/estoque_por_localizacao` | login | — |
| POST | `/api/mapoteca/estoque_material` | admin | `{ tipo_material_id, quantidade, localizacao_id }` |
| PUT | `/api/mapoteca/estoque_material` | admin | `{ id, tipo_material_id, quantidade, localizacao_id }` |
| DELETE | `/api/mapoteca/estoque_material` | admin | `{ estoque_material_ids: [int] }` |

### 13.9 Consumo de Material

| Metodo | Endpoint | Auth | Body/Query |
|---|---|---|---|
| GET | `/api/mapoteca/consumo_material` | login | Query: `data_inicio?`, `data_fim?`, `tipo_material_id?` |
| GET | `/api/mapoteca/consumo_mensal` | login | Query: `ano?` (default: ano atual) |
| POST | `/api/mapoteca/consumo_material` | admin | `{ tipo_material_id, quantidade, data_consumo }` |
| PUT | `/api/mapoteca/consumo_material` | admin | `{ id, tipo_material_id, quantidade, data_consumo }` |
| DELETE | `/api/mapoteca/consumo_material` | admin | `{ consumo_material_ids: [int] }` |

### 13.10 Dashboard

| Metodo | Endpoint | Query |
|---|---|---|
| GET | `/api/mapoteca/dashboard/order_status` | — |
| GET | `/api/mapoteca/dashboard/orders_timeline` | `meses` |
| GET | `/api/mapoteca/dashboard/avg_fulfillment_time` | — |
| GET | `/api/mapoteca/dashboard/client_activity` | `limite` |
| GET | `/api/mapoteca/dashboard/pending_orders` | — |
| GET | `/api/mapoteca/dashboard/stock_by_location` | — |
| GET | `/api/mapoteca/dashboard/material_consumption` | `meses` |
| GET | `/api/mapoteca/dashboard/plotter_status` | — |

---

## 14. Componente de Tabela Reutilizavel

Presente em todas as paginas de lista. Funcionalidades:

| Funcionalidade | Descricao |
|---|---|
| Busca | Full-text client-side em todas as colunas visiveis |
| Ordenacao | Click no cabecalho ordena ASC/DESC |
| Selecao | Checkbox em cada linha + checkbox geral. Habilita botao "Excluir selecionados" |
| Paginacao | Client-side |
| Exportar CSV | Botao exporta dados visiveis para CSV |
| Acoes por linha | Botoes de icone (ver, editar, excluir) |
| Responsividade | Colunas com prioridade. Colunas de menor prioridade sao escondidas em telas menores |
| Formatacao | Funcoes de formatacao por coluna (datas, numeros, badges/chips) |

---

## 15. Dialogs de Confirmacao

Todas as operacoes de exclusao exigem confirmacao via dialog modal. Mensagem customizada por tipo de recurso.

Exemplo: "Tem certeza que deseja excluir 3 clientes? Esta acao nao pode ser desfeita."

---

## 16. Formato de Resposta da API

Todas as respostas seguem:

```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Descricao em portugues",
  "dados": { ... },
  "error": null
}
```

O campo `dados` contem o payload. Em caso de erro:

```json
{
  "success": false,
  "message": "Descricao do erro",
  "dados": null,
  "error": "detalhes"
}
```

---

## 17. Comportamentos Transversais

### Cache

| Tipo de dado | Stale Time |
|---|---|
| Dominios (tipo_cliente, tipo_midia, etc.) | 30 minutos |
| Dados de usuario | 5 minutos |
| Dashboard (graficos, estatisticas) | 1 minuto |
| Listas (clientes, pedidos, etc.) | 5 minutos |

Retry: 1 vez para queries, 0 para mutations.

### Invalidacao

Apos mutation (criar/editar/excluir), as queries relacionadas sao invalidadas automaticamente. Exemplo: ao criar um cliente, a lista de clientes e refetchada.

### Datas

- Todos os date pickers usam locale pt-BR
- Formato de exibicao: `DD/MM/YYYY` ou `DD/MM/YYYY HH:mm`
- Formato de envio para API: ISO string (`YYYY-MM-DDTHH:mm:ss.sssZ`)

### Proxy

Vite proxy: `/api` -> `http://localhost:3010` (ou `VITE_API_URL`)
