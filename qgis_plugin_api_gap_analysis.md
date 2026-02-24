# Analise de Lacunas: Plugin QGIS vs Backend API

Este documento apresenta uma analise completa do cruzamento entre as chamadas HTTP feitas pelo plugin QGIS (`ferramentas_acervo/`) e os endpoints disponiveis no backend (`server/`), identificando incompatibilidades, endpoints ausentes e problemas de integracao.

**Ultima atualizacao:** 2026-02-24

---

## 1. Status Geral da Integracao

### Resultado: 0 bugs criticos de integracao Plugin <-> Backend

Todos os 5 bugs criticos e 3 problemas menores identificados na analise anterior foram **corrigidos**. O plugin QGIS esta totalmente alinhado com os endpoints do backend.

---

## 2. Bugs Anteriores - Todos Corrigidos

### 2.1 Nomes de Campos da Resposta (CORRIGIDO)

**Bug anterior:** 12 dialogos verificavam `sucesso`/`mensagem` em vez de `success`/`message`.

**Status:** Todos os dialogos agora utilizam corretamente `response.get('success')` e `response['message']`. Exemplos verificados:

| Arquivo | Linha(s) | Verificacao Atual |
|---|---|---|
| `gui/adicionar_produto/adicionar_produto_dialog.py` | 766, 772-773 | `response.get('success')`, `response['message']` |
| `gui/bulk_carrega_versoes_arquivos/bulk_carrega_versoes_arquivos_dialog.py` | 373, 380-381 | `response.get('success')`, `response['message']` |
| `gui/bulk_carrega_arquivos/bulk_carrega_arquivos_dialog.py` | 283, 290-291 | `response.get('success')`, `response['message']` |
| `gui/bulk_carrega_produtos_versoes_arquivos/bulk_carrega_produtos_versoes_arquivos_dialog.py` | 410, 417-418 | `response.get('success')`, `response['message']` |
| `gui/bulk_versao_relacionamento/bulk_versao_relacionamento_dialog.py` | 77, 84-85 | `response.get('success')`, `response['message']` |
| `gui/bulk_produtos/bulk_produtos_dialog.py` | 78, 85-86 | `response.get('success')`, `response['message']` |
| `gui/bulk_produtos_versoes_historicas/bulk_produtos_versoes_historicas_dialog.py` | 79, 86-87 | `response.get('success')`, `response['message']` |
| `gui/bulk_versoes_historicas/bulk_versoes_historicas_dialog.py` | 79, 86-87 | `response.get('success')`, `response['message']` |
| `gui/informacao_produto/add_historical_version_dialog.py` | 135, 140-141 | `response.get('success')`, `response['message']` |
| `gui/informacao_produto/add_version_to_product_dialog.py` | 398, 405-406 | `response.get('success')`, `response['message']` |
| `gui/informacao_produto/add_files_to_version_dialog.py` | 289, 296-297 | `response.get('success')`, `response['message']` |
| `gui/adicionar_produto_historico/adicionar_produto_historico_dialog.py` | 507, 512-513 | `response.get('success')`, `response['message']` |

Adicionalmente, `core/api_client.py:74` agora verifica `"message"` corretamente (antes verificava `"mensagem"`).

### 2.2 Endpoint de Criacao de Produtos (CORRIGIDO)

**Bug anterior:** O plugin chamava `POST produtos/produto` (singular), mas o backend registra `POST /api/produtos/produtos` (plural).

**Status:** `gui/bulk_produtos/bulk_produtos_dialog.py:76` agora chama `produtos/produtos` corretamente.

### 2.3 Endpoints Inexistentes no Backend (CORRIGIDO)

**Bug anterior:** `GET /api/acervo/versao/{id}` e `GET /api/acervo/produto/{id}` nao existiam no backend.

**Status:** Ambos os endpoints foram criados:
- `GET /api/acervo/versao/:versao_id` — `server/src/acervo/acervo_route.js:62-76` com schema `acervo_schema.versaoByIdParams`
- `GET /api/acervo/produto/:produto_id` — `server/src/acervo/acervo_route.js:44-59` com schema `acervo_schema.produtoByIdParams`

