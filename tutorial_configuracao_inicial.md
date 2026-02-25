# Tutorial de Configuração Inicial do SCA

Guia passo a passo para configurar o sistema **Controle do Acervo (SCA)** do zero, assumindo que o servidor já está rodando e o plugin QGIS está instalado.

---

## Pré-requisitos

- Servidor do SCA rodando e acessível na rede
- Servidor de autenticação externo rodando e acessível
- QGIS 3 com o plugin **Ferramentas de Controle do Acervo** instalado
- Conta de administrador cadastrada no servidor de autenticação

---

## Passo 1 — Login no Plugin

1. Abra o QGIS e clique no ícone do plugin na barra de ferramentas
2. Informe a **URL do servidor** SCA, seu **login** e **senha**
3. Marque "Lembrar credenciais" se desejar (opcional)
4. Clique em **Entrar**

Após autenticação, o painel lateral abre no lado direito do QGIS com o menu de operações organizado em categorias. Como administrador, todas as categorias ficam visíveis.

---

## Passo 2 — Sincronizar Usuários

Antes de qualquer coisa, é preciso importar os usuários do servidor de autenticação para o SCA.

1. No painel lateral, expanda **Administração Avançada**
2. Clique em **Gerenciar Usuários**
3. Importe os usuários do servidor de autenticação
4. Marque quais usuários terão permissão de **administrador**
5. Confirme as alterações

> Sem esse passo, nenhum outro usuário conseguirá acessar o sistema.

---

## Passo 3 — Criar Volumes de Armazenamento

Volumes são os diretórios físicos (discos, pastas de rede, etc.) onde os arquivos dos produtos serão armazenados. É obrigatório ter ao menos um volume antes de cadastrar qualquer produto.

1. No painel lateral, vá em **Administração Avançada → Gerenciar Volumes**
2. Adicione um novo volume informando:
   - **Nome** — identificador do volume (ex: `Volume_Principal`)
   - **Caminho** — caminho completo no sistema de arquivos (ex: `/dados/acervo/`)
   - **Capacidade (GB)** — espaço disponível no volume
3. Repita para cada volume que desejar criar

> O caminho informado precisa existir no servidor e ter permissão de escrita.

---

## Passo 4 — Associar Volumes aos Tipos de Produto

Cada tipo de produto (Carta Topográfica, Ortoimagem, MDE, etc.) precisa estar vinculado a pelo menos um volume, sendo um deles marcado como **primário** (destino padrão dos arquivos daquele tipo).

1. Vá em **Administração Avançada → Gerenciar Relacionamento Volume e Tipo de Produto**
2. Para cada tipo de produto que você pretende utilizar:
   - Selecione o **tipo de produto**
   - Selecione o **volume de armazenamento**
   - Marque como **primário** se for o volume padrão para esse tipo
3. Confirme as associações

> Só é possível ter **um volume primário** por tipo de produto. Volumes secundários podem ser adicionados para distribuir armazenamento.

---

## Passo 5 — Criar Projetos

Projetos são a estrutura organizacional de nível mais alto. Cada projeto agrupa lotes de trabalho.

1. Vá em **Administração Avançada → Gerenciar Projetos**
2. Clique em **Adicionar** e preencha:
   - **Nome** do projeto
   - **Descrição**
   - **Data de início**
   - **Data de fim** (opcional)
   - **Situação de execução** (Não iniciado, Em andamento, etc.)
3. Salve o projeto

---

## Passo 6 — Criar Lotes

Lotes são subdivisões de um projeto. Versões de produtos podem ser vinculadas a lotes.

1. Vá em **Administração Avançada → Gerenciar Lotes**
2. Clique em **Adicionar** e preencha:
   - **Projeto** ao qual o lote pertence
   - **PIT** (identificador)
   - **Nome** e **Descrição**
   - **Data de início** e **fim** (opcional)
   - **Situação de execução**
3. Salve o lote

---

## Passo 7 — Cadastrar Produtos

Com volumes configurados e a estrutura organizacional pronta, é hora de cadastrar os produtos geográficos. A forma mais prática para carga inicial é a operação em lote descrita abaixo.

> Para cadastrar um único produto manualmente, use **Funções de Administrador → Adicionar Produto**. Para criar apenas os produtos sem versões/arquivos, use **Operações em Lote → Criar Produtos em Lote**.

### Adicionar Produtos Completos em Lote (recomendado)

