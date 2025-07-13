# Sistema de Controle do Acervo (SCA) - API Documentation

## Overview

The SCA API is a RESTful service for managing geospatial data collections. All endpoints return JSON responses with the following structure:

```json
{
  "version": "1.0.0",
  "success": true|false,
  "message": "Response message",
  "dados": {}, // Response data (null on error)
  // Additional metadata fields may be included
}
```

## Authentication

Most endpoints require JWT authentication. After login, include the token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

## Base URL

All endpoints are prefixed with `/api`

## Endpoints

### 1. Authentication

#### POST `/api/login`
**Description**: Authenticate user and receive JWT token  
**Auth Required**: No  
**Body**:
```json
{
  "usuario": "username",
  "senha": "password",
  "cliente": "sca_qgis|sca_web"
}
```
**Response Example**: 
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Usuário autenticado com sucesso",
  "dados": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "administrador": true,
    "uuid": "123e4567-e89b-12d3-a456-426614174000"
  }
}
```

### 2. Collection (Acervo) Management

#### GET `/api/acervo/camadas_produto`
**Description**: Get all product layers with database connection info  
**Auth Required**: Yes  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Camadas de Produtos retornados com sucesso",
  "dados": [
    {
      "matviewname": "mv_produto_1_1",
      "tipo_produto": "CDGV",
      "tipo_produto_id": 1,
      "tipo_escala": "1:25.000",
      "tipo_escala_id": 1,
      "quantidade_produtos": 150,
      "banco_dados": {
        "nome_db": "sca_db",
        "servidor": "localhost",
        "porta": 5432,
        "login": "sca_user",
        "senha": "sca_pass",
        "schema": "acervo"
      }
    }
  ]
}
```

#### GET `/api/acervo/produto/detalhado/:produto_id`
**Description**: Get detailed product information including all versions and files  
**Auth Required**: Yes  
**Params**: `produto_id` (integer)  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Informações detalhadas do produto retornadas com sucesso",
  "dados": {
    "id": 123,
    "nome": "Carta Topográfica Brasília",
    "mi": "SD-23-Y-C-IV-4",
    "inom": "Brasília",
    "escala": "1:25.000",
    "denominador_escala_especial": null,
    "tipo_produto_id": 2,
    "descricao": "Carta topográfica da região de Brasília",
    "data_cadastramento": "2024-01-15T10:30:00.000Z",
    "usuario_cadastramento": "João Silva",
    "data_modificacao": "2024-03-20T14:45:00.000Z",
    "usuario_modificacao": "Maria Santos",
    "geom": "POLYGON((-47.9 -15.8, -47.8 -15.8, -47.8 -15.7, -47.9 -15.7, -47.9 -15.8))",
    "versoes": [
      {
        "versao_id": 456,
        "uuid_versao": "789e0123-e89b-12d3-a456-426614174000",
        "versao": "1-DSG",
        "nome_versao": "Primeira Edição",
        "tipo_versao_id": 1,
        "subtipo_produto_id": 2,
        "lote_id": 10,
        "versao_metadado": {
          "origem": "Levantamento aerofotogramétrico",
          "precisao": "Classe A"
        },
        "versao_descricao": "Versão inicial da carta",
        "versao_data_criacao": "2023-06-15T00:00:00.000Z",
        "versao_data_edicao": "2024-01-10T00:00:00.000Z",
        "orgao_produtor": "1º Centro de Geoinformação",
        "palavras_chave": ["topografia", "brasília", "planalto central"],
        "lote_nome": "Lote Brasília 2023",
        "lote_pit": "PIT-2023-045",
        "projeto_nome": "Mapeamento DF",
        "relacionamentos": [
          {
            "versao_relacionada_id": 789,
            "tipo_relacionamento": "Insumo"
          }
        ],
        "arquivos": [
          {
            "id": 1234,
            "uuid_arquivo": "abc12345-e89b-12d3-a456-426614174000",
            "nome": "Carta Topográfica Brasília",
            "nome_arquivo": "SD-23-Y-C-IV-4_v1",
            "tipo_arquivo_id": 1,
            "volume_armazenamento_id": 1,
            "extensao": "tif",
            "tamanho_mb": 2500.5,
            "checksum": "a1b2c3d4e5f6...",
            "metadado": {
              "resolucao": "1m",
              "datum": "SIRGAS2000"
            },
            "tipo_status_id": 1,
            "situacao_carregamento_id": 2,
            "descricao": "Arquivo principal da carta",
            "crs_original": "EPSG:31983",
            "tipo_arquivo": "Arquivo principal"
          }
        ]
      }
    ]
  }
}
```

#### POST `/api/acervo/prepare-download/arquivos`
**Description**: Prepare specific files for download  
**Auth Required**: Yes  
**Body**:
```json
{
  "arquivos_ids": [1234, 5678]
}
```
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Download preparado com sucesso. Utilize confirm-download para confirmar a conclusão da transferência.",
  "dados": [
    {
      "arquivo_id": 1234,
      "nome": "Carta Topográfica Brasília",
      "download_path": "/mnt/storage/volume1/SD-23-Y-C-IV-4_v1.tif",
      "checksum": "a1b2c3d4e5f6...",
      "download_token": "def45678-e89b-12d3-a456-426614174000"
    },
    {
      "arquivo_id": 5678,
      "nome": "Ortoimagem Brasília",
      "download_path": "/mnt/storage/volume2/ortho_bsb_2024.tif",
      "checksum": "f6e5d4c3b2a1...",
      "download_token": "ghi78901-e89b-12d3-a456-426614174000"
    }
  ]
}
```