O controlador `acervo_ctrl.getVersaoById()` retorna `v.nome AS nome_versao` e `v.produto_id`, e `acervo_ctrl.getProdutoById()` retorna `p.nome`, que correspondem aos campos acessados em `product_info_dialog.py:310-328`.

### 2.4 Download Situacao Geral (CORRIGIDO)

**Bug anterior:** `situacao_geral_dialog.py` usava `urllib.request` diretamente para baixar o ZIP.

**Status:** Agora utiliza `self.api_client.download_file('acervo/situacao-geral', ...)` (linha 71), que e um novo metodo adicionado ao `core/api_client.py:121-148`. O metodo `download_file()` inclui tratamento de erros HTTP padrao, streaming, e autenticacao via token.

### 2.5 Upload sem Verificacao de Falhas (CORRIGIDO)

**Bug anterior:** `file_transfer_complete` nao verificava se todos os arquivos foram transferidos com sucesso antes de chamar `confirm_upload`.

**Status:** Todos os dialogos de upload agora rastreiam `self.arquivos_com_falha` e recusam confirmar o upload se houver falhas. Exemplo em `adicionar_produto_dialog.py:744-756`:

```python
if self.arquivos_com_falha > 0:
    QMessageBox.critical(self, "Erro de Transferencia", ...)
    # NAO chama confirm_upload
else:
    self.confirm_upload()
```

O mesmo padrao esta implementado em:
- `bulk_carrega_versoes_arquivos_dialog.py:352-356`
- `bulk_carrega_arquivos_dialog.py:262-266`
- `bulk_carrega_produtos_versoes_arquivos_dialog.py:389-393`
- `informacao_produto/add_files_to_version_dialog.py:265-269`
- `informacao_produto/add_version_to_product_dialog.py:374-378`

### 2.6 Dashboard Mapoteca Nao Montado (CORRIGIDO)

**Bug anterior:** O modulo de dashboard da mapoteca nao estava montado em `routes.js`.

**Status:** Agora esta montado em `routes.js:47`:
```javascript
router.use("/mapoteca/dashboard", dashboardRoute);
```

---

## 3. Novas Funcionalidades Adicionadas Desde a Ultima Analise

### 3.1 Metodo `download_file()` no APIClient

O `core/api_client.py:121-148` agora possui um metodo dedicado para downloads binarios:
- Usa `requests.get()` com `stream=True`
- Salva em arquivo via `iter_content(chunk_size=8192)`
- Inclui tratamento de erros HTTP padrao
- Utilizado por `situacao_geral_dialog.py` e `download_manager.py`

### 3.2 Edicao de Relacionamentos

O plugin agora suporta edicao de relacionamentos entre versoes via `PUT produtos/versao_relacionamento`:
- **Arquivo:** `gui/informacao_produto/relationship_edit_dialog.py:97`
- **Backend:** `PUT /api/produtos/versao_relacionamento` com schema `versaoRelacionamentoAtualizacao`
- O plugin envia `{ versao_relacionamento: [{ id, versao_id_1, versao_id_2, tipo_relacionamento_id }] }`

### 3.3 Retries com Backoff Exponencial no FileTransfer

`core/file_transfer.py` agora inclui ate 3 tentativas com backoff exponencial (2s, 4s, 8s) para transferencias de arquivo.

---

## 4. Mapeamento Completo: Chamadas do Plugin vs Endpoints do Backend

### Legenda
- OK: Endpoint existe e parametros correspondem

### 4.1 Autenticacao

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `login` | POST | `POST /api/login` | OK |

### 4.2 Dominios (Gerencia)

