# Sistema de Controle do Acervo (SCA) - Documentacao da API

## Visao Geral

A API do SCA e um servico RESTful para gestao de acervos de dados geoespaciais, desenvolvido pelo Servico Geografico do Exercito Brasileiro (DSG/1CGEO). A API gerencia produtos geograficos versionados (cartas, ortoimagens, modelos digitais de elevacao etc.), seus arquivos, volumes de armazenamento e uma mapoteca fisica para atendimento de pedidos.

**URL Base**: Todos os endpoints sao prefixados com `/api`

**Documentacao Swagger**: Disponivel em `GET /api/api_docs` quando o servidor esta em execucao.

## Formato Padrao de Resposta

Todas as respostas seguem esta estrutura JSON:

```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Mensagem descritiva",
  "dados": {},
  "error": null
}
```

- `success`: `true` para sucesso, `false` para erro
- `dados`: Dados da resposta (objeto, array ou `null`)
- `error`: Detalhes do erro quando `success` e `false`
- Campos adicionais de metadados (ex: `pagination`) podem ser incluidos

## Autenticacao

A maioria dos endpoints requer autenticacao JWT. Apos o login, inclua o token no header Authorization:

```
Authorization: Bearer <jwt_token>
```

**Niveis de acesso:**

| Middleware | Descricao |
|---|---|
| Nenhum | Endpoint publico, sem autenticacao necessaria |
| `verifyLogin` | Requer JWT valido. Extrai `req.usuarioUuid`, `req.usuarioId`, `req.administrador` |
| `verifyAdmin` | Requer JWT valido + re-verifica status de administrador no banco de dados |

Tokens JWT expiram apos **1 hora**.

## Rate Limiting

- **200 requisicoes por 60 segundos** por IP

---

## 1. Health Check

### GET `/api/`

Verifica se o sistema esta operacional.

| Campo | Valor |
|---|---|
| **Auth** | Nenhuma |
| **Resposta** | `{ database_version: "x.y" }` |

---

## 2. Autenticacao (Login)

### POST `/api/login`

Autentica usuario via servidor de autenticacao externo e retorna token JWT.

| Campo | Valor |
|---|---|
| **Auth** | Nenhuma |

**Body:**
```json
{
  "usuario": "string (obrigatorio)",
  "senha": "string (obrigatorio)",
  "cliente": "sca_qgis | sca_web (obrigatorio)"
}
```

**Resposta:**
```json
{
  "dados": {
    "token": "eyJhbGciOi...",
    "administrador": true,
    "uuid": "123e4567-e89b-12d3-a456-426614174000"
  }
}
```

---

## 3. Acervo (Colecao)

### GET `/api/acervo/camadas_produto`

Retorna informacoes de camadas de todos os produtos a partir das views materializadas.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Resposta:** Array com `matviewname`, `tipo_produto`, `tipo_escala`, `quantidade_produtos` e informacoes de conexao ao banco (`banco_dados`).

---

### GET `/api/acervo/produto/detalhado/:produto_id`

Retorna informacoes completas de um produto incluindo todas as versoes, relacionamentos e arquivos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `produto_id` - integer (obrigatorio) |

**Resposta:** Objeto do produto com array aninhado de versoes, cada versao contendo relacionamentos e arquivos.

---

### GET `/api/acervo/produto/:produto_id`

Retorna informacoes basicas de um produto (sem versoes/arquivos).

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `produto_id` - integer (obrigatorio) |

**Resposta:**
```json
{
  "dados": {
    "id": 123,
    "nome": "string",
    "mi": "string",
    "inom": "string",
    "tipo_escala_id": 1,
    "denominador_escala_especial": null,
    "tipo_produto_id": 2,
    "descricao": "string",
    "geom": "geometry"
  }
}
```

---

### GET `/api/acervo/versao/:versao_id`

Retorna informacoes de uma versao especifica.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `versao_id` - integer (obrigatorio) |

**Resposta:**
```json
{
  "dados": {
    "id": 456,
    "uuid_versao": "uuid",
    "versao": "string",
    "nome_versao": "string",
    "tipo_versao_id": 1,
    "subtipo_produto_id": 2,
    "produto_id": 123,
    "lote_id": 10,
    "metadado": {},
    "descricao": "string",
    "orgao_produtor": "string",
    "palavras_chave": ["string"],
    "data_criacao": "date",
    "data_edicao": "date"
  }
}
```

---

### GET `/api/acervo/busca`

Busca produtos com filtros e paginacao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Query Params:**
| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `termo` | string | - | Termo de busca (filtra por nome, MI ou INOM via ILIKE) |
| `tipo_produto_id` | integer | - | Filtrar por tipo de produto |
| `tipo_escala_id` | integer | - | Filtrar por tipo de escala |
| `projeto_id` | integer | - | Filtrar por projeto |
| `lote_id` | integer | - | Filtrar por lote |
| `page` | integer | 1 | Numero da pagina (min 1) |
| `limit` | integer | 20 | Registros por pagina (min 1, max 100) |

**Resposta:**
```json
{
  "dados": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "dados": [
      {
        "id": 123,
        "nome": "string",
        "mi": "string",
        "inom": "string",
        "escala": "string",
        "tipo_escala_id": 1,
        "tipo_produto": "string",
        "tipo_produto_id": 2,
        "denominador_escala_especial": null,
        "descricao": "string",
        "data_cadastramento": "date",
        "data_modificacao": "date",
        "num_versoes": 3
      }
    ]
  }
}
```

---

### POST `/api/acervo/prepare-download/arquivos`

Prepara arquivos especificos para download, criando tokens de download validos por 24 horas.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Body:**
```json
{
  "arquivos_ids": [1234, 5678]
}
```
- `arquivos_ids`: array de inteiros (min 1, valores unicos, obrigatorio)

**Resposta:** Array com `arquivo_id`, `nome`, `download_path`, `checksum`, `download_token`.

---

### POST `/api/acervo/prepare-download/produtos`

Prepara download das versoes mais recentes dos produtos especificados, filtrados por tipos de arquivo.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Body:**
```json
{
  "produtos_ids": [123, 124],
  "tipos_arquivo": [1, 2]
}
```
- `produtos_ids`: array de inteiros (min 1, valores unicos, obrigatorio)
- `tipos_arquivo`: array de inteiros (min 1, valores unicos, obrigatorio)

**Resposta:** Array com informacoes de download e tokens.

---

### POST `/api/acervo/confirm-download`

Confirma o status de downloads realizados.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Body:**
```json
{
  "confirmations": [
    {
      "download_token": "uuid (obrigatorio)",
      "success": true,
      "error_message": "string (opcional)"
    }
  ]
}
```

**Resposta:** Array com status de confirmacao por token.

---

### POST `/api/acervo/cleanup-expired-downloads`

Executa limpeza de sessoes de download expiradas (mais de 24 horas).

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

---

### POST `/api/acervo/refresh_materialized_views`

Atualiza todas as views materializadas. Chama `acervo.refresh_all_materialized_views()`.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

---

### POST `/api/acervo/create_materialized_views`

Cria novas views materializadas. Chama `acervo.criar_views_materializadas()`.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

---

### GET `/api/acervo/situacao-geral`

Gera e retorna um arquivo ZIP contendo GeoJSONs com a situacao dos produtos para as escalas selecionadas.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Query Params:**
| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `scale25k` | boolean | false | Incluir escala 1:25.000 |
| `scale50k` | boolean | false | Incluir escala 1:50.000 |
| `scale100k` | boolean | false | Incluir escala 1:100.000 |
| `scale250k` | boolean | false | Incluir escala 1:250.000 |