#### POST `/api/acervo/prepare-download/produtos`
**Description**: Prepare files from products (latest versions) for download  
**Auth Required**: Yes  
**Body**:
```json
{
  "produtos_ids": [123, 124],
  "tipos_arquivo": [1, 2]
}
```
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Download preparado com sucesso. Utilize confirm-download para confirmar a conclusão da transferência.",
  "dados": [
    {
      "arquivo_id": 1234,
      "nome": "Carta Topográfica Brasília",
      "download_path": "/mnt/storage/volume1/SD-23-Y-C-IV-4_v2.tif",
      "checksum": "a1b2c3d4e5f6...",
      "download_token": "jkl01234-e89b-12d3-a456-426614174000"
    },
    {
      "arquivo_id": 5679,
      "nome": "Formato alternativo - GeoTIFF",
      "download_path": "/mnt/storage/volume1/SD-23-Y-C-IV-4_v2_alt.tif",
      "checksum": "z9y8x7w6v5u4...",
      "download_token": "mno34567-e89b-12d3-a456-426614174000"
    }
  ]
}
```

#### POST `/api/acervo/confirm-download`
**Description**: Confirm download completion  
**Auth Required**: Yes  
**Body**:
```json
{
  "confirmations": [
    {
      "download_token": "def45678-e89b-12d3-a456-426614174000",
      "success": true,
      "error_message": null
    },
    {
      "download_token": "ghi78901-e89b-12d3-a456-426614174000",
      "success": false,
      "error_message": "Checksum mismatch"
    }
  ]
}
```
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Status de download atualizado com sucesso",
  "dados": [
    {
      "download_token": "def45678-e89b-12d3-a456-426614174000",
      "arquivo_id": 1234,
      "nome": "Carta Topográfica Brasília",
      "status": "completed"
    },
    {
      "download_token": "ghi78901-e89b-12d3-a456-426614174000",
      "arquivo_id": 5678,
      "nome": "Ortoimagem Brasília",
      "status": "failed"
    }
  ]
}
```

#### GET `/api/acervo/situacao-geral`
**Description**: Get general situation as GeoJSON for cartographic products  
**Auth Required**: Yes  
**Query Params**: `scale25k=true&scale50k=true`  
**Response**: ZIP file containing GeoJSON files (binary response)

### 3. File Management

