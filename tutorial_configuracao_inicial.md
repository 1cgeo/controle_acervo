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

Com volumes configurados e a estrutura organizacional pronta, é hora de cadastrar os produtos geográficos.

### Opção A — Produto individual (com versão e arquivos)

1. Vá em **Funções de Administrador → Adicionar Produto**
2. Preencha os dados do produto:
   - **Nome**, **MI**, **INOM** (se aplicável)
   - **Tipo de produto** (ex: Carta Topográfica)
   - **Escala** (ex: 1:50.000)
   - **Geometria** — desenhe o polígono no mapa
3. Na aba de versão, informe:
   - **Número da versão** (formato: `1-DSGEO` ou equivalente)
   - **Subtipo do produto**
   - **Lote** (opcional)
   - **Órgão produtor**, **palavras-chave**, **metadados**
4. Selecione os **arquivos** a serem enviados (o plugin calcula checksums automaticamente)
5. Confirme para iniciar o envio dos arquivos ao volume

### Opção B — Produtos em lote

1. Vá em **Operações em Lote → Criar Produtos em Lote**
2. Carregue os produtos a partir de uma camada do QGIS ou CSV
3. Revise e confirme a criação

### Opção C — Produtos completos em lote (produto + versão + arquivos)

1. Vá em **Operações em Lote → Adicionar Produtos Completos em Lote**
2. Configure a origem dos dados e os arquivos correspondentes
3. Confirme para enviar tudo de uma vez

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