Se nenhuma escala for selecionada, retorna todas. Resposta: arquivo ZIP (`application/zip`) com arquivos `situacao-geral-ct-{escala}.geojson`.

---

### GET `/api/acervo/export-planilha-csv`

Exporta o acervo no mesmo padrao da planilha de referencia (`Controle do Acervo - ASC 1º CGEO`): um arquivo CSV por escala e tipo de produto, com uma linha por versao. Util para conferencia cruzada com a planilha.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Query Params:**
| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `scale25k` | boolean | false | Incluir escala 1:25.000 |
| `scale50k` | boolean | false | Incluir escala 1:50.000 |
| `scale100k` | boolean | false | Incluir escala 1:100.000 |
| `scale250k` | boolean | false | Incluir escala 1:250.000 |

Se nenhuma escala for selecionada, retorna todas. Resposta: arquivo ZIP (`application/zip`) com arquivos `{T|O}{escala}.csv` (`T`=Carta Topografica, `O`=Carta Ortoimagem), ex.: `T250k.csv`, `O50k.csv`. Cada CSV (UTF-8 com BOM, CRLF) tem as colunas: `Cont_Edicao`, `MI`, `INOM`, `Tipo_Produto`, `Subtipo`, `Nome`, `Orgao_Produtor`, `EPSG`, `Ano_Dados`, `Ano_Edicao`, `Versao`, `Lote`, `Tem_Arquivo`. `Tem_Arquivo`=0 indica Registro Historico (sem arquivo).

---

## 4. Gerenciamento de Arquivos

### PUT `/api/arquivo/arquivo`

Atualiza metadados e informacoes de armazenamento de um arquivo.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "id": 1234,
  "nome": "string (obrigatorio)",
  "tipo_arquivo_id": 1,
  "volume_armazenamento_id": 1,
  "metadado": {},
  "tipo_status_id": 1,
  "situacao_carregamento_id": 2,
  "descricao": "string (obrigatorio, permite vazio)",
  "crs_original": "EPSG:31983 (opcional, max 10 chars)"
}
```

---

### DELETE `/api/arquivo/arquivo`

Move arquivos para tabela `arquivo_deletado` com motivo de exclusao. Tambem move downloads associados.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "arquivo_ids": [1234, 5678],
  "motivo_exclusao": "string (obrigatorio)"
}
```

---

### POST `/api/arquivo/prepare-upload/files`

Prepara sessao de upload para adicionar arquivos a versoes existentes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Body:**
```json
{
  "arquivos": [
    {
      "versao_id": 456,
      "uuid_arquivo": "uuid (opcional, permite null)",
      "nome": "string (obrigatorio)",
      "nome_arquivo": "string (obrigatorio)",
      "tipo_arquivo_id": 1,
      "extensao": "tif (obrigatorio exceto tipo 9)",
      "tamanho_mb": 2500.5,
      "checksum": "string (obrigatorio exceto tipo 9)",
      "metadado": {},
      "situacao_carregamento_id": 2,
      "descricao": "string (opcional)",
      "crs_original": "string (opcional)"
    }
  ]
}
```

**Resposta:** `{ session_uuid, operation_type: "add_files", arquivos: [...] }` com caminhos de destino.

---

### POST `/api/arquivo/prepare-upload/replace-files`

Prepara sessao para SUBSTITUIR o conteudo de arquivos em versoes existentes, sem criar nova versao (corrigir um PDF/GeoTIFF de uma edicao ja cadastrada). Mesmo corpo do `prepare-upload/files`. Semantica de **upsert por slot**: para cada arquivo, no `confirm-upload`, o que ocupa o slot `(versao_id, nome_arquivo, extensao)` e movido para `acervo.arquivo_deletado` e o novo e inserido, **atomicamente na mesma transacao**; se o slot estiver vazio, apenas insere. O `destination_path` e o mesmo do arquivo atual, entao a transferencia sobrescreve o fisico no lugar (sem orfao). Diferente do `prepare-upload/files`, **nao** rejeita por colisao de `(nome_arquivo, versao_id)`: arquivos irmaos de mesmo `nome_arquivo` (ex.: o `.json` de edicao) coexistem e ficam intocados ao substituir so o `.tif`/`.pdf`.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** identico ao `prepare-upload/files` (array `arquivos`, cada um com `versao_id`).

**Resposta:** `{ session_uuid, operation_type: "replace_files", arquivos: [...] }` com caminhos de destino.

---

### POST `/api/arquivo/prepare-upload/version`

Prepara sessao de upload para adicionar novas versoes com arquivos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Body:**
```json
{
  "versoes": [
    {
      "produto_id": 123,
      "versao": {
        "uuid_versao": "uuid (opcional, permite null)",
        "versao": "2-DSG",
        "nome": "Segunda Edicao",
        "tipo_versao_id": 1,
        "subtipo_produto_id": 2,
        "lote_id": 10,
        "metadado": {},
        "descricao": "string",
        "orgao_produtor": "string",
        "palavras_chave": ["string"],
        "data_criacao": "2024-01-15",
        "data_edicao": "2024-03-20"
      },
      "arquivos": [
        { "...mesma estrutura de prepare-upload/files, exceto sem versao_id" }
      ]
    }
  ]
}
```

**Resposta:** `{ session_uuid, operation_type: "add_version", versoes: [...] }`

---

### POST `/api/arquivo/prepare-upload/product`

Prepara sessao de upload para criar produtos completos com versoes e arquivos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Body:**
```json
{
  "produtos": [
    {
      "produto": {
        "nome": "string",
        "mi": "string",
        "inom": "string",
        "tipo_escala_id": 1,
        "denominador_escala_especial": null,
        "tipo_produto_id": 2,
        "descricao": "string (opcional)",
        "geom": "SRID=4674;POLYGON((...)) (WKT, obrigatorio)"
      },
      "versoes": [
        {
          "uuid_versao": "uuid (opcional, permite null)",
          "versao": "1-DSG",
          "nome": "Primeira Edicao",
          "tipo_versao_id": 1,
          "subtipo_produto_id": 2,
          "lote_id": 10,
          "metadado": {},
          "descricao": "string",
          "orgao_produtor": "string",
          "palavras_chave": ["string"],
          "data_criacao": "2024-01-15",
          "data_edicao": "2024-03-20",
          "arquivos": [
            { "...mesma estrutura de prepare-upload/files, exceto sem versao_id" }
          ]
        }
      ]
    }
  ]
}
```
> **Nota**: Diferente de `prepare-upload/version`, aqui os campos da versao ficam no nivel raiz do item do array (junto com `arquivos`), e nao dentro de uma chave `versao` aninhada.

**Resposta:** `{ session_uuid, operation_type: "add_product", produtos: [...] }`

---

### POST `/api/arquivo/confirm-upload`

Confirma conclusao de upload. Valida existencia dos arquivos e checksums. Se valido, processa a sessao conforme tipo de operacao e move registros temporarios para tabelas definitivas.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Body:**
```json
{
  "session_uuid": "uuid (obrigatorio)"
}
```

**Resposta:** `{ session_uuid, operation_type, status: "completed|failed", ... }` com detalhes por arquivo/versao/produto.

---

### GET `/api/arquivo/problem-uploads`

Retorna as ultimas 50 sessoes de upload com falha, com detalhes dos problemas.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