#### POST `/api/arquivo/prepare-upload/files`
**Description**: Prepare to add files to existing versions  
**Auth Required**: Yes  
**Body**:
```json
{
  "arquivos": [
    {
      "nome": "Carta Topográfica Atualizada",
      "nome_arquivo": "SD-23-Y-C-IV-4_v2",
      "versao_id": 456,
      "tipo_arquivo_id": 1,
      "extensao": "tif",
      "tamanho_mb": 2800.5,
      "checksum": "b2c3d4e5f6a7...",
      "metadado": {
        "resolucao": "0.5m",
        "processamento": "ortorretificado"
      },
      "situacao_carregamento_id": 1,
      "descricao": "Versão atualizada com novos dados",
      "crs_original": "EPSG:31983"
    }
  ]
}
```
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Upload de arquivos preparado com sucesso. Transfira os arquivos e utilize confirm-upload para confirmar.",
  "dados": {
    "session_uuid": "pqr45678-e89b-12d3-a456-426614174000",
    "operation_type": "add_files",
    "arquivos": [
      {
        "nome": "Carta Topográfica Atualizada",
        "nome_arquivo": "SD-23-Y-C-IV-4_v2",
        "versao_id": 456,
        "destination_path": "/mnt/storage/volume1/SD-23-Y-C-IV-4_v2.tif",
        "checksum": "b2c3d4e5f6a7..."
      }
    ]
  }
}
```

#### POST `/api/arquivo/prepare-upload/version`
**Description**: Prepare to add new versions with files to existing products  
**Auth Required**: Yes  
**Body**:
```json
{
  "versoes": [
    {
      "produto_id": 123,
      "versao": {
        "uuid_versao": null,
        "versao": "2-DSG",
        "nome": "Segunda Edição",
        "tipo_versao_id": 1,
        "subtipo_produto_id": 2,
        "lote_id": 15,
        "metadado": {
          "atualizacao": "2024",
          "fonte": "Imagens de satélite"
        },
        "descricao": "Atualização completa da carta",
        "orgao_produtor": "1º Centro de Geoinformação",
        "palavras_chave": ["topografia", "brasília", "atualizada"],
        "data_criacao": "2024-01-01T00:00:00.000Z",
        "data_edicao": "2024-03-15T00:00:00.000Z"
      },
      "arquivos": [
        {
          "nome": "Carta Topográfica Brasília v2",
          "nome_arquivo": "SD-23-Y-C-IV-4_v2",
          "tipo_arquivo_id": 1,
          "extensao": "tif",
          "tamanho_mb": 3000.0,
          "checksum": "c3d4e5f6a7b8...",
          "metadado": {},
          "situacao_carregamento_id": 1,
          "descricao": "Arquivo principal segunda edição",
          "crs_original": "EPSG:31983"
        }
      ]
    }
  ]
}
```
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Upload de versão preparado com sucesso. Transfira os arquivos e utilize confirm-upload para confirmar.",
  "dados": {
    "session_uuid": "stu67890-e89b-12d3-a456-426614174000",
    "operation_type": "add_version",
    "versoes": [
      {
        "produto_id": 123,
        "versao_info": {
          "versao": "2-DSG",
          "nome": "Segunda Edição"
        },
        "arquivos": [
          {
            "nome": "Carta Topográfica Brasília v2",
            "nome_arquivo": "SD-23-Y-C-IV-4_v2",
            "destination_path": "/mnt/storage/volume1/SD-23-Y-C-IV-4_v2.tif",
            "checksum": "c3d4e5f6a7b8..."
          }
        ]
      }
    ]
  }
}
```

#### POST `/api/arquivo/confirm-upload`
**Description**: Confirm file upload completion and validate checksums  
**Auth Required**: Yes  
**Body**:
```json
{
  "session_uuid": "pqr45678-e89b-12d3-a456-426614174000"
}
```
**Response Example (Success)**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Validação de upload concluída com sucesso",
  "dados": {
    "session_uuid": "pqr45678-e89b-12d3-a456-426614174000",
    "operation_type": "add_files",
    "status": "completed",
    "versoes": [
      {
        "versao_id": 456,
        "files": [
          {
            "nome": "Carta Topográfica Atualizada",
            "nome_arquivo": "SD-23-Y-C-IV-4_v2",
            "status": "completed",
            "error_message": null
          }
        ]
      }
    ]
  }
}
```

**Response Example (Failure)**:
```json
{
  "version": "1.0.0",
  "success": false,
  "message": "Upload falhou na validação: Um ou mais arquivos falharam na validação",
  "dados": {
    "session_uuid": "pqr45678-e89b-12d3-a456-426614174000",
    "operation_type": "add_files",
    "status": "failed",
    "error_message": "Um ou mais arquivos falharam na validação",
    "detalhes": [
      {
        "versao_id": 456,
        "files": [
          {
            "nome": "Carta Topográfica Atualizada",
            "nome_arquivo": "SD-23-Y-C-IV-4_v2",
            "status": "failed",
            "error_message": "Falha na validação do checksum"
          }
        ]
      }
    ]
  }
}
```

### 4. Product Management

#### PUT `/api/produtos/produto`
**Description**: Update product information  
**Auth Required**: Admin  
**Body**:
```json
{
  "id": 123,
  "nome": "Carta Topográfica Brasília - Atualizada",
  "mi": "SD-23-Y-C-IV-4",
  "inom": "Brasília",
  "tipo_escala_id": 1,
  "denominador_escala_especial": null,
  "tipo_produto_id": 2,
  "descricao": "Carta topográfica atualizada da região de Brasília"
}
```
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Produto atualizado com sucesso",
  "dados": null
}
```