Esta operação cria produtos, versões e arquivos de uma só vez a partir de uma camada tabular no QGIS.

#### 7.1 — Criar a camada modelo

1. Vá em **Operações em Lote → Adicionar Produtos Completos em Lote**
2. Clique em **Criar Camada Modelo** — o plugin cria uma camada tabular (sem geometria) no QGIS com todos os campos necessários
3. Feche o diálogo temporariamente para preencher a camada

#### 7.2 — Preencher a camada

Abra a tabela de atributos da camada modelo e adicione uma linha para cada **arquivo**. A estrutura hierárquica é controlada por IDs de agrupamento:

```
Produto (produto_grupo_id = 1)
  └─ Versão (versao_grupo_id = 1)
      ├─ Arquivo 1  ← linha 1
      └─ Arquivo 2  ← linha 2
Produto (produto_grupo_id = 2)
  └─ Versão (versao_grupo_id = 2)
      ├─ Arquivo 1  ← linha 3
      └─ Arquivo 2  ← linha 4
```

- Linhas com o mesmo `produto_grupo_id` pertencem ao **mesmo produto**
- Linhas com o mesmo `versao_grupo_id` pertencem à **mesma versão**
- Cada linha representa um **arquivo** individual

**Campos obrigatórios do produto** (repetir os mesmos valores para todas as linhas do mesmo produto):

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| `produto_grupo_id` | ID de agrupamento do produto | `1` |
| `produto_nome` | Nome do produto | `Carta Brasília` |
| `tipo_produto_id` | ID do tipo de produto (domínio) | `2` |
| `tipo_escala_id` | ID da escala (domínio) | `3` (1:100.000) |
| `geom` | Geometria em WKT (polígono) | `POLYGON((-47.9 -15.7, ...))` |

Campos opcionais do produto: `mi`, `inom`, `denominador_escala_especial`, `descricao_produto`.

**Campos obrigatórios da versão** (repetir os mesmos valores para todas as linhas da mesma versão):

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| `versao_grupo_id` | ID de agrupamento da versão | `1` |
| `versao` | Número da versão | `1-DSGEO` |
| `nome_versao` | Nome de exibição | `Versão 1` |
| `tipo_versao_id` | Tipo da versão (domínio) | `1` (Regular) |
| `subtipo_produto_id` | Subtipo do produto (domínio) | `3` |
| `orgao_produtor` | Órgão produtor | `DSG/1CGEO` |
| `data_criacao` | Data de criação (ISO) | `2025-06-15` |
| `data_edicao` | Data de edição (ISO) | `2025-06-15` |

Campos opcionais da versão: `lote_id`, `descricao_versao`, `palavras_chave` (separadas por vírgula), `metadado_versao` (JSON).

**Campos obrigatórios do arquivo** (um por linha):

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| `nome` | Nome de exibição do arquivo | `Ortofoto RGB` |
| `nome_arquivo` | Nome físico (sem extensão) | `ortofoto_brasilia_rgb` |
| `tipo_arquivo_id` | Tipo do arquivo (domínio) | `1` (Principal) |
| `extensao` | Extensão do arquivo | `tif` |
| `path` | Caminho completo do arquivo local | `/dados/originais/ortofoto.tif` |
| `situacao_carregamento_id` | Situação de carregamento | `1` |

Campos opcionais do arquivo: `descricao_arquivo`, `uuid_arquivo`, `uuid_versao`, `crs_original`, `metadado` (JSON).

> **Tipos de arquivo** — 1: Principal, 2: Formato alternativo, 3: Insumo, 4: Metadado, 5: Edição JSON, 6: Documentos, 7: Projeto QGIS, 8: Complementar, 9: Tileserver (URL, não precisa de arquivo físico nem extensão).

#### 7.3 — Executar a carga

1. Reabra **Operações em Lote → Adicionar Produtos Completos em Lote**
2. Selecione a camada preenchida no dropdown
3. Clique em **Carregar**

O plugin executa automaticamente:

1. **Validação** — verifica campos obrigatórios, existência dos arquivos no disco e formatos
2. **Cálculo de checksums** — gera hash SHA-256 de cada arquivo
3. **Envio dos metadados ao servidor** — o servidor valida INOMs duplicados, verifica espaço nos volumes e cria uma sessão de upload
4. **Transferência dos arquivos** — copia os arquivos em paralelo para os volumes de destino (barra de progresso exibida)
5. **Confirmação** — o servidor valida os checksums dos arquivos recebidos e insere tudo no banco (produtos, versões e arquivos)