---

### GET `/api/arquivo/upload-sessions`

Retorna as ultimas 100 sessoes de upload (todas as situacoes), ordenadas por data de criacao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Resposta:** Array com objetos contendo:
```json
{
  "dados": [
    {
      "id": 1,
      "uuid_session": "uuid",
      "operation_type": "add_files | replace_files | add_version | add_product",
      "status": "pending | completed | failed | cancelled",
      "error_message": "string | null",
      "created_at": "datetime",
      "expiration_time": "datetime",
      "completed_at": "datetime | null",
      "usuario_nome": "string"
    }
  ]
}
```

---

### POST `/api/arquivo/cancel-upload`

Cancela uma sessao de upload pendente. O criador da sessao ou um administrador pode cancelar.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Body:**
```json
{
  "session_uuid": "uuid (obrigatorio)"
}
```

**Erros possiveis:**
- `404` - Sessao nao encontrada ou ja processada
- `403` - Usuario nao autorizado (nao e o criador nem administrador)

---

## 5. Produtos

### PUT `/api/produtos/produto`

Atualiza metadados de um produto.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "id": 123,
  "nome": "string (obrigatorio)",
  "mi": "string (opcional, permite null ou vazio)",
  "inom": "string (opcional, permite null ou vazio)",
  "tipo_escala_id": 1,
  "denominador_escala_especial": null,
  "tipo_produto_id": 2,
  "descricao": "string (obrigatorio, permite vazio)",
  "geom": "SRID=4674;POLYGON((...)) (WKT, permite null)"
}
```

---

### PUT `/api/produtos/versao`

Atualiza metadados de uma versao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "id": 456,
  "uuid_versao": "uuid (obrigatorio)",
  "versao": "string (obrigatorio)",
  "nome": "string (permite null)",
  "tipo_versao_id": 1,
  "subtipo_produto_id": 2,
  "descricao": "string (obrigatorio)",
  "metadado": {},
  "lote_id": 10,
  "orgao_produtor": "string (obrigatorio)",
  "palavras_chave": ["string"],
  "data_criacao": "date (obrigatorio)",
  "data_edicao": "date (obrigatorio)"
}
```

---

### DELETE `/api/produtos/produto`

Deleta produtos e cascata para todas as versoes, arquivos e downloads associados.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "produto_ids": [123, 124],
  "motivo_exclusao": "string (obrigatorio)"
}
```

---

### DELETE `/api/produtos/versao`

Deleta versoes. Nao permite deletar a unica versao de um produto.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "versao_ids": [456, 457],
  "motivo_exclusao": "string (obrigatorio)"
}
```

---

### POST `/api/produtos/versao_historica`

Cria versoes historicas em lote (`tipo_versao_id = 2`) para produtos existentes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |
| **HTTP Status** | 201 Created |

**Body:** Array de objetos de versao com `uuid_versao`, `versao`, `nome`, `produto_id`, `subtipo_produto_id`, `lote_id`, `metadado`, `descricao`, `orgao_produtor`, `palavras_chave`, `data_criacao`, `data_edicao`.

---

### POST `/api/produtos/produto_versao_historica`

Cria produtos com versoes historicas em lote, numa unica operacao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |
| **HTTP Status** | 201 Created |

**Body:** Array de objetos de produto com metadados do produto + array aninhado de `versoes`.

---

### POST `/api/produtos/mover-arquivos`

Move arquivos de uma versao para outra do MESMO produto, sem novo upload fisico (apenas reaponta `versao_id` no banco). Usado para separar registros que bundlam duas edicoes: o arquivo da edicao errada (ex.: um `.tif` antigo) vai para a versao, em geral historica, daquela edicao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "arquivo_ids": [7659],
  "versao_id_destino": 2495
}
```

Validacoes (transacao unica): a versao de destino existe; todos os `arquivo_ids` existem; nenhum ja esta no destino; origem e destino sao do mesmo produto; a versao de origem nao fica sem arquivos (para esvaziar, use o delete de versao); respeita `unique_file_per_version (checksum, versao_id)`. Seta `data_modificacao`/`usuario_modificacao_uuid`.

---

### POST `/api/produtos/produtos`

Cria produtos em lote (sem versoes).

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |
| **HTTP Status** | 201 Created |

**Body:**
```json
{
  "produtos": [
    {
      "nome": "string (obrigatorio)",
      "mi": "string (permite null)",
      "inom": "string (permite null)",
      "tipo_escala_id": 1,
      "denominador_escala_especial": null,
      "tipo_produto_id": 2,
      "descricao": "string (permite null)",
      "geom": "SRID=4674;POLYGON((...)) (WKT, obrigatorio)"
    }
  ]
}
```

---

### GET `/api/produtos/versao_relacionamento`

Retorna todos os relacionamentos entre versoes com detalhes completos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Resposta:** Array com IDs de relacionamento, versoes relacionadas, tipos de relacionamento e metadados de produto/versao.

---

### POST `/api/produtos/versao_relacionamento`

Cria relacionamentos entre versoes. Valida existencia das versoes, impede auto-relacionamentos, duplicatas e ciclos para tipo "Insumo" (tipo 1).

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |
| **HTTP Status** | 201 Created |

**Body:**
```json
{
  "versao_relacionamento": [
    {
      "versao_id_1": 456,
      "versao_id_2": 789,
      "tipo_relacionamento_id": 1
    }
  ]
}
```

---

### PUT `/api/produtos/versao_relacionamento`

Atualiza relacionamentos existentes. Mesmas validacoes da criacao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional em cada relacionamento.

---

### DELETE `/api/produtos/versao_relacionamento`

Deleta relacionamentos entre versoes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "versao_relacionamento_ids": [1, 2, 3]
}
```

---

## 6. Projetos e Lotes

### GET `/api/projetos/projeto`

Retorna todos os projetos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

---

### POST `/api/projetos/projeto`

Cria um novo projeto.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |
| **HTTP Status** | 201 Created |

**Body:**
```json
{
  "nome": "string (obrigatorio)",
  "descricao": "string (obrigatorio, permite vazio)",
  "data_inicio": "date (obrigatorio)",
  "data_fim": "date (permite null)",
  "status_execucao_id": 1
}
```

---

### PUT `/api/projetos/projeto`

Atualiza um projeto existente.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional (integer, obrigatorio).

---

### DELETE `/api/projetos/projeto`

Deleta projetos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "projeto_ids": [1, 2]
}
```

---

### GET `/api/projetos/lote`

Retorna todos os lotes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

---

### POST `/api/projetos/lote`

Cria um novo lote vinculado a um projeto.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |
| **HTTP Status** | 201 Created |

**Body:**
```json
{
  "projeto_id": 1,
  "pit": "string (obrigatorio)",
  "nome": "string (obrigatorio)",
  "descricao": "string (permite vazio, opcional)",
  "data_inicio": "date (obrigatorio)",
  "data_fim": "date (permite null)",
  "status_execucao_id": 1
}
```

---

### PUT `/api/projetos/lote`

Atualiza um lote existente.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional.

---

### DELETE `/api/projetos/lote`

Deleta lotes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "lote_ids": [1, 2]
}
```

---

## 7. Volumes de Armazenamento

### GET `/api/volumes/volume_armazenamento`

Retorna todos os volumes de armazenamento.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

---

### POST `/api/volumes/volume_armazenamento`

Cria volumes de armazenamento.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |
| **HTTP Status** | 201 Created |