#### DELETE `/api/produtos/produto`
**Description**: Delete products and all associated data  
**Auth Required**: Admin  
**Body**:
```json
{
  "produto_ids": [123, 124],
  "motivo_exclusao": "Produtos obsoletos - substituídos por nova edição"
}
```
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Produtos deletados com sucesso",
  "dados": null
}
```

#### GET `/api/produtos/versao_relacionamento`
**Description**: Get all version relationships  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Versão Relacionamento retornada com sucesso",
  "dados": [
    {
      "id": 1,
      "versao_id_1": 456,
      "versao_id_2": 789,
      "tipo_relacionamento_id": 1,
      "tipo_relacionamento_nome": "Insumo",
      "data_relacionamento": "2024-02-15T10:30:00.000Z",
      "usuario_relacionamento_uuid": "123e4567-e89b-12d3-a456-426614174000",
      "versao_1_nome": "1-DSG",
      "produto_id_1": 123,
      "produto_nome_1": "Carta Topográfica Brasília",
      "mi_1": "SD-23-Y-C-IV-4",
      "inom_1": "Brasília",
      "versao_2_nome": "1-DSG",
      "produto_id_2": 125,
      "produto_nome_2": "Ortoimagem Brasília",
      "mi_2": "SD-23-Y-C-IV-4-NO",
      "inom_2": "Brasília Norte"
    }
  ]
}
```

### 5. Project and Lot Management

#### GET `/api/projetos/projeto`
**Description**: Get all projects  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Projetos retornados com sucesso",
  "dados": [
    {
      "id": 1,
      "nome": "Mapeamento Distrito Federal 2024",
      "descricao": "Projeto de atualização cartográfica do DF",
      "data_inicio": "2024-01-01",
      "data_fim": "2024-12-31",
      "status_execucao_id": 2,
      "status_execucao": "Em execução",
      "data_cadastramento": "2023-12-15T10:00:00.000Z",
      "usuario_cadastramento_uuid": "123e4567-e89b-12d3-a456-426614174000",
      "data_modificacao": null,
      "usuario_modificacao_uuid": null
    }
  ]
}
```

#### POST `/api/projetos/projeto`
**Description**: Create new project  
**Auth Required**: Admin  
**Body**:
```json
{
  "nome": "Mapeamento Região Norte 2025",
  "descricao": "Novo projeto de mapeamento",
  "data_inicio": "2025-01-01",
  "data_fim": "2025-12-31",
  "status_execucao_id": 1
}
```
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Projeto \"Mapeamento Região Norte 2025\" criado com sucesso",
  "dados": {
    "id": 2,
    "nome": "Mapeamento Região Norte 2025",
    "message": "Projeto \"Mapeamento Região Norte 2025\" criado com sucesso"
  }
}
```

