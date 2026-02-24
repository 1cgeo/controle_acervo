# Analise de Lacunas: Plugin QGIS vs Backend API

Este documento apresenta uma analise completa do cruzamento entre as chamadas HTTP feitas pelo plugin QGIS (`ferramentas_acervo/`) e os endpoints disponiveis no backend (`server/`), identificando incompatibilidades, endpoints ausentes e problemas de integracao.

---

## 1. Bugs Criticos de Integracao

### 1.1 Nomes de Campos da Resposta Incompativeis

**Severidade: CRITICA** | **Impacto: 11+ dialogos afetados**

O backend retorna respostas com os campos `success` e `message` (ingles), mas multiplos dialogos do plugin verificam `sucesso` e `mensagem` (portugues). Isso faz com que esses dialogos **nunca detectem sucesso corretamente**, sempre caindo no branch de erro.

**Resposta real do backend:**
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Operacao realizada com sucesso",
  "dados": { ... }
}
```

**Verificacao feita pelo plugin (incorreta):**
```python
if response and 'sucesso' in response and response['sucesso']:
    # nunca entra aqui
```

**Arquivos afetados:**

| Arquivo | Linhas |
|---|---|
| `gui/adicionar_produto/adicionar_produto_dialog.py` | 753, 760 |
| `gui/adicionar_produto_historico/adicionar_produto_historico_dialog.py` | 507, 513 |
| `gui/bulk_carrega_versoes_arquivos/bulk_carrega_versoes_arquivos_dialog.py` | 360, 368 |
| `gui/bulk_carrega_arquivos/bulk_carrega_arquivos_dialog.py` | 270, 278 |
| `gui/bulk_carrega_produtos_versoes_arquivos/bulk_carrega_produtos_versoes_arquivos_dialog.py` | 397, 405 |
| `gui/bulk_versao_relacionamento/bulk_versao_relacionamento_dialog.py` | 77, 85 |
| `gui/bulk_produtos/bulk_produtos_dialog.py` | 78, 86 |
| `gui/bulk_produtos_versoes_historicas/bulk_produtos_versoes_historicas_dialog.py` | 79, 87 |
| `gui/bulk_versoes_historicas/bulk_versoes_historicas_dialog.py` | 79, 87 |
| `gui/informacao_produto/add_historical_version_dialog.py` | 135, 141 |
| `gui/informacao_produto/add_version_to_product_dialog.py` | 383, 391 |
| `gui/informacao_produto/add_files_to_version_dialog.py` | 274, 282 |

**Correcao necessaria:** Trocar `'sucesso'` por `'success'` e `'mensagem'` por `'message'` em todos os dialogos, ou criar uma camada de traducao no `api_client.py`.

Nota: O mesmo problema existe no tratamento de erros HTTP do `api_client.py` (linha 74), que verifica `"mensagem"` em vez de `"message"`:
```python
# core/api_client.py:74 - incorreto
if "mensagem" in response_json:
    error_msg = response_json["mensagem"]
# deveria ser:
if "message" in response_json:
    error_msg = response_json["message"]