**Body:**
```json
{
  "volume_armazenamento": [
    {
      "nome": "string (obrigatorio)",
      "volume": "string (obrigatorio - caminho do volume)",
      "capacidade_gb": 1000.0
    }
  ]
}
```

---

### PUT `/api/volumes/volume_armazenamento`

Atualiza volumes de armazenamento.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "volume_armazenamento": [
    {
      "id": 1,
      "nome": "string (obrigatorio)",
      "volume": "string (obrigatorio)",
      "capacidade_gb": 2000.0
    }
  ]
}
```

---

### DELETE `/api/volumes/volume_armazenamento`

Deleta volumes de armazenamento.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "volume_armazenamento_ids": [1, 2]
}
```

---

### GET `/api/volumes/volume_tipo_produto`

Retorna mapeamento entre tipos de produto e volumes de armazenamento.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

---

### POST `/api/volumes/volume_tipo_produto`

Cria associacoes entre tipos de produto e volumes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |
| **HTTP Status** | 201 Created |

**Body:**
```json
{
  "volume_tipo_produto": [
    {
      "tipo_produto_id": 1,
      "volume_armazenamento_id": 1,
      "primario": true
    }
  ]
}
```

---

### PUT `/api/volumes/volume_tipo_produto`

Atualiza associacoes entre tipos de produto e volumes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional em cada objeto.

---

### DELETE `/api/volumes/volume_tipo_produto`

Deleta associacoes entre tipos de produto e volumes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "volume_tipo_produto_ids": [1, 2]
}
```

---

## 8. Usuarios

Todos os endpoints de usuario requerem `verifyAdmin`.

### GET `/api/usuarios/`

Retorna lista de todos os usuarios do sistema.

---

### POST `/api/usuarios/`

Cria usuarios a partir de UUIDs do servidor de autenticacao.

**Body:**
```json
{
  "usuarios": ["uuid-1", "uuid-2"]
}
```
- `usuarios`: array de UUIDs v4 (min 1, valores unicos, obrigatorio)

---

### PUT `/api/usuarios/`

Atualiza multiplos usuarios em lote.

**Body:**
```json
{
  "usuarios": [
    {
      "uuid": "uuid-v4 (obrigatorio)",
      "administrador": true,
      "ativo": true
    }
  ]
}
```

---

### PUT `/api/usuarios/:uuid`

Atualiza um usuario especifico.

**Params:** `uuid` - UUID v4 (obrigatorio)

**Body:**
```json
{
  "administrador": true,
  "ativo": true
}
```

---

### PUT `/api/usuarios/sincronizar`

Sincroniza a lista de usuarios com o servidor de autenticacao externo.

---

### GET `/api/usuarios/servico_autenticacao`

Retorna a lista de usuarios do servidor de autenticacao externo.

---

## 9. Gerencia (Dominios e Administracao)

### Endpoints de Dominio (Publicos)

Todos os endpoints de dominio sao `GET`, nao requerem autenticacao e retornam arrays de registros `{ code, nome }` (tipo_posto_grad inclui tambem `nome_abrev`):

| Endpoint | Descricao |
|---|---|
| `GET /api/gerencia/dominio/tipo_posto_grad` | Postos e graduacoes |
| `GET /api/gerencia/dominio/tipo_produto` | Tipos de produto |
| `GET /api/gerencia/dominio/tipo_escala` | Tipos de escala |
| `GET /api/gerencia/dominio/subtipo_produto` | Subtipos de produto |
| `GET /api/gerencia/dominio/situacao_carregamento` | Situacoes de carregamento |
| `GET /api/gerencia/dominio/tipo_arquivo` | Tipos de arquivo |
| `GET /api/gerencia/dominio/tipo_relacionamento` | Tipos de relacionamento |
| `GET /api/gerencia/dominio/tipo_status_arquivo` | Status de arquivo |
| `GET /api/gerencia/dominio/tipo_versao` | Tipos de versao |
| `GET /api/gerencia/dominio/tipo_status_execucao` | Status de execucao |

### Endpoints Administrativos

### GET `/api/gerencia/arquivos_deletados`

Retorna arquivos deletados com paginacao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Query Params:**
| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `page` | integer | 1 | Numero da pagina (min 1) |
| `limit` | integer | 20 | Registros por pagina (min 1, max 100) |

**Resposta:** Dados paginados com campo `pagination` adicional.

---

### POST `/api/gerencia/verificar_inconsistencias`

Executa verificacao de consistencia do acervo.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

---

### GET `/api/gerencia/arquivos_incorretos`

Retorna arquivos com problemas de integridade, com paginacao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Query Params:** Mesmos de `arquivos_deletados` (`page`, `limit`).

---

### GET `/api/gerencia/downloads_deletados`

Retorna downloads de arquivos que foram deletados, com paginacao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Query Params:**
| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `page` | integer | 1 | Numero da pagina (min 1) |
| `limit` | integer | 20 | Registros por pagina (min 1, max 100) |

**Resposta:**
```json
{
  "dados": {
    "total": 50,
    "page": 1,
    "limit": 20,
    "dados": [
      {
        "id": 1,
        "arquivo_deletado_id": 10,
        "usuario_uuid": "uuid",
        "data_download": "datetime",
        "usuario_nome": "string",
        "arquivo_nome": "string",
        "nome_arquivo": "string",
        "motivo_exclusao": "string",
        "data_delete": "datetime"
      }
    ]
  }
}
```

---

## 10. Mapoteca - Dominios

Endpoints de dominio da mapoteca, todos publicos (`GET`, sem autenticacao):

| Endpoint | Descricao |
|---|---|
| `GET /api/mapoteca/dominio/tipo_cliente` | Tipos de cliente |
| `GET /api/mapoteca/dominio/situacao_pedido` | Situacoes de pedido (inclui 7 - Aguardando producao) |
| `GET /api/mapoteca/dominio/tipo_midia` | Tipos de midia (inclui 8 - Tyvek) |
| `GET /api/mapoteca/dominio/tipo_localizacao` | Tipos de localizacao |
| `GET /api/mapoteca/dominio/forma_entrega` | Formas de entrega: 1-Correios, 2-Entrega em maos, 3-Retirado no CGEO, 4-E-mail, 5-Outros |

---

## 11. Mapoteca - Clientes

### GET `/api/mapoteca/cliente`

Retorna todos os clientes com estatisticas de pedidos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

---

### GET `/api/mapoteca/cliente/:id`

Retorna informacoes detalhadas de um cliente com historico de pedidos e estatisticas.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `id` - integer (obrigatorio) |

---

### POST `/api/mapoteca/cliente`

Cria um novo cliente.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "nome": "string (obrigatorio)",
  "ponto_contato_principal": "string (permite null)",
  "endereco_entrega_principal": "string (permite null)",
  "tipo_cliente_id": 1
}
```

---

### PUT `/api/mapoteca/cliente`

Atualiza um cliente existente.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional.

---

### DELETE `/api/mapoteca/cliente`