#### GET `/api/projetos/lote`
**Description**: Get all lots  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Lotes retornados com sucesso",
  "dados": [
    {
      "id": 10,
      "projeto_id": 1,
      "pit": "PIT-2024-001",
      "nome": "Lote Brasília Central",
      "descricao": "Mapeamento da região central de Brasília",
      "data_inicio": "2024-01-15",
      "data_fim": "2024-03-30",
      "status_execucao_id": 3,
      "status_execucao": "Concluído",
      "projeto": "Mapeamento Distrito Federal 2024",
      "data_cadastramento": "2024-01-10T09:00:00.000Z",
      "usuario_cadastramento_uuid": "123e4567-e89b-12d3-a456-426614174000",
      "data_modificacao": "2024-03-30T16:00:00.000Z",
      "usuario_modificacao_uuid": "456e7890-e89b-12d3-a456-426614174000"
    }
  ]
}
```

### 6. User Management

#### GET `/api/usuarios`
**Description**: Get all system users  
**Auth Required**: Admin  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Usuários retornados",
  "dados": [
    {
      "uuid": "123e4567-e89b-12d3-a456-426614174000",
      "login": "joao.silva",
      "nome": "João Pedro da Silva",
      "tipo_posto_grad_id": 13,
      "tipo_posto_grad": "Cap",
      "nome_guerra": "Silva",
      "administrador": true,
      "ativo": true
    },
    {
      "uuid": "456e7890-e89b-12d3-a456-426614174000",
      "login": "maria.santos",
      "nome": "Maria dos Santos",
      "tipo_posto_grad_id": 1,
      "tipo_posto_grad": "Civ",
      "nome_guerra": "Santos",
      "administrador": false,
      "ativo": true
    }
  ]
}
```

#### PUT `/api/usuarios/:uuid`
**Description**: Update user permissions  
**Auth Required**: Admin  
**Params**: `uuid` = "123e4567-e89b-12d3-a456-426614174000"  
**Body**:
```json
{
  "administrador": true,
  "ativo": true
}
```
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Usuário atualizado com sucesso",
  "dados": null
}
```

### 7. Volume Management

#### GET `/api/volumes/volume_armazenamento`
**Description**: Get storage volumes  
**Auth Required**: Admin  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Volume de armazenamento retornada com sucesso",
  "dados": [
    {
      "id": 1,
      "volume": "/mnt/storage/volume1",
      "nome": "Volume Principal",
      "capacidade_gb": 10000
    },
    {
      "id": 2,
      "volume": "/mnt/storage/volume2",
      "nome": "Volume Secundário",
      "capacidade_gb": 5000
    }
  ]
}
```

#### GET `/api/volumes/volume_tipo_produto`
**Description**: Get volume-product type associations  
**Auth Required**: Admin  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Volume Tipo Produto retornada com sucesso",
  "dados": [
    {
      "id": 1,
      "tipo_produto_id": 2,
      "volume_armazenamento_id": 1,
      "primario": true,
      "tipo_produto": "Carta Topográfica",
      "volume": "/mnt/storage/volume1",
      "nome_volume": "Volume Principal",
      "volume_capacidade_gb": 10000
    },
    {
      "id": 2,
      "tipo_produto_id": 4,
      "volume_armazenamento_id": 2,
      "primario": true,
      "tipo_produto": "Ortoimagem",
      "volume": "/mnt/storage/volume2",
      "nome_volume": "Volume Secundário",
      "volume_capacidade_gb": 5000
    }
  ]
}
```

### 8. Domain Data

#### GET `/api/gerencia/dominio/tipo_produto`
**Description**: Get product types  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Domínio Tipos de produto retornados com sucesso",
  "dados": [
    {
      "code": 1,
      "nome": "CDGV"
    },
    {
      "code": 2,
      "nome": "Carta Topográfica"
    },
    {
      "code": 3,
      "nome": "Carta Ortoimagem"
    },
    {
      "code": 4,
      "nome": "Ortoimagem"
    },
    {
      "code": 5,
      "nome": "Modelo Digital de Superfície"
    }
  ]
}
```

#### GET `/api/gerencia/dominio/tipo_escala`
**Description**: Get scale types  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Domínio Tipo Escala retornado com sucesso",
  "dados": [
    {
      "code": 1,
      "nome": "1:25.000"
    },
    {
      "code": 2,
      "nome": "1:50.000"
    },
    {
      "code": 3,
      "nome": "1:100.000"
    },
    {
      "code": 4,
      "nome": "1:250.000"
    },
    {
      "code": 5,
      "nome": "Escala personalizada"
    }
  ]
}
```

#### GET `/api/gerencia/dominio/subtipo_produto`
**Description**: Get product subtypes  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Domínio Subtipo de Produto retornado com sucesso",
  "dados": [
    {
      "code": 1,
      "nome": "Conjunto de dados geoespaciais vetoriais - ET-EDGV 2.1.3",
      "tipo_id": 1,
      "tipo_produto": "CDGV"
    },
    {
      "code": 2,
      "nome": "Carta Topográfica - T34-700",
      "tipo_id": 2,
      "tipo_produto": "Carta Topográfica"
    },
    {
      "code": 3,
      "nome": "Carta Ortoimagem",
      "tipo_id": 3,
      "tipo_produto": "Carta Ortoimagem"
    }
  ]
}
```