| Plugin Chama | Metodo | Backend | Utilizado em |
|---|---|---|---|
| `gerencia/dominio/tipo_escala` | GET | `GET /api/gerencia/dominio/tipo_escala` | OK — adicionar_produto, adicionar_produto_historico, product_edit |
| `gerencia/dominio/tipo_produto` | GET | `GET /api/gerencia/dominio/tipo_produto` | OK — adicionar_produto, adicionar_produto_historico, product_edit, edit_volume_tipo_produto |
| `gerencia/dominio/tipo_versao` | GET | `GET /api/gerencia/dominio/tipo_versao` | OK — adicionar_produto, version_edit, add_version_to_product |
| `gerencia/dominio/subtipo_produto` | GET | `GET /api/gerencia/dominio/subtipo_produto` | OK — adicionar_produto, adicionar_produto_historico, version_edit, add_version_to_product, add_historical_version |
| `gerencia/dominio/tipo_arquivo` | GET | `GET /api/gerencia/dominio/tipo_arquivo` | OK — adicionar_produto, download_produtos, file_edit, add_version_to_product, add_files_to_version |
| `gerencia/dominio/situacao_carregamento` | GET | `GET /api/gerencia/dominio/situacao_carregamento` | OK — file_edit |
| `gerencia/dominio/tipo_status_arquivo` | GET | `GET /api/gerencia/dominio/tipo_status_arquivo` | OK — file_edit |
| `gerencia/dominio/tipo_status_execucao` | GET | `GET /api/gerencia/dominio/tipo_status_execucao` | OK — edit_project, edit_lote |
| `gerencia/dominio/tipo_relacionamento` | GET | `GET /api/gerencia/dominio/tipo_relacionamento` | OK — relationship_edit |

### 4.3 Acervo

| Plugin Chama | Metodo | Backend | Utilizado em |
|---|---|---|---|
| `acervo/camadas_produto` | GET | `GET /api/acervo/camadas_produto` | OK — load_product_layers, load_products |
| `acervo/produto/detalhado/{id}` | GET | `GET /api/acervo/produto/detalhado/:produto_id` | OK — product_info |
| `acervo/versao/{id}` | GET | `GET /api/acervo/versao/:versao_id` | OK — product_info (relacionamentos) |
| `acervo/produto/{id}` | GET | `GET /api/acervo/produto/:produto_id` | OK — product_info (relacionamentos) |
| `acervo/situacao-geral` | GET (binario) | `GET /api/acervo/situacao-geral` | OK — situacao_geral (via download_file) |
| `acervo/prepare-download/produtos` | POST | `POST /api/acervo/prepare-download/produtos` | OK — download_manager |
| `acervo/prepare-download/arquivos` | POST | `POST /api/acervo/prepare-download/arquivos` | OK — product_info |
| `acervo/confirm-download` | POST | `POST /api/acervo/confirm-download` | OK — download_manager |
| `acervo/cleanup-expired-downloads` | POST | `POST /api/acervo/cleanup-expired-downloads` | OK — cleanup_expired_downloads |
| `acervo/refresh_materialized_views` | POST | `POST /api/acervo/refresh_materialized_views` | OK — refresh_materialized_views |
| `acervo/create_materialized_views` | POST | `POST /api/acervo/create_materialized_views` | OK — create_materialized_view |

### 4.4 Arquivo (Upload/Download)

| Plugin Chama | Metodo | Backend | Utilizado em |
|---|---|---|---|
| `arquivo/prepare-upload/product` | POST | `POST /api/arquivo/prepare-upload/product` | OK — adicionar_produto, bulk_carrega_produtos_versoes_arquivos |
| `arquivo/prepare-upload/version` | POST | `POST /api/arquivo/prepare-upload/version` | OK — add_version_to_product, bulk_carrega_versoes_arquivos |
| `arquivo/prepare-upload/files` | POST | `POST /api/arquivo/prepare-upload/files` | OK — add_files_to_version, bulk_carrega_arquivos |
| `arquivo/confirm-upload` | POST | `POST /api/arquivo/confirm-upload` | OK — todos os dialogos de upload |
| `arquivo/arquivo` | PUT | `PUT /api/arquivo/arquivo` | OK — file_edit |
| `arquivo/arquivo` | DELETE | `DELETE /api/arquivo/arquivo` | OK — admin_actions |
| `arquivo/problem-uploads` | GET | `GET /api/arquivo/problem-uploads` | OK — problem_uploads |