Deleta clientes. Falha se o cliente possuir pedidos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "cliente_ids": [1, 2]
}
```

---

## 12. Mapoteca - Pedidos

### GET `/api/mapoteca/pedido`

Retorna todos os pedidos com informacoes do cliente e contagem de produtos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

---

### GET `/api/mapoteca/pedido/:id`

Retorna detalhes completos de um pedido com todos os produtos e trilha de auditoria.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `id` - integer (obrigatorio) |

---

### GET `/api/mapoteca/pedido/localizador/:localizador`

Consulta pedido por codigo de rastreamento. Endpoint publico (acompanhamento do cliente).

| Campo | Valor |
|---|---|
| **Auth** | Nenhuma |
| **Params** | `localizador` - string, formato `^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$` |

Retorna apenas campos seguros para exposicao publica: situacao, datas, cliente, prazo,
`observacao` do pedido, rastreio/observacao de envio, motivo de cancelamento e a lista
`produtos` (o que foi pedido). Nao expoe o `id` interno nem dados de usuarios.

**Resposta (`dados`):**
```json
{
  "localizador_pedido": "ABCD-2345-WXYZ",
  "data_pedido": "2026-03-10T10:00:00Z",
  "situacao_pedido_id": 4,
  "situacao_pedido_nome": "Em andamento",
  "cliente_nome": "1º CGEO",
  "prazo": "2026-04-01",
  "observacao": "Pedido urgente para exercício",
  "localizador_envio": "QN048384596BR",
  "observacao_envio": null,
  "motivo_cancelamento": null,
  "produtos": [
    {
      "quantidade": 4,
      "tipo_midia_nome": "Papel",
      "forma_entrega_nome": "Correios",
      "observacao": "Plotagem em papel A0",
      "versao": "1",
      "produto_nome": "Carta Topográfica X",
      "mi": "2965-2",
      "inom": "SF-22-Y-D-II-2",
      "escala": "1:50.000",
      "tipo_produto_nome": "Carta Topográfica"
    }
  ]
}
```

---

### POST `/api/mapoteca/pedido`

Cria um novo pedido. O `localizador_pedido` e gerado automaticamente.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "data_pedido": "date (obrigatorio)",
  "data_atendimento": "date (permite null)",
  "cliente_id": 1,
  "situacao_pedido_id": 1,
  "ponto_contato": "string (permite null)",
  "documento_solicitacao": "string (permite null)",
  "documento_solicitacao_nup": "string (permite null)",
  "endereco_entrega": "string (permite null)",
  "palavras_chave": ["string"],
  "operacao": "string (permite null)",
  "prazo": "date (permite null)",
  "demandante": "string (permite null, max 255) - quem encaminhou o pedido (ex: CMS)",
  "omds": "string (permite null, max 255) - OM responsavel pelo atendimento (ex: 1 CGEO)",
  "previsto_pit": "boolean (default false) - PIT vs Extra-PIT",
  "observacao": "string (permite null)",
  "localizador_envio": "string (permite null)",
  "observacao_envio": "string (permite null)",
  "motivo_cancelamento": "string (permite null)"
}
```

**Regras condicionais (Joi + CHECK no banco):**
- `situacao_pedido_id = 5` (Concluido) exige `data_atendimento`.
- `situacao_pedido_id = 6` (Cancelado) exige `motivo_cancelamento`.

**Resposta:** `{ id, localizador_pedido }`

---

### PUT `/api/mapoteca/pedido`

Atualiza um pedido existente. O `localizador_pedido` nao pode ser modificado.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional.

---

### DELETE `/api/mapoteca/pedido`

Deleta pedidos e todos os produtos associados.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "pedido_ids": [1, 2]
}
```

---

## 13. Mapoteca - Produtos do Pedido

### POST `/api/mapoteca/produto_pedido`

Adiciona um produto a um pedido.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "uuid_versao": "uuid (obrigatorio - todo item referencia acervo.versao, RN08)",
  "pedido_id": 1,
  "quantidade": 1,
  "quantidade_fornecida": "integer >= 0 (permite null) - quantidade efetivamente entregue",
  "tipo_midia_id": 1,
  "tipo_midia_fornecida_id": "integer (permite null) - midia efetivamente usada",
  "forma_entrega_id": "integer (permite null) - FK mapoteca.forma_entrega",
  "data_entrega": "date (permite null) - entrega efetiva por item (entregas parciais)",
  "observacao": "string (permite null)",
  "producao_especifica": false
}
```

---

### PUT `/api/mapoteca/produto_pedido`

Atualiza um produto de pedido.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional.

---

### DELETE `/api/mapoteca/produto_pedido`

Remove produtos de um pedido.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "produto_pedido_ids": [1, 2]
}
```

---

## 13a. Mapoteca - Impressao de Pedidos (plugin QGIS)

Fluxo do plugin QGIS da mapoteca (`ferramentas_mapoteca/`): baixar os PDFs das cartas de um pedido para impressao e registrar os quantitativos impressos. O historico de impressao por item (`mapoteca.impressao_item`) permite que operadores diferentes continuem o trabalho em dias distintos.

### POST `/api/mapoteca/pedido/:id/download_impressao`

Prepara o download dos PDFs das cartas do pedido. Para cada item retorna o arquivo PDF da versao no acervo (token em `acervo.download`, confirmado depois via `POST /api/acervo/confirm-download`) e os quantitativos (pedido, ja impresso, restante). Itens sem PDF carregado vao em `itens_sem_pdf`.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `id` - integer (obrigatorio) |

**Resposta:** `{ pedido_id, localizador_pedido, arquivos: [{ produto_pedido_id, produto_nome, mi, escala, versao, tipo_midia_nome, quantidade, quantidade_impressa, quantidade_restante, arquivo_id, nome, download_path, checksum, tamanho_mb, download_token }], itens_sem_pdf: [...] }`

---

### POST `/api/mapoteca/impressao`

Registra sessoes de impressao (log operacional — qualquer usuario logado). O total impresso por item e a soma dos registros.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Body:**
```json
{
  "registros": [
    { "produto_pedido_id": 1, "quantidade": 3, "observacao": "string (permite null)" }
  ]
}
```

---

### GET `/api/mapoteca/produto_pedido/:id/impressao`

Historico de impressao de um item, com resumo dos quantitativos.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `id` - integer (obrigatorio) |

**Resposta:** `{ produto_pedido_id, quantidade, quantidade_impressa, quantidade_restante, impressao_concluida, registros: [{ id, quantidade, observacao, data_impressao, usuario_nome }] }`

---

### DELETE `/api/mapoteca/impressao`

Remove registros de impressao (correcoes).

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "impressao_ids": [1, 2]
}
```

**Observacao:** `GET /api/mapoteca/pedido` retorna `itens_impressos` por pedido e `GET /api/mapoteca/pedido/:id` retorna, por item, `quantidade_impressa`, `quantidade_restante` e `impressao_concluida`, alem do resumo `impressao: { total_itens, itens_concluidos, concluida }`.

---

## 14. Mapoteca - Plotters

### GET `/api/mapoteca/plotter`

Retorna todos os plotters com data da ultima manutencao e contagem de manutencoes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

---

### GET `/api/mapoteca/plotter/:id`

Retorna detalhes do plotter com historico de manutencoes, estatisticas de custo e media de tempo entre manutencoes.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `id` - integer (obrigatorio) |

---

### POST `/api/mapoteca/plotter`

Cria um novo plotter.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "ativo": true,
  "nr_serie": "string (obrigatorio)",
  "modelo": "string (obrigatorio)",
  "data_aquisicao": "date (permite null)",
  "vida_util": 60
}
```
- `vida_util`: integer em meses (permite null)

---

### PUT `/api/mapoteca/plotter`

Atualiza um plotter.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campos `id` e `ativo` obrigatorios.

---

### DELETE `/api/mapoteca/plotter`

Deleta plotters. Falha se houver registros de manutencao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "plotter_ids": [1, 2]
}
```