Ao final, uma mensagem confirma o sucesso ou lista os erros encontrados. Se algum arquivo falhar na transferência, o plugin oferece a opção de retentar apenas os que falharam.

#### Exemplo prático

Para cadastrar 2 cartas topográficas, cada uma com 1 versão e 2 arquivos (principal + metadado):

| produto_grupo_id | versao_grupo_id | produto_nome | tipo_produto_id | tipo_escala_id | geom | versao | nome_versao | tipo_versao_id | subtipo_produto_id | orgao_produtor | data_criacao | data_edicao | nome | nome_arquivo | tipo_arquivo_id | extensao | path | situacao_carregamento_id |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | Carta Brasília | 2 | 3 | POLYGON((...)) | 1-DSGEO | Versão 1 | 1 | 3 | DSG/1CGEO | 2025-06-15 | 2025-06-15 | Carta Principal | carta_brasilia | 1 | tif | /dados/carta_bsb.tif | 1 |
| 1 | 1 | Carta Brasília | 2 | 3 | POLYGON((...)) | 1-DSGEO | Versão 1 | 1 | 3 | DSG/1CGEO | 2025-06-15 | 2025-06-15 | Metadado XML | carta_brasilia_meta | 4 | xml | /dados/carta_bsb.xml | 1 |
| 2 | 2 | Carta Goiânia | 2 | 3 | POLYGON((...)) | 1-DSGEO | Versão 1 | 1 | 3 | DSG/1CGEO | 2025-06-15 | 2025-06-15 | Carta Principal | carta_goiania | 1 | tif | /dados/carta_gyn.tif | 1 |
| 2 | 2 | Carta Goiânia | 2 | 3 | POLYGON((...)) | 1-DSGEO | Versão 1 | 1 | 3 | DSG/1CGEO | 2025-06-15 | 2025-06-15 | Metadado XML | carta_goiania_meta | 4 | xml | /dados/carta_gyn.xml | 1 |

---

## Passo 8 — Criar Visões Materializadas

Após o cadastro inicial de produtos, é necessário criar as visões materializadas para que as camadas de consulta fiquem disponíveis no QGIS.

1. Vá em **Diagnóstico e Manutenção → Criar Visão Materializada**
2. Execute a criação

> Sempre que fizer cargas em lote significativas, atualize as visões em **Diagnóstico e Manutenção → Atualizar Visões Materializadas**.

---

## Passo 9 — Verificar a Configuração

Para confirmar que tudo está funcionando:

1. Vá em **Funções Gerais → Carregar Camadas de Produtos**
2. Selecione um tipo de produto e escala
3. A camada deve carregar no mapa do QGIS com os polígonos dos produtos cadastrados
4. Clique em um produto no mapa e use **Funções Gerais → Informações do Produto** para ver detalhes das versões e arquivos

---

## Passo 10 — Verificar Inconsistências (opcional)

Como boa prática após a configuração inicial:

1. Vá em **Diagnóstico e Manutenção → Verificar Inconsistências**
2. Execute a verificação
3. Corrija eventuais problemas reportados (arquivos órfãos, referências quebradas, etc.)

---

## Resumo da Ordem de Configuração

| Passo | Onde | O quê |
|-------|------|-------|
| 1 | Login | Autenticar no sistema |
| 2 | Administração Avançada | Sincronizar usuários |
| 3 | Administração Avançada | Criar volumes de armazenamento |
| 4 | Administração Avançada | Associar volumes aos tipos de produto |
| 5 | Administração Avançada | Criar projetos |
| 6 | Administração Avançada | Criar lotes |
| 7 | Funções de Administrador / Operações em Lote | Cadastrar produtos |
| 8 | Diagnóstico e Manutenção | Criar visões materializadas |
| 9 | Funções Gerais | Verificar carregamento de camadas |
| 10 | Diagnóstico e Manutenção | Verificar inconsistências |

---

## Observações Importantes

- **Geometrias** utilizam o sistema de referência **EPSG:4674** (SIRGAS 2000)
- **Tokens JWT** expiram em 1 hora; o plugin tenta renovar automaticamente
- **Sessões de upload** expiram em 24 horas e são limpas automaticamente
- **Volumes** precisam ter espaço suficiente e o servidor precisa ter permissão de escrita nos caminhos configurados
- A **Mapoteca** (biblioteca física de mapas) é configurada separadamente e não é necessária para o funcionamento básico do acervo