#### GET `/api/gerencia/dominio/tipo_arquivo`
**Description**: Get file types  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Domínio Tipo de Arquivos retornado com sucesso",
  "dados": [
    {
      "code": 1,
      "nome": "Arquivo principal"
    },
    {
      "code": 2,
      "nome": "Formato alternativo"
    },
    {
      "code": 3,
      "nome": "Insumo"
    },
    {
      "code": 4,
      "nome": "Metadados"
    },
    {
      "code": 5,
      "nome": "JSON Edição"
    },
    {
      "code": 6,
      "nome": "Documentos"
    },
    {
      "code": 7,
      "nome": "Projeto QGIS"
    },
    {
      "code": 8,
      "nome": "Arquivos complementares"
    },
    {
      "code": 9,
      "nome": "Tileserver"
    }
  ]
}
```

#### GET `/api/gerencia/dominio/situacao_carregamento`
**Description**: Get loading situations  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Domínio Situação de carregamento retornado com sucesso",
  "dados": [
    {
      "code": 1,
      "nome": "Não carregado"
    },
    {
      "code": 2,
      "nome": "Carregado BDGEx Ostensivo"
    },
    {
      "code": 3,
      "nome": "Carregado BDGEx Operações"
    },
    {
      "code": 4,
      "nome": "Carregado IGW"
    },
    {
      "code": 5,
      "nome": "Carregado GEDW"
    }
  ]
}
```

### 9. Dashboard Endpoints

#### GET `/api/dashboard/produtos_total`
**Description**: Get total product count  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Total de produtos retornado com sucesso",
  "dados": {
    "total_produtos": "1247"
  }
}
```

#### GET `/api/dashboard/arquivos_total_gb`
**Description**: Get total file storage in GB  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Total de gb retornado com sucesso",
  "dados": {
    "total_gb": "4567.89"
  }
}
```

#### GET `/api/dashboard/produtos_tipo`
**Description**: Get product count by type  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Total de produtos por tipo com sucesso",
  "dados": [
    {
      "tipo_produto_id": 2,
      "tipo_produto": "Carta Topográfica",
      "quantidade": "534"
    },
    {
      "tipo_produto_id": 4,
      "tipo_produto": "Ortoimagem",
      "quantidade": "321"
    },
    {
      "tipo_produto_id": 1,
      "tipo_produto": "CDGV",
      "quantidade": "289"
    }
  ]
}
```

#### GET `/api/dashboard/gb_tipo_produto`
**Description**: Get storage GB by product type  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Gb por tipo de produto retornado com sucesso",
  "dados": [
    {
      "tipo_produto_id": 4,
      "tipo_produto": "Ortoimagem",
      "total_gb": "2345.67"
    },
    {
      "tipo_produto_id": 2,
      "tipo_produto": "Carta Topográfica",
      "total_gb": "1234.56"
    },
    {
      "tipo_produto_id": 5,
      "tipo_produto": "Modelo Digital de Superfície",
      "total_gb": "987.66"
    }
  ]
}
```

#### GET `/api/dashboard/arquivos_dia`
**Description**: Get files uploaded per day (last 30 days)  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Arquivos carregados por dia retornadas com sucesso",
  "dados": [
    {
      "dia": "2024-03-20",
      "quantidade": "15"
    },
    {
      "dia": "2024-03-19",
      "quantidade": "23"
    },
    {
      "dia": "2024-03-18",
      "quantidade": "8"
    }
  ]
}
```

#### GET `/api/dashboard/gb_volume`
**Description**: Get storage distribution by volume  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Gb por volume retornados com sucesso",
  "dados": [
    {
      "volume_armazenamento_id": 1,
      "nome_volume": "Volume Principal",
      "volume": "/mnt/storage/volume1",
      "capacidade_gb_volume": 10000,
      "total_gb": "3456.78"
    },
    {
      "volume_armazenamento_id": 2,
      "nome_volume": "Volume Secundário",
      "volume": "/mnt/storage/volume2",
      "capacidade_gb_volume": 5000,
      "total_gb": "1111.11"
    }
  ]
}
```