---

## 15. Mapoteca - Manutencao de Plotters

### GET `/api/mapoteca/manutencao_plotter`

Retorna todos os registros de manutencao com detalhes dos plotters.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

---

### GET `/api/mapoteca/manutencao_plotter/:id`

Retorna detalhes de um registro de manutencao especifico.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `id` - integer (obrigatorio) |

---

### POST `/api/mapoteca/manutencao_plotter`

Registra uma manutencao de plotter.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "plotter_id": 1,
  "data_manutencao": "date (obrigatorio)",
  "valor": 1500.50,
  "descricao": "string (permite null)"
}
```
- `valor`: decimal positivo com 2 casas

---

### PUT `/api/mapoteca/manutencao_plotter`

Atualiza registro de manutencao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional.

---

### DELETE `/api/mapoteca/manutencao_plotter`

Deleta registros de manutencao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "manutencao_ids": [1, 2]
}
```

---

## 16. Mapoteca - Tipos de Material

### GET `/api/mapoteca/tipo_material`

Retorna todos os tipos de material com estoque total, contagem de localizacoes e o indicador `abaixo_minimo` (true quando `estoque_minimo` esta definido e o estoque total e menor que ele — usado para badge na UI).

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

---

### GET `/api/mapoteca/tipo_material/:id`

Retorna tipo de material com estoque por localizacao, estatisticas de consumo e historico recente (ultimos 10 registros).

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `id` - integer (obrigatorio) |

---

### POST `/api/mapoteca/tipo_material`

Cria um tipo de material.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "nome": "string (obrigatorio)",
  "descricao": "string (permite null)",
  "estoque_minimo": "decimal >= 0 (permite null) - limiar para badge de estoque baixo",
  "meta_anual": "decimal >= 0 (permite null) - consumo anual previsto",
  "ativo": "boolean (default true)"
}
```

**Resposta:** `{ id }`

---

### PUT `/api/mapoteca/tipo_material`

Atualiza tipo de material.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional.

---

### DELETE `/api/mapoteca/tipo_material`

Deleta tipos de material. Falha se houver registros de estoque ou consumo associados.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "tipo_material_ids": [1, 2]
}
```

---

## 17. Mapoteca - Estoque de Material

### GET `/api/mapoteca/estoque_material`

Retorna todo o estoque com tipo de material, localizacao e trilha de auditoria.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

---

### GET `/api/mapoteca/estoque_por_localizacao`

Retorna estoque agregado por localizacao com contagem de tipos de material.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

---

### GET `/api/mapoteca/estoque_material/:id`

Retorna detalhes de um registro de estoque especifico.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `id` - integer (obrigatorio) |

---

### POST `/api/mapoteca/estoque_material`

Cria ou atualiza registro de estoque (upsert na chave composta material+localizacao).

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "tipo_material_id": 1,
  "quantidade": 100.50,
  "localizacao_id": 1
}
```
- `quantidade`: decimal positivo com 2 casas

**Resposta:** `{ id }`

---

### POST `/api/mapoteca/estoque_material/transferir`

Transfere material entre localizacoes em transacao unica (lock `FOR UPDATE` na origem; upsert no destino).

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "tipo_material_id": 1,
  "origem_id": 2,
  "destino_id": 1,
  "quantidade": 10.00
}
```
- `origem_id` / `destino_id`: codes de `tipo_localizacao` (1-Secao, 2-Almoxarifado, 3-Aquisicao realizada, 4-Saldo no empenho); devem ser diferentes.
- `quantidade`: decimal positivo; falha com 400 se a origem nao tiver saldo suficiente.

---

### PUT `/api/mapoteca/estoque_material`

Atualiza registro de estoque.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional.

---

### DELETE `/api/mapoteca/estoque_material`

Deleta registros de estoque.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "estoque_material_ids": [1, 2]
}
```

---

## 18. Mapoteca - Consumo de Material

### GET `/api/mapoteca/consumo_material`

Retorna registros de consumo com filtros opcionais.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Query Params (todos opcionais):**
| Parametro | Tipo | Descricao |
|---|---|---|
| `data_inicio` | date | Data de inicio do filtro |
| `data_fim` | date | Data de fim do filtro |
| `tipo_material_id` | integer | Filtrar por tipo de material |

---

### GET `/api/mapoteca/consumo_mensal`

Retorna consumo mensal por tipo de material para um ano especificado.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |

**Query Params:**
| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `ano` | integer | ano atual | Ano para consulta |

---

### GET `/api/mapoteca/consumo_material/:id`

Retorna detalhes de um registro de consumo especifico.

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
| **Params** | `id` - integer (obrigatorio) |

---

### POST `/api/mapoteca/consumo_material`

Registra consumo de material.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "tipo_material_id": 1,
  "quantidade": 25.00,
  "data_consumo": "2024-03-15"
}
```
- `quantidade`: decimal positivo com 2 casas

**Resposta:** `{ id }`

---

### PUT `/api/mapoteca/consumo_material`

Atualiza registro de consumo.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:** Mesma estrutura do POST com campo `id` adicional.

---

### DELETE `/api/mapoteca/consumo_material`

Deleta registros de consumo.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |

**Body:**
```json
{
  "consumo_material_ids": [1, 2]
}
```

---

## 19. Dashboard da Mapoteca

Todos os endpoints sao `GET` e requerem `verifyLogin`. Prefixo: `/api/mapoteca/dashboard`.

### GET `/api/mapoteca/dashboard/order_status`

Retorna distribuicao de pedidos por status: total, em andamento, concluidos, pendentes e detalhamento.

---

### GET `/api/mapoteca/dashboard/orders_timeline`

Retorna contagem semanal de pedidos ao longo dos ultimos N meses.

**Query Params:**
| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `meses` | integer | 6 | Numero de meses retroativos |

**Resposta:** Array com `semana_inicio`, `semana_fim`, `total_pedidos`, `total_produtos`.

---

### GET `/api/mapoteca/dashboard/avg_fulfillment_time`

Retorna tempo medio de atendimento geral, por tipo de cliente e tendencia mensal.

**Resposta:** `{ media_geral, por_tipo_cliente: [...], mensal: [...] }`

---

### GET `/api/mapoteca/dashboard/client_activity`

Retorna os N clientes mais ativos por contagem de pedidos com estatisticas de conclusao.

**Query Params:**
| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `limite` | integer | 10 | Numero maximo de clientes |

---

### GET `/api/mapoteca/dashboard/pending_orders`

Retorna pedidos incompletos/nao cancelados, ordenados por prazo, com indicadores de atraso.

---

### GET `/api/mapoteca/dashboard/stock_by_location`

Retorna estoque de materiais agregado por localizacao (dados para grafico de pizza).

---

### GET `/api/mapoteca/dashboard/material_consumption`

Retorna consumo mensal total, top 5 materiais mais consumidos e consumo detalhado por material por mes.

**Query Params:**
| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `meses` | integer | 12 | Numero de meses retroativos |

---

### GET `/api/mapoteca/dashboard/plotter_status`

Retorna resumo de status dos plotters (total, ativos, inativos) e lista com data da ultima manutencao e indicador de fim de vida util.

---

### GET `/api/mapoteca/dashboard/entregas_por_tipo_produto`

Entregas do ano agrupadas por tipo de produto e escala (via catalogo do acervo). Considera pedidos com situacao 4 (Remetido) ou 5 (Concluido); a data de referencia e `produto_pedido.data_entrega` com fallback em `pedido.data_atendimento`.