### 4.5 Produtos

| Plugin Chama | Metodo | Backend | Utilizado em |
|---|---|---|---|
| `produtos/produtos` | POST | `POST /api/produtos/produtos` | OK — bulk_produtos |
| `produtos/produto` | PUT | `PUT /api/produtos/produto` | OK — product_edit |
| `produtos/produto` | DELETE | `DELETE /api/produtos/produto` | OK — admin_actions |
| `produtos/versao` | PUT | `PUT /api/produtos/versao` | OK — version_edit |
| `produtos/versao` | DELETE | `DELETE /api/produtos/versao` | OK — admin_actions |
| `produtos/versao_historica` | POST | `POST /api/produtos/versao_historica` | OK — bulk_versoes_historicas |
| `produtos/produto_versao_historica` | POST | `POST /api/produtos/produto_versao_historica` | OK — add_historical_version, adicionar_produto_historico, bulk_produtos_versoes_historicas |
| `produtos/versao_relacionamento` | POST | `POST /api/produtos/versao_relacionamento` | OK — bulk_versao_relacionamento |
| `produtos/versao_relacionamento` | PUT | `PUT /api/produtos/versao_relacionamento` | OK — relationship_edit |
| `produtos/versao_relacionamento` | DELETE | `DELETE /api/produtos/versao_relacionamento` | OK — product_info |

### 4.6 Projetos e Lotes

| Plugin Chama | Metodo | Backend | Utilizado em |
|---|---|---|---|
| `projetos/projeto` | GET | `GET /api/projetos/projeto` | OK — manage_projects, edit_lote |
| `projetos/projeto` | POST | `POST /api/projetos/projeto` | OK — edit_project |
| `projetos/projeto` | PUT | `PUT /api/projetos/projeto` | OK — edit_project |
| `projetos/projeto` | DELETE | `DELETE /api/projetos/projeto` | OK — manage_projects |
| `projetos/lote` | GET | `GET /api/projetos/lote` | OK — manage_lotes, adicionar_produto, version_edit, add_version_to_product, add_historical_version, adicionar_produto_historico |
| `projetos/lote` | POST | `POST /api/projetos/lote` | OK — edit_lote |
| `projetos/lote` | PUT | `PUT /api/projetos/lote` | OK — edit_lote |
| `projetos/lote` | DELETE | `DELETE /api/projetos/lote` | OK — manage_lotes |

### 4.7 Volumes

| Plugin Chama | Metodo | Backend | Utilizado em |
|---|---|---|---|
| `volumes/volume_armazenamento` | GET | `GET /api/volumes/volume_armazenamento` | OK — manage_volumes, file_edit, edit_volume_tipo_produto |
| `volumes/volume_armazenamento` | POST | `POST /api/volumes/volume_armazenamento` | OK — edit_volume |
| `volumes/volume_armazenamento` | PUT | `PUT /api/volumes/volume_armazenamento` | OK — edit_volume |
| `volumes/volume_armazenamento` | DELETE | `DELETE /api/volumes/volume_armazenamento` | OK — manage_volumes |
| `volumes/volume_tipo_produto` | GET | `GET /api/volumes/volume_tipo_produto` | OK — manage_volume_tipo_produto |
| `volumes/volume_tipo_produto` | POST | `POST /api/volumes/volume_tipo_produto` | OK — edit_volume_tipo_produto |
| `volumes/volume_tipo_produto` | PUT | `PUT /api/volumes/volume_tipo_produto` | OK — edit_volume_tipo_produto |
| `volumes/volume_tipo_produto` | DELETE | `DELETE /api/volumes/volume_tipo_produto` | OK — manage_volume_tipo_produto |

### 4.8 Usuarios