```

---

### 1.2 Endpoint de Criacao de Produtos com Path Incorreto

**Severidade: CRITICA** | **Impacto: Criacao em massa de produtos nao funciona**

O plugin chama `POST /api/produtos/produto` (singular), mas o backend registra o endpoint de criacao em massa como `POST /api/produtos/produtos` (plural). O resultado sera um erro 404.

| | Plugin | Backend |
|---|---|---|
| **Path** | `POST /api/produtos/produto` | `POST /api/produtos/produtos` |
| **Arquivo** | `gui/bulk_produtos/bulk_produtos_dialog.py:76` | `server/src/produto/produto_route.js:99-112` |

**Correcao necessaria:** Alterar a chamada no plugin de `'produtos/produto'` para `'produtos/produtos'`.

---

### 1.3 Endpoints Inexistentes no Backend

**Severidade: CRITICA** | **Impacto: Arvore de relacionamentos na tela de informacoes do produto**

O dialogo `product_info_dialog.py` faz chamadas a dois endpoints que **nao existem** no backend:

| Chamada no Plugin | Existe no Backend? | Arquivo/Linha |
|---|---|---|
| `GET /api/acervo/versao/{version_id}` | **NAO** | `product_info_dialog.py:310` |
| `GET /api/acervo/produto/{product_id}` | **NAO** | `product_info_dialog.py:316` |

Estes endpoints sao usados na funcao `get_version_product_info()` para popular a arvore de relacionamentos com nomes de produtos e versoes relacionados. Ambos retornarao 404.

**Endpoint similar existente:** `GET /api/acervo/produto/detalhado/{produto_id}` (retorna produto com todas as versoes).

**Correcao necessaria:** Criar os endpoints no backend ou adaptar o plugin para usar `acervo/produto/detalhado/{product_id}` e extrair os dados da versao a partir da resposta completa.

---

## 2. Problemas Menores

### 2.1 Situacao Geral - Construcao Manual de URL

O dialogo `situacao_geral_dialog.py` constroi a URL manualmente usando `urllib.request` em vez de usar o `api_client`, pois o endpoint retorna um arquivo ZIP (binario) em vez de JSON. Isso funciona, mas:

- Nao se beneficia do tratamento de erros HTTP padrao do `api_client`
- Nao se beneficia de eventuais interceptors futuros
- A URL e construida concatenando `self.api_client.base_url` diretamente (linha 64)

**Arquivo:** `gui/situacao_geral/situacao_geral_dialog.py:64-90`

### 2.2 Upload - Verificacao de Sucesso da Transferencia Incompleta

No fluxo de upload (`adicionar_produto_dialog.py`), a funcao `file_transfer_complete` (linha 736) conta os arquivos transferidos mas **nao verifica se todos tiveram sucesso** antes de chamar `confirm_upload`. Se um arquivo falhar na transferencia, o upload e confirmado mesmo assim, delegando ao backend a deteccao do problema.

**Arquivo:** `gui/adicionar_produto/adicionar_produto_dialog.py:736-743`

---

## 3. Mapeamento Completo: Chamadas do Plugin vs Endpoints do Backend

### Legenda
- OK: Endpoint existe e parametros correspondem
- BUG: Incompatibilidade identificada
- AUSENTE: Endpoint nao existe no backend

### 3.1 Autenticacao

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `login` | POST | `POST /api/login` | OK |

### 3.2 Dominios (Gerencia)

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `gerencia/dominio/tipo_escala` | GET | `GET /api/gerencia/dominio/tipo_escala` | OK |
| `gerencia/dominio/tipo_produto` | GET | `GET /api/gerencia/dominio/tipo_produto` | OK |
| `gerencia/dominio/tipo_versao` | GET | `GET /api/gerencia/dominio/tipo_versao` | OK |
| `gerencia/dominio/subtipo_produto` | GET | `GET /api/gerencia/dominio/subtipo_produto` | OK |
| `gerencia/dominio/tipo_arquivo` | GET | `GET /api/gerencia/dominio/tipo_arquivo` | OK |
| `gerencia/dominio/situacao_carregamento` | GET | `GET /api/gerencia/dominio/situacao_carregamento` | OK |
| `gerencia/dominio/tipo_status_arquivo` | GET | `GET /api/gerencia/dominio/tipo_status_arquivo` | OK |
| `gerencia/dominio/tipo_status_execucao` | GET | `GET /api/gerencia/dominio/tipo_status_execucao` | OK |
| `gerencia/dominio/tipo_relacionamento` | GET | `GET /api/gerencia/dominio/tipo_relacionamento` | OK |
| `gerencia/dominio/tipo_posto_grad` | GET | `GET /api/gerencia/dominio/tipo_posto_grad` | **NAO UTILIZADO** pelo plugin |

### 3.3 Acervo

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `acervo/camadas_produto` | GET | `GET /api/acervo/camadas_produto` | OK |
| `acervo/produto/detalhado/{id}` | GET | `GET /api/acervo/produto/detalhado/:produto_id` | OK |
| `acervo/versao/{id}` | GET | *(nao existe)* | **AUSENTE** |
| `acervo/produto/{id}` | GET | *(nao existe)* | **AUSENTE** |
| `acervo/prepare-download/produtos` | POST | `POST /api/acervo/prepare-download/produtos` | OK |
| `acervo/prepare-download/arquivos` | POST | `POST /api/acervo/prepare-download/arquivos` | OK |
| `acervo/confirm-download` | POST | `POST /api/acervo/confirm-download` | OK |
| `acervo/cleanup-expired-downloads` | POST | `POST /api/acervo/cleanup-expired-downloads` | OK |
| `acervo/refresh_materialized_views` | POST | `POST /api/acervo/refresh_materialized_views` | OK |
| `acervo/create_materialized_views` | POST | `POST /api/acervo/create_materialized_views` | OK |
| `acervo/situacao-geral` | GET | `GET /api/acervo/situacao-geral` | OK (via urllib) |

### 3.4 Arquivo (Upload/Download)

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `arquivo/prepare-upload/product` | POST | `POST /api/arquivo/prepare-upload/product` | OK |
| `arquivo/prepare-upload/version` | POST | `POST /api/arquivo/prepare-upload/version` | OK |
| `arquivo/prepare-upload/files` | POST | `POST /api/arquivo/prepare-upload/files` | OK |
| `arquivo/confirm-upload` | POST | `POST /api/arquivo/confirm-upload` | OK |
| `arquivo/arquivo` | PUT | `PUT /api/arquivo/arquivo` | OK |
| `arquivo/arquivo` | DELETE | `DELETE /api/arquivo/arquivo` | OK |
| `arquivo/problem-uploads` | GET | `GET /api/arquivo/problem-uploads` | OK |

### 3.5 Produtos

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `produtos/produto` | POST | `POST /api/produtos/produtos` | **BUG** (path incorreto) |
| `produtos/produto` | PUT | `PUT /api/produtos/produto` | OK |
| `produtos/produto` | DELETE | `DELETE /api/produtos/produto` | OK |
| `produtos/versao` | PUT | `PUT /api/produtos/versao` | OK |
| `produtos/versao` | DELETE | `DELETE /api/produtos/versao` | OK |
| `produtos/versao_historica` | POST | `POST /api/produtos/versao_historica` | OK |
| `produtos/produto_versao_historica` | POST | `POST /api/produtos/produto_versao_historica` | OK |
| `produtos/versao_relacionamento` | POST | `POST /api/produtos/versao_relacionamento` | OK |
| `produtos/versao_relacionamento` | DELETE | `DELETE /api/produtos/versao_relacionamento` | OK |
| `produtos/versao_relacionamento` | GET | `GET /api/produtos/versao_relacionamento` | **NAO UTILIZADO** pelo plugin |
| `produtos/versao_relacionamento` | PUT | `PUT /api/produtos/versao_relacionamento` | **NAO UTILIZADO** pelo plugin |

### 3.6 Projetos e Lotes

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `projetos/projeto` | GET | `GET /api/projetos/projeto` | OK |
| `projetos/projeto` | POST | `POST /api/projetos/projeto` | OK |
| `projetos/projeto` | PUT | `PUT /api/projetos/projeto` | OK |
| `projetos/projeto` | DELETE | `DELETE /api/projetos/projeto` | OK |
| `projetos/lote` | GET | `GET /api/projetos/lote` | OK |
| `projetos/lote` | POST | `POST /api/projetos/lote` | OK |
| `projetos/lote` | PUT | `PUT /api/projetos/lote` | OK |
| `projetos/lote` | DELETE | `DELETE /api/projetos/lote` | OK |

### 3.7 Volumes

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `volumes/volume_armazenamento` | GET | `GET /api/volumes/volume_armazenamento` | OK |
| `volumes/volume_armazenamento` | POST | `POST /api/volumes/volume_armazenamento` | OK |
| `volumes/volume_armazenamento` | PUT | `PUT /api/volumes/volume_armazenamento` | OK |
| `volumes/volume_armazenamento` | DELETE | `DELETE /api/volumes/volume_armazenamento` | OK |
| `volumes/volume_tipo_produto` | GET | `GET /api/volumes/volume_tipo_produto` | OK |
| `volumes/volume_tipo_produto` | POST | `POST /api/volumes/volume_tipo_produto` | OK |
| `volumes/volume_tipo_produto` | PUT | `PUT /api/volumes/volume_tipo_produto` | OK |
| `volumes/volume_tipo_produto` | DELETE | `DELETE /api/volumes/volume_tipo_produto` | OK |

### 3.8 Usuarios

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `usuarios` | GET | `GET /api/usuarios/` | OK |
| `usuarios` | POST | `POST /api/usuarios/` | OK |
| `usuarios` | PUT | `PUT /api/usuarios/` | OK |
| `usuarios/servico_autenticacao` | GET | `GET /api/usuarios/servico_autenticacao` | OK |
| `usuarios/sincronizar` | PUT | `PUT /api/usuarios/sincronizar` | OK |
| `usuarios/:uuid` | PUT | `PUT /api/usuarios/:uuid` | **NAO UTILIZADO** pelo plugin |

### 3.9 Gerencia (Admin)

| Plugin Chama | Metodo | Backend | Status |
|---|---|---|---|
| `gerencia/verificar_inconsistencias` | POST | `POST /api/gerencia/verificar_inconsistencias` | OK |
| `gerencia/arquivos_deletados` | GET | `GET /api/gerencia/arquivos_deletados` | OK |
| `gerencia/arquivos_incorretos` | GET | `GET /api/gerencia/arquivos_incorretos` | OK |

---

## 4. Endpoints do Backend NAO Utilizados pelo Plugin QGIS

Estes endpoints existem no backend mas nao sao chamados pelo plugin. Muitos sao utilizados pelos clientes web (React).

### 4.1 Endpoints Exclusivos dos Clientes Web

| Endpoint | Modulo | Usado por |
|---|---|---|
| `GET /api/gerencia/dominio/tipo_posto_grad` | Gerencia | Apenas client web |
| `GET /api/produtos/versao_relacionamento` | Produtos | Apenas client web |
| `PUT /api/produtos/versao_relacionamento` | Produtos | Apenas client web |
| `PUT /api/usuarios/:uuid` | Usuarios | Apenas client web |

### 4.2 Dashboard do Acervo (17 endpoints - nao montados)

O modulo `server/src/dashboard/` contem 17 endpoints de dashboard mas **nao estao montados** em `routes.js`. Nao sao utilizados por nenhum cliente.

### 4.3 Mapoteca (42 endpoints)

Todos os endpoints da mapoteca (`/api/mapoteca/*`) sao utilizados exclusivamente pelo `client_admin_mapoteca/` (React). O plugin QGIS nao interage com a mapoteca.

### 4.4 Dashboard da Mapoteca (8 endpoints)

Todos os endpoints em `/api/mapoteca/dashboard/*` sao exclusivos do `client_admin_mapoteca/`.

---

## 5. Resumo de Acoes Necessarias

### Prioridade Alta (Bugs que impedem funcionamento)

| # | Descricao | Acao | Escopo |
|---|---|---|---|
| 1 | Campo `sucesso`/`mensagem` vs `success`/`message` | Corrigir nos 12 dialogos do plugin ou normalizar no `api_client.py` | Plugin |
| 2 | Campo `mensagem` no error handler do api_client | Corrigir para `message` em `api_client.py:74` | Plugin |
| 3 | Path `produtos/produto` vs `produtos/produtos` (POST) | Corrigir no `bulk_produtos_dialog.py:76` | Plugin |
| 4 | Endpoint `GET acervo/versao/{id}` inexistente | Criar no backend ou adaptar plugin | Backend ou Plugin |
| 5 | Endpoint `GET acervo/produto/{id}` inexistente | Criar no backend ou adaptar plugin | Backend ou Plugin |

### Prioridade Media (Melhorias recomendadas)

| # | Descricao | Acao |
|---|---|---|
| 6 | Download situacao-geral usa urllib direto | Considerar adicionar suporte a respostas binarias no `api_client` |
| 7 | Upload nao verifica sucesso individual antes de confirmar | Adicionar verificacao e relatorio de falhas parciais |
| 8 | Dashboard do acervo nao montado | Adicionar import e `router.use()` em `routes.js` se necessario |

### Prioridade Baixa (Funcionalidades nao implementadas no plugin)

| # | Descricao | Observacao |
|---|---|---|
| 9 | Edicao de relacionamentos (PUT versao_relacionamento) | Plugin so cria e deleta; nao edita |
| 10 | Listagem de relacionamentos (GET versao_relacionamento) | Plugin extrai dos dados do produto detalhado |
| 11 | Atualizacao individual de usuario (PUT /usuarios/:uuid) | Plugin usa atualizacao em lote |

---

## 6. Estatisticas

| Metrica | Valor |
|---|---|
| Total de chamadas unicas do plugin | ~45 |
| Chamadas com match correto no backend | 40 |
| Bugs criticos de integracao | 5 |
| Endpoints do backend usados pelo plugin | ~40 de 101 montados |
| Endpoints exclusivos dos clientes web | ~61 |