#### GET `/api/dashboard/ultimos_carregamentos`
**Description**: Get last 10 file uploads  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Ultimos carregamentos de arquivo retornados com sucesso",
  "dados": [
    {
      "id": 5678,
      "uuid_arquivo": "xyz98765-e89b-12d3-a456-426614174000",
      "nome": "Carta Topográfica São Paulo",
      "nome_arquivo": "SF-23-Y-C-VI-2_v1",
      "versao_id": 890,
      "tipo_arquivo_id": 1,
      "volume_armazenamento_id": 1,
      "extensao": "tif",
      "tamanho_mb": 3200.5,
      "checksum": "d4e5f6a7b8c9...",
      "metadado": {},
      "tipo_status_id": 1,
      "situacao_carregamento_id": 2,
      "crs_original": "EPSG:31983",
      "descricao": "Carta topográfica região metropolitana SP",
      "data_cadastramento": "2024-03-20T14:30:00.000Z",
      "usuario_cadastramento_uuid": "789e0123-e89b-12d3-a456-426614174000",
      "data_modificacao": null,
      "usuario_modificacao_uuid": null,
      "orgao_produtor": "1º Centro de Geoinformação"
    }
  ]
}
```

### 10. Management Endpoints

#### GET `/api/gerencia/arquivos_deletados`
**Description**: Get deleted files history  
**Auth Required**: Admin  
**Query Params**: `page=1&limit=20`  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Arquivos deletados retornados com sucesso",
  "dados": [
    {
      "id": 1,
      "uuid_arquivo": "abc12345-e89b-12d3-a456-426614174000",
      "nome": "Carta Antiga",
      "nome_arquivo": "carta_antiga_v1",
      "motivo_exclusao": "Substituída por versão atualizada",
      "versao_id": null,
      "versao": null,
      "versao_nome": null,
      "produto": "Carta Topográfica Teste",
      "mi": "NA-20-X-D-VI",
      "inom": "Teste",
      "escala": "1:50.000",
      "tipo_arquivo_id": 1,
      "tipo_arquivo_nome": "Arquivo principal",
      "volume_armazenamento_id": 1,
      "volume_armazenamento_nome": "Volume Principal",
      "volume_armazenamento": "/mnt/storage/volume1",
      "extensao": "tif",
      "tamanho_mb": 1500.5,
      "checksum": "old123...",
      "data_delete": "2024-03-15T10:00:00.000Z",
      "usuario_delete_nome": "Admin Silva"
    }
  ],
  "pagination": {
    "totalItems": 42,
    "totalPages": 3,
    "currentPage": 1,
    "pageSize": 20
  }
}
```

#### POST `/api/gerencia/verificar_inconsistencias`
**Description**: Check file consistency in storage  
**Auth Required**: Admin  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Verificação de consistência concluída com sucesso",
  "dados": {
    "arquivos_atualizados": 3,
    "arquivos_deletados_atualizados": 1
  }
}
```

### 11. Mapoteca Module

#### GET `/api/mapoteca/cliente`
**Description**: List all clients with order statistics  
**Auth Required**: Yes  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Clientes retornados com sucesso",
  "dados": [
    {
      "id": 1,
      "nome": "1º Batalhão de Infantaria",
      "ponto_contato_principal": "Cap Silva - (61) 3234-5678",
      "endereco_entrega_principal": "SGAN 902 - Brasília/DF",
      "tipo_cliente_id": 1,
      "tipo_cliente_nome": "OM EB",
      "total_pedidos": 15,
      "data_ultimo_pedido": "2024-03-15T10:00:00.000Z",
      "pedidos_em_andamento": 2,
      "pedidos_concluidos": 12,
      "total_produtos": 45
    }
  ]
}
```