| Plugin Chama | Metodo | Backend | Utilizado em |
|---|---|---|---|
| `usuarios` | GET | `GET /api/usuarios/` | OK — manage_users |
| `usuarios` | POST | `POST /api/usuarios/` | OK — manage_users (importar usuarios) |
| `usuarios` | PUT | `PUT /api/usuarios/` | OK — manage_users (atualizacao em lote) |
| `usuarios/servico_autenticacao` | GET | `GET /api/usuarios/servico_autenticacao` | OK — manage_users (listar usuarios do auth server) |
| `usuarios/sincronizar` | PUT | `PUT /api/usuarios/sincronizar` | OK — manage_users |

### 4.9 Gerencia (Admin)

| Plugin Chama | Metodo | Backend | Utilizado em |
|---|---|---|---|
| `gerencia/verificar_inconsistencias` | POST | `POST /api/gerencia/verificar_inconsistencias` | OK — verificar_inconsistencias |
| `gerencia/arquivos_deletados` | GET | `GET /api/gerencia/arquivos_deletados` | OK — arquivos_deletados (com paginacao via query params) |
| `gerencia/arquivos_incorretos` | GET | `GET /api/gerencia/arquivos_incorretos` | OK — manage_incorrect_files (com paginacao via query params) |

---

## 5. Formato de Resposta da API

O backend utiliza o middleware `sendJsonAndLog` (`server/src/utils/send_json_and_log.js`) que gera respostas no formato:

```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Descricao da operacao",
  "dados": { ... }
}
```

Quando metadata adicional e fornecida (ex: paginacao), os campos sao adicionados ao nivel raiz:

```json
{
  "version": "1.0.0",
  "success": true,
  "message": "...",
  "dados": [ ... ],
  "pagination": { "total": 100, "page": 1, "limit": 20 }
}
```

O plugin acessa consistentemente:
- `response.get('success')` para verificar sucesso
- `response['dados']` para extrair dados
- `response['message']` para mensagens de erro
- `response.get('pagination', {})` para dados de paginacao (arquivos_deletados, arquivos_incorretos)

---

## 6. Endpoints do Backend NAO Utilizados pelo Plugin QGIS

Estes endpoints existem no backend mas nao sao chamados pelo plugin. Sao utilizados pelos clientes web (React).

### 6.1 Endpoints Exclusivos dos Clientes Web

| Endpoint | Modulo | Utilizado por |
|---|---|---|
| `GET /api/gerencia/dominio/tipo_posto_grad` | Gerencia | Nenhum cliente atualmente |
| `GET /api/produtos/versao_relacionamento` | Produtos | Nenhum cliente atualmente (plugin extrai dados do produto detalhado) |
| `PUT /api/usuarios/:uuid` | Usuarios | Nenhum cliente atualmente (plugin usa atualizacao em lote) |

### 6.2 Dashboard Principal do Acervo (17 endpoints)

O modulo `server/src/dashboard/` contem 17 endpoints de dashboard para o client React principal (`client/`):

| Endpoint | Descricao |
|---|---|
| `GET /api/dashboard/produtos_total` | Total de produtos |
| `GET /api/dashboard/arquivos_total_gb` | Total de armazenamento em GB |
| `GET /api/dashboard/usuarios_total` | Total de usuarios |
| `GET /api/dashboard/produtos_tipo` | Produtos por tipo |
| `GET /api/dashboard/gb_tipo_produto` | GB por tipo de produto |
| `GET /api/dashboard/gb_volume` | GB por volume |
| `GET /api/dashboard/arquivos_dia` | Arquivos carregados por dia |
| `GET /api/dashboard/downloads_dia` | Downloads por dia |
| `GET /api/dashboard/ultimos_carregamentos` | Ultimos carregamentos |
| `GET /api/dashboard/ultimas_modificacoes` | Ultimas modificacoes |
| `GET /api/dashboard/ultimos_deletes` | Ultimas exclusoes |
| `GET /api/dashboard/download` | Historico de downloads |
| `GET /api/dashboard/produto_activity_timeline` | Timeline de atividade (com param `months`) |
| `GET /api/dashboard/version_statistics` | Estatisticas de versoes |
| `GET /api/dashboard/storage_growth_trends` | Tendencias de crescimento (com param `months`) |
| `GET /api/dashboard/project_status_summary` | Status de projetos |
| `GET /api/dashboard/user_activity_metrics` | Metricas de atividade (com param `limit`) |

