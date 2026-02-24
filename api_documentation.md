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
        { "...mesma estrutura de prepare-upload/files" }
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
        "tipo_produto_id": 2,
        "geom": "SRID=4674;POLYGON((...)) (WKT)"
      },
      "versoes": [
        {
          "versao": { "...estrutura de versao" },
          "arquivos": [ "...estrutura de arquivo" ]
        }
      ]
    }
  ]
}
```

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
  "mi": "string (obrigatorio)",
  "inom": "string (obrigatorio)",
  "tipo_escala_id": 1,
  "denominador_escala_especial": null,
  "tipo_produto_id": 2,
  "descricao": "string (obrigatorio, permite vazio)"
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

**Body:** Array de objetos de versao com `uuid_versao`, `versao`, `nome`, `produto_id`, `lote_id`, `metadado`, `descricao`, `orgao_produtor`, `palavras_chave`, `data_criacao`, `data_edicao`.

---

### POST `/api/produtos/produto_versao_historica`

Cria produtos com versoes historicas em lote, numa unica operacao.

| Campo | Valor |
|---|---|
| **Auth** | `verifyAdmin` |
| **HTTP Status** | 201 Created |

**Body:** Array de objetos de produto com metadados do produto + array aninhado de `versoes`.

---

### POST `/api/produtos/produtos`

Cria produtos em lote (sem versoes).

| Campo | Valor |
|---|---|
| **Auth** | `verifyLogin` |
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
| **Auth** | Nenhuma (publico) |

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
| **Auth** | Nenhuma |

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
| **Auth** | Nenhuma |

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

Todos os endpoints de dominio sao `GET`, nao requerem autenticacao e retornam arrays de registros `{ code, nome }`:

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

## 10. Mapoteca - Dominios

Endpoints de dominio da mapoteca, todos publicos (`GET`, sem autenticacao):

| Endpoint | Descricao |
|---|---|
| `GET /api/mapoteca/dominio/tipo_cliente` | Tipos de cliente |
| `GET /api/mapoteca/dominio/situacao_pedido` | Situacoes de pedido |
| `GET /api/mapoteca/dominio/tipo_midia` | Tipos de midia |
| `GET /api/mapoteca/dominio/tipo_localizacao` | Tipos de localizacao |

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

Consulta pedido por codigo de rastreamento. Endpoint publico.

| Campo | Valor |
|---|---|
| **Auth** | Nenhuma |
| **Params** | `localizador` - string, formato `^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$` |

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
  "observacao": "string (permite null)",
  "localizador_envio": "string (permite null)",
  "observacao_envio": "string (permite null)",
  "motivo_cancelamento": "string (permite null)"
}
```

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
  "uuid_versao": "uuid (obrigatorio)",
  "pedido_id": 1,
  "quantidade": 1,
  "tipo_midia_id": 1,
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

Retorna todos os tipos de material com estoque total e contagem de localizacoes.

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
  "descricao": "string (permite null)"
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

## 20. Dashboard do Acervo (Nao Montado)

> **Nota**: Estes endpoints estao definidos em `server/src/dashboard/` mas **nao estao montados** em `routes.js`. Para ativa-los, e necessario importar e registrar o modulo no arquivo de rotas.

Os seguintes endpoints estao definidos como `GET`, sem middleware de autenticacao:

| Endpoint | Descricao |
|---|---|
| `/produtos_total` | Total de produtos no acervo |
| `/arquivos_total_gb` | Total de armazenamento em GB |
| `/produtos_tipo` | Produtos agrupados por tipo |
| `/gb_tipo_produto` | GB agrupados por tipo de produto |
| `/usuarios_total` | Total de usuarios |
| `/arquivos_dia` | Arquivos carregados por dia |
| `/downloads_dia` | Downloads por dia |
| `/gb_volume` | GB por volume de armazenamento |
| `/ultimos_carregamentos` | Ultimos arquivos carregados |
| `/ultimas_modificacoes` | Ultimas modificacoes de arquivo |
| `/ultimos_deletes` | Ultimos arquivos deletados |
| `/download` | Informacoes gerais de download |
| `/produto_activity_timeline` | Timeline de atividade de produtos (`?months=12`) |
| `/version_statistics` | Estatisticas de versoes |
| `/storage_growth_trends` | Tendencias de crescimento de armazenamento (`?months=12`) |
| `/project_status_summary` | Resumo de status de projetos |
| `/user_activity_metrics` | Metricas de atividade de usuarios (`?limit=10`) |

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
| Acervo | `/api/acervo` | 9 | verifyLogin / verifyAdmin |
| Arquivo | `/api/arquivo` | 7 | verifyLogin / verifyAdmin |
| Produtos | `/api/produtos` | 11 | verifyAdmin (maioria) |
| Projetos | `/api/projetos` | 8 | verifyAdmin (escrita) |
| Volumes | `/api/volumes` | 8 | verifyAdmin |
| Usuarios | `/api/usuarios` | 6 | verifyAdmin |
| Gerencia | `/api/gerencia` | 13 | Nenhuma (dominios) / verifyAdmin |
| Mapoteca - Dominios | `/api/mapoteca/dominio` | 4 | Nenhuma |
| Mapoteca - Clientes | `/api/mapoteca/cliente` | 5 | verifyLogin / verifyAdmin |
| Mapoteca - Pedidos | `/api/mapoteca/pedido` | 6 | verifyLogin / verifyAdmin |
| Mapoteca - Prod. Pedido | `/api/mapoteca/produto_pedido` | 3 | verifyAdmin |
| Mapoteca - Plotters | `/api/mapoteca/plotter` | 5 | verifyLogin / verifyAdmin |
| Mapoteca - Manutencao | `/api/mapoteca/manutencao_plotter` | 4 | verifyLogin / verifyAdmin |
| Mapoteca - Tipo Material | `/api/mapoteca/tipo_material` | 5 | verifyLogin / verifyAdmin |
| Mapoteca - Estoque | `/api/mapoteca/estoque_material` | 5 | verifyLogin / verifyAdmin |
| Mapoteca - Consumo | `/api/mapoteca/consumo_material` | 5 | verifyLogin / verifyAdmin |
| Dashboard Mapoteca | `/api/mapoteca/dashboard` | 8 | verifyLogin |
| Dashboard Acervo | *(nao montado)* | 17 | - |
| **Total (montados)** | | **101** | |