**Query Params:** `ano` (int, default ano atual), `formato` (`json` | `csv`, default `json`).

**Resposta:** Array com `tipo_produto`, `escala`, `total_pedidos`, `total_produtos`.

---

### GET `/api/mapoteca/dashboard/entregas_por_midia`

Entregas do ano agrupadas por tipo de midia (midia fornecida com fallback na prevista).

**Query Params:** `ano`, `formato` (`json` | `csv`).

**Resposta:** Array com `tipo_midia`, `total_produtos`.

---

### GET `/api/mapoteca/dashboard/operacoes_apoiadas`

Operacoes apoiadas no ano (campo livre `pedido.operacao`), com total de pedidos e produtos.

**Query Params:** `ano`, `formato` (`json` | `csv`).

**Resposta:** Array com `operacao`, `total_pedidos`, `total_produtos`.

---

### GET `/api/mapoteca/dashboard/resumo_anual`

Resumo anual consolidado.

**Query Params:** `ano` (int, default ano atual).

**Resposta:** `{ ano, total_pedidos, total_entregas, oms_distintas_count, operacoes_distintas_count, custo_manutencao_total }`

---

### GET `/api/mapoteca/dashboard/entregas_por_mes`

Entregas por mes do ano (reproduz a tabela-resumo mensal da planilha: Carta Topo x Carta Orto x Outros). Sempre retorna 12 meses.

**Query Params:** `ano`, `formato` (`json` | `csv`).

**Resposta:** Array com `mes` (1-12), `carta_topo`, `carta_orto`, `outros`, `total`.

---

## 19a. Mapoteca - Relatorios

Endpoints que reproduzem as abas da antiga planilha de controle de pedidos (ver `mapoteca/CLAUDE.md`, secao 7). Todos `GET` com `verifyLogin`, prefixo `/api/mapoteca/relatorio`, e os query params:

| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `ano` | integer | ano atual | Ano de referencia (`data_pedido`) |
| `formato` | `json` \| `csv` | `json` | `csv` retorna `text/csv` (separador `;`, BOM UTF-8, datas DD/MM/YYYY) como download (`Content-Disposition: attachment`) |

### GET `/api/mapoteca/relatorio/pedidos_mil`

Reproduz a aba **Mil**: uma linha por pedido militar (cliente OM EB/Aeronautica/Marinha) com pivo de quantidades por escala (25k/50k/100k/250k) x tipo (Carta Topografica / Carta Ortoimagem), alem de `outros_produtos` (tipos nao Topo/Orto ou escala personalizada), `produtos_digitais` (midia Digital) e `total`. Colunas `off_*` saem sempre 0 (mapoteca nao fornece mais estoque offset). Inclui `possui_detalhamento` (Det.?), `tempo_atendimento_dias`, rastreio e operacao. Quantidades usam `COALESCE(quantidade_fornecida, quantidade)`.

### GET `/api/mapoteca/relatorio/pedidos_detalhado`

Reproduz a aba **Detalhado**: uma linha por item de pedido com `omds`, `demandante`, `om_destino`, `previsto_pit`, `meta` (prazo), produto/MI/escala do catalogo (escala personalizada formatada como `1:<denominador>`), quantidade e material previstos x fornecidos, `data_entrega`, `forma_entrega`, `observacao` e `mes` da entrega.

### GET `/api/mapoteca/relatorio/pedidos_civ`

Reproduz a aba **Civ**: uma linha por pedido civil (demais tipos de cliente) com solicitante, oficio, NUP LAI, resumo (observacao do pedido), data de envio, situacao e observacao de envio.

### GET `/api/mapoteca/relatorio/tematicos`

Reproduz a aba **Mapas Tematicos**: itens com `producao_especifica = TRUE` (RN07 — producao sob demanda). Retorna `nome_projeto` (versao/produto do acervo), `demandante`, descricoes do pedido e do produto, `data_entrega`, `secao_responsavel` (`acervo.versao.orgao_produtor`), `militar_responsavel` (`acervo.versao.metadado->>'responsavel'`) e `tamanho_mb` (soma dos arquivos carregados da versao).

### GET `/api/mapoteca/relatorio/impressao_detalhada`

Variante enxuta do **Detalhado** (mesma query/dados), recortada nas 15 colunas da planilha de impressao: `omds`, `demandante`, `om_destino`, `previsto_pit`, `meta` (prazo), `produto`, `mi`, `escala`, quantidade e material previstos x fornecidos, `data_entrega`, `forma_entrega` e `observacao`. Sem nome do produto, mes ou localizador. Filtra por `data_pedido`.

### GET `/api/mapoteca/relatorio/pedidos_resumo`

Resumo por pedido (uma linha por pedido, **todos os clientes** — nao so OM militares): `numero_pedido` (`pedido.id`), `unidade` (cliente), `documento` (DIEx), `status` (situacao), `data_envio` (`data_atendimento`), `informacoes_envio` (`localizador_envio`) e o consolidado de produtos entregues por tipo x escala (`topo_25k`..`topo_250k`/`total_topo`, `orto_25k`..`orto_250k`/`total_orto`, `outros_produtos`, `produtos_digitais`, `total`). Quantidade entregue = `COALESCE(quantidade_fornecida, quantidade)`. Filtra por `data_pedido`.

---

## 20. Dashboard do Acervo

Todos os endpoints sao `GET` e requerem **verifyLogin**. Prefixo: `/api/dashboard`.

| Endpoint | Descricao | Query Params |
|---|---|---|
| `GET /api/dashboard/produtos_total` | Total de produtos no acervo | - |
| `GET /api/dashboard/arquivos_total_gb` | Total de armazenamento em GB | - |
| `GET /api/dashboard/produtos_tipo` | Produtos agrupados por tipo | - |
| `GET /api/dashboard/gb_tipo_produto` | GB agrupados por tipo de produto | - |
| `GET /api/dashboard/usuarios_total` | Total de usuarios | - |
| `GET /api/dashboard/arquivos_dia` | Arquivos carregados por dia | - |
| `GET /api/dashboard/downloads_dia` | Downloads por dia | - |
| `GET /api/dashboard/gb_volume` | GB por volume de armazenamento | - |
| `GET /api/dashboard/ultimos_carregamentos` | Ultimos arquivos carregados | - |
| `GET /api/dashboard/ultimas_modificacoes` | Ultimas modificacoes de arquivo | - |
| `GET /api/dashboard/ultimos_deletes` | Ultimos arquivos deletados | - |
| `GET /api/dashboard/download` | Informacoes gerais de download | - |
| `GET /api/dashboard/produto_activity_timeline` | Timeline de atividade de produtos | `months` (int, default 12) |
| `GET /api/dashboard/version_statistics` | Estatisticas de versoes | - |
| `GET /api/dashboard/storage_growth_trends` | Tendencias de crescimento de armazenamento | `months` (int, default 12) |
| `GET /api/dashboard/project_status_summary` | Resumo de status de projetos | - |
| `GET /api/dashboard/user_activity_metrics` | Metricas de atividade de usuarios | `limit` (int, default 10) |
| `GET /api/dashboard/system_health` | Indicadores de saude do sistema (volumes, erros, sessoes) | - |
| `GET /api/dashboard/produtos_escala` | Produtos agrupados por escala | - |
| `GET /api/dashboard/arquivos_tipo_arquivo` | Arquivos agrupados por tipo de arquivo | - |
| `GET /api/dashboard/situacao_carregamento` | Distribuicao por situacao de carregamento | - |
| `GET /api/dashboard/versao_activity_timeline` | Timeline de atividade de versoes | `months` (int, default 12) |
| `GET /api/dashboard/ultimos_produtos` | Ultimos produtos cadastrados | - |
| `GET /api/dashboard/ultimas_versoes` | Ultimas versoes cadastradas | - |