**NOTA:** Este modulo de dashboard **NAO esta montado** em `routes.js`. O arquivo `routes.js` importa o `dashboardRoute` do modulo `mapoteca/` (que e o dashboard da mapoteca), mas nao importa nem monta o modulo `server/src/dashboard/`. Isso afeta o cliente React principal (`client/src/services/dashboardService.ts`), que tenta acessar `/api/dashboard/*` e recebera 404. Nao afeta o plugin QGIS.

### 6.3 Mapoteca (42+ endpoints)

Todos os endpoints da mapoteca (`/api/mapoteca/*`) sao utilizados exclusivamente pelo `client_admin_mapoteca/` (React). O plugin QGIS nao interage com a mapoteca.

Inclui operacoes CRUD para:
- Clientes (`/api/mapoteca/cliente`)
- Pedidos (`/api/mapoteca/pedido`)
- Produtos de pedido (`/api/mapoteca/produto_pedido`)
- Plotters (`/api/mapoteca/plotter`)
- Manutencao de plotters (`/api/mapoteca/manutencao_plotter`)
- Tipos de material (`/api/mapoteca/tipo_material`)
- Estoque de material (`/api/mapoteca/estoque_material`)
- Consumo de material (`/api/mapoteca/consumo_material`)
- Dominios da mapoteca (`/api/mapoteca/dominio/*`)

### 6.4 Dashboard da Mapoteca (8 endpoints)

Os endpoints em `/api/mapoteca/dashboard/*` sao exclusivos do `client_admin_mapoteca/`:

| Endpoint | Descricao |
|---|---|
| `GET /api/mapoteca/dashboard/order_status` | Distribuicao de status de pedidos |
| `GET /api/mapoteca/dashboard/orders_timeline` | Timeline de pedidos |
| `GET /api/mapoteca/dashboard/avg_fulfillment_time` | Tempo medio de atendimento |
| `GET /api/mapoteca/dashboard/client_activity` | Atividade de clientes |
| `GET /api/mapoteca/dashboard/pending_orders` | Pedidos pendentes |
| `GET /api/mapoteca/dashboard/stock_by_location` | Estoque por localizacao |
| `GET /api/mapoteca/dashboard/material_consumption` | Consumo de materiais |
| `GET /api/mapoteca/dashboard/plotter_status` | Status de plotters |

---

## 7. Problema Pendente (Nao Afeta Plugin)

### 7.1 Dashboard Principal do Acervo Nao Montado em routes.js

**Severidade: MEDIA** | **Impacto: Cliente React principal**

O modulo `server/src/dashboard/` (17 endpoints) nao e importado nem montado em `server/src/routes.js`. O cliente React principal (`client/src/services/dashboardService.ts`) chama estes endpoints e recebera 404.

**Correcao necessaria:** Adicionar em `routes.js`:
```javascript
const { dashboardRoute: acervoDashboardRoute } = require("./dashboard");
// ...
router.use("/dashboard", acervoDashboardRoute);
```

**Nota:** Isso nao afeta o plugin QGIS, que nao utiliza nenhum endpoint de dashboard.

---

## 8. Resumo

| Categoria | Quantidade | Status |
|---|---|---|
| Bugs criticos anteriores | 5 | Todos CORRIGIDOS |
| Problemas menores anteriores | 3 | Todos CORRIGIDOS |
| Bugs Plugin <-> Backend atuais | 0 | Nenhum |
| Endpoints do plugin com correspondencia | 50 | 100% OK |
| Problema pendente (React only) | 1 | Dashboard nao montado |

---