#### GET `/api/mapoteca/pedido`
**Description**: List all orders  
**Auth Required**: Yes  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Pedidos retornados com sucesso",
  "dados": [
    {
      "id": 123,
      "data_pedido": "2024-03-20T09:00:00.000Z",
      "data_atendimento": null,
      "cliente_id": 1,
      "cliente_nome": "1º Batalhão de Infantaria",
      "situacao_pedido_id": 3,
      "situacao_pedido_nome": "Em andamento",
      "documento_solicitacao": "DIEx nº 045-S3",
      "documento_solicitacao_nup": "64123.001234/2024-15",
      "prazo": "2024-04-20",
      "localizador_pedido": "AB3C-D5F7-H9K2",
      "localizador_envio": null,
      "observacao_envio": null,
      "usuario_criacao_nome": "Sgt Santos",
      "data_criacao": "2024-03-20T09:00:00.000Z",
      "quantidade_produtos": 5
    }
  ]
}
```

#### GET `/api/mapoteca/pedido/localizador/AB3C-D5F7-H9K2`
**Description**: Get order by tracking code (public access)  
**Auth Required**: No  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Pedido encontrado com sucesso",
  "dados": {
    "id": 123,
    "localizador_pedido": "AB3C-D5F7-H9K2",
    "data_pedido": "2024-03-20T09:00:00.000Z",
    "situacao_pedido_id": 5,
    "situacao_pedido_nome": "Concluído",
    "cliente_id": 1,
    "cliente_nome": "1º Batalhão de Infantaria",
    "prazo": "2024-04-20",
    "localizador_envio": "SEDEX123456789BR",
    "observacao_envio": "Enviado via SEDEX",
    "motivo_cancelamento": null
  }
}
```

#### GET `/api/mapoteca/dashboard/order_status`
**Description**: Get order status distribution  
**Auth Required**: Yes  
**Response Example**:
```json
{
  "version": "1.0.0",
  "success": true,
  "message": "Distribuição de status de pedidos retornada com sucesso",
  "dados": {
    "total": 150,
    "em_andamento": 25,
    "concluidos": 110,
    "pendentes": 35,
    "distribuicao": [
      {
        "id": 1,
        "nome": "Pré cadastramento do pedido realizado",
        "quantidade": 10
      },
      {
        "id": 2,
        "nome": "DIEx/Ofício do pedido recebido",
        "quantidade": 15
      },
      {
        "id": 3,
        "nome": "Em andamento",
        "quantidade": 25
      },
      {
        "id": 4,
        "nome": "Remetido",
        "quantidade": 5
      },
      {
        "id": 5,
        "nome": "Concluído",
        "quantidade": 110
      },
      {
        "id": 6,
        "nome": "Cancelado",
        "quantidade": 5
      }
    ]
  }
}
```

## Error Response Examples

### Validation Error (400)
```json
{
  "version": "1.0.0",
  "success": false,
  "message": "Erro de validação dos Dados. Mensagem de erro: \"usuario\" is required",
  "dados": null
}
```

### Unauthorized Error (401)
```json
{
  "version": "1.0.0",
  "success": false,
  "message": "Falha ao autenticar token",
  "dados": null
}
```

### Forbidden Error (403)
```json
{
  "version": "1.0.0",
  "success": false,
  "message": "Usuário necessita ser um administrador",
  "dados": null
}
```

### Not Found Error (404)
```json
{
  "version": "1.0.0",
  "success": false,
  "message": "Produto não encontrado",
  "dados": null
}
```

### Internal Server Error (500)
```json
{
  "version": "1.0.0",
  "success": false,
  "message": "Erro no servidor",
  "dados": null
}
```

## Important Notes

1. **Authentication**: All endpoints except login and some domain endpoints require authentication
2. **Admin Routes**: Endpoints marked as "Admin" require administrator privileges
3. **File Operations**: The system uses a two-phase commit for file operations to ensure consistency
4. **Pagination**: Some endpoints support pagination via `page` and `limit` query parameters
5. **Timestamps**: All dates/times are in ISO 8601 format with timezone
6. **Checksums**: SHA256 checksums are required for file integrity
7. **Null Values**: Many fields can be null, especially for optional data like `denominador_escala_especial`, `data_fim`, etc.