---

## 21. Integracao (rotas publicas para o vault da DGEO)

Rotas **publicas (sem autenticacao), somente leitura**, criadas para a integracao com o vault do Chefe da DGEO (roteamento de demanda e geracao do RPCMTec). A ausencia de `verifyLogin` e intencional e segue a mesma postura do projeto (intranet confiavel; ver `CLAUDE.md`, "Intentional Design Decisions"). Prefixo: `/api/integracao`.

### GET `/api/integracao/acervo/situacao_geral`

Cobertura do acervo folha a folha (substitui o site de produtos `1cgeo/produtos` no roteamento de demanda). Reusa o nucleo da situacao geral do acervo; os anos vem de `acervo.versao.data_edicao`.

| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `escala` | `25k` \| `50k` \| `100k` \| `250k` | todas | Escala da carta topografica sistematica |
| `geom` | boolean | `false` | Inclui a geometria (Polygon) de cada folha |
| `mi` | string (csv) | - | Filtra as folhas por MI (ex.: `2753-1,2754-2`) |
| `inom` | string (csv) | - | Filtra as folhas por INOM |

**Resposta:** `{ "25k": [...], "50k": [...] }` (uma chave por escala consultada). Cada item e uma Feature GeoJSON com `properties` no mesmo formato dos arquivos do site (`identificadorMI`, `identificadorINOM`, `situacao_topo`, `edicoes_topo[]`, `situacao_orto`, `edicoes_orto[]`) e, quando `geom=true`, `geometry`.

### GET `/api/integracao/acervo/produtos_finalizados`

Produtos finalizados no periodo (RPCMTec 2.2). Criterio = `acervo.versao.data_edicao` (data de finalizacao / informacoes marginais), **nao** `data_cadastramento` (registro no SCA).

| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `ano` | integer | ano atual | Ano de referencia |
| `mes` | integer (1-12) | mes atual | Mes de referencia |
| `cumulativo` | boolean | `true` | `true` = acumulado de janeiro ate o mes (RPCMTec e cumulativo); `false` = apenas o mes |
| `tipo_produto_id` | integer | - | Filtra por tipo de produto |
| `tipo_escala_id` | integer | - | Filtra por escala |

**Resposta:** `{ ano, mes, cumulativo, total, resumo: [{ tipo_produto, escala, quantidade }], produtos: [...] }`. Cada produto traz `uuid_versao`, `nome`, `versao`, `mi`, `inom`, `tipo_produto`, `escala`, `subtipo_produto`, `orgao_produtor`, `data_criacao`, `data_edicao`, `data_cadastramento` (apenas referencia), `lote`, `pit`, `projeto` e `situacao_carregamento[]` (situacoes de carregamento distintas dos arquivos da versao, ex.: "Carregado BDGEx Ostensivo").

### GET `/api/integracao/mapoteca/atendimentos`

Atendimentos da mapoteca no periodo (RPCMTec 2.4 militar e 2.7 civil/LAI). Enxuto as colunas do RPCMTec: **nao** retorna endereco, ponto de contato nem observacoes de envio. Considera pedidos entregues (situacao Remetido/Concluido) cuja data efetiva de atendimento (fechamento do pedido, com fallback na maior data de entrega de item) cai no periodo.

| Parametro | Tipo | Padrao | Descricao |
|---|---|---|---|
| `ano` | integer | ano atual | Ano de referencia |
| `mes` | integer (1-12) | mes atual | Mes de referencia |
| `cumulativo` | boolean | `true` | `true` = acumulado ate o mes; `false` = apenas o mes |

**Resposta:** `{ ano, mes, cumulativo, militar: [...], civil: [...], resumo: {...} }`.
- `militar` (2.4): `solicitante` (OM), `documento_solicitacao`, `previsto_pit`, `operacao`, `quantidade`, `situacao`, `data_atendimento`.
- `civil` (2.7): `solicitante`, `tipo_cliente`, `documento`, `nup`, `quantidade`, `situacao`, `data_atendimento`.
- `resumo`: `total_pedidos`, `total_produtos`, `pedidos_militares`, `pedidos_civis`.

---

## Endpoints Auxiliares

### GET `/logs`

Retorna os logs combinados dos ultimos 3 dias em texto plano. Nao e prefixado com `/api`.

| Campo | Valor |
|---|---|
| **Auth** | Nenhuma |
| **Content-Type** | `text/plain` |

### GET `/api/api_docs`

Interface Swagger UI com documentacao interativa da API.

---

## Resumo de Endpoints por Modulo

| Modulo | Prefixo | Total | Auth Padrao |
|---|---|---|---|
| Health Check | `/api/` | 1 | Nenhuma |
| Login | `/api/login` | 1 | Nenhuma |
| Acervo | `/api/acervo` | 12 | verifyLogin / verifyAdmin |
| Arquivo | `/api/arquivo` | 9 | verifyLogin / verifyAdmin |
| Produtos | `/api/produtos` | 11 | verifyAdmin (maioria) |
| Projetos | `/api/projetos` | 8 | verifyLogin (leitura) / verifyAdmin (escrita) |
| Volumes | `/api/volumes` | 8 | verifyAdmin |
| Usuarios | `/api/usuarios` | 6 | verifyAdmin |
| Gerencia | `/api/gerencia` | 14 | Nenhuma (dominios) / verifyAdmin |
| Mapoteca - Dominios | `/api/mapoteca/dominio` | 5 | Nenhuma |
| Mapoteca - Clientes | `/api/mapoteca/cliente` | 5 | verifyLogin / verifyAdmin |
| Mapoteca - Pedidos | `/api/mapoteca/pedido` | 6 | verifyLogin / verifyAdmin |
| Mapoteca - Prod. Pedido | `/api/mapoteca/produto_pedido` | 3 | verifyAdmin |
| Mapoteca - Impressao | `/api/mapoteca/impressao` + pedido/produto_pedido | 4 | verifyLogin / verifyAdmin |
| Mapoteca - Plotters | `/api/mapoteca/plotter` | 5 | verifyLogin / verifyAdmin |
| Mapoteca - Manutencao | `/api/mapoteca/manutencao_plotter` | 5 | verifyLogin / verifyAdmin |
| Mapoteca - Tipo Material | `/api/mapoteca/tipo_material` | 5 | verifyLogin / verifyAdmin |
| Mapoteca - Estoque | `/api/mapoteca/estoque_material` | 7 | verifyLogin / verifyAdmin |
| Mapoteca - Consumo | `/api/mapoteca/consumo_material` | 6 | verifyLogin / verifyAdmin |
| Mapoteca - Relatorios | `/api/mapoteca/relatorio` | 4 | verifyLogin |
| Dashboard Mapoteca | `/api/mapoteca/dashboard` | 13 | verifyLogin |
| Dashboard Acervo | `/api/dashboard` | 24 | verifyLogin |
| Integracao (vault DGEO) | `/api/integracao` | 3 | Nenhuma (publica, read-only) |
| **Total** | | **165** | |
