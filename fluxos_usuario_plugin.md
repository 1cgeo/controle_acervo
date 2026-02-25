# Fluxos de Uso do Plugin QGIS - Controle do Acervo

## Visao Geral

O plugin **Ferramentas de Controle do Acervo** permite que operadores e administradores do Servico Geografico do Exercito gerenciem o acervo cartografico (mapas, ortoimagens, MDE, etc.) diretamente do QGIS. Ele e a principal interface de trabalho para cadastro, consulta, download e manutencao dos produtos geograficos.

---

## 1. Acesso ao Sistema

### 1.1 Login

**Pre-condicoes:** Servidor do SCA e servidor de autenticacao externo devem estar acessiveis na rede.

**Passo a passo:**
1. Usuario clica no icone do plugin na barra de ferramentas do QGIS
2. Informa: URL do servidor, login e senha
3. Opcionalmente marca "Lembrar credenciais" para salvar localmente (via QSettings do SO)
4. Credenciais sao validadas contra o servidor de autenticacao externo
5. Token JWT (validade 1h) e armazenado em memoria
6. Painel lateral (dock) abre no lado direito do QGIS com o menu de operacoes

**Reautenticacao automatica:** Se o token expirar durante o uso, o plugin tenta relogar silenciosamente com as credenciais salvas. Se as credenciais salvas tambem falharem (senha alterada, usuario desativado, servidor inacessivel), o plugin exibe mensagem de erro e redireciona para a tela de login.

**Erros possiveis:**
- Servidor inacessivel: timeout de 30s, exibe mensagem de conexao recusada
- Credenciais invalidas: mensagem de login/senha incorretos
- Usuario desativado: mensagem informando que a conta esta inativa

### 1.2 Menu Principal (Painel Lateral)

O painel organiza as operacoes em categorias com campo de busca para filtrar itens:
- **Funcoes Gerais** -- disponivel para todos os usuarios
- **Funcoes de Administrador** -- apenas admin
- **Administracao Avancada** -- apenas admin
- **Diagnostico e Manutencao** -- apenas admin
- **Operacoes em Lote** -- apenas admin

Itens de admin ficam ocultos para usuarios comuns.

---

## 2. Fluxos do Usuario Comum

### 2.1 Carregar Camadas de Produtos no Mapa

**O que faz:** Carrega camadas vetoriais (poligonos) dos produtos do acervo diretamente no QGIS, organizadas por tipo e escala.

**Pre-condicoes:** Conexao com o banco PostgreSQL/PostGIS deve estar acessivel a partir da maquina do usuario.

**Passo a passo:**
1. Abre "Carregar Camadas de Produtos"
2. Ve grade de checkboxes de tipos de produto (ex: "Carta Topografica (342 produtos)")
3. Ve grade de checkboxes de escalas (ex: "1:50.000 (15 produtos)")
4. A lista de camadas disponíveis atualiza dinamicamente ao marcar/desmarcar tipos e escalas
5. Botoes rapidos: "Selecionar Todos os Produtos", "Selecionar Todas as Escalas", "Selecionar Todas as Camadas"
6. Clica em "Carregar"
7. Plugin conecta no PostgreSQL/PostGIS e carrega as views materializadas como camadas vetoriais

**Resultado:** Poligonos dos produtos aparecem no mapa do QGIS. Cada feicao representa um produto geografico com seus atributos (nome, MI, INOM, escala, datas, etc.).

**Erros possiveis:**
- Sem camadas disponiveis: aviso indicando que nao ha views materializadas (admin precisa cria-las)
- Falha de conexao com o banco: aviso de conexao recusada ao PostgreSQL

---

### 2.2 Consultar Informacoes de um Produto

**O que faz:** Exibe todas as informacoes de um produto: metadados, versoes, arquivos e relacionamentos.

**Passo a passo:**
1. Seleciona um produto no mapa (feicao da camada carregada) ou busca por ID
2. Abre "Informacoes do Produto"
3. Visualiza em 3 abas:
   - **Visao Geral:** Nome, MI, INOM, escala, tipo de produto, descricao, datas
   - **Versoes:** Lista de versoes (ex: v1.0, v2.0) com data de criacao, tipo, status, lote, orgao produtor; cada versao lista seus arquivos (nome, tipo, extensao, tamanho, checksum)
   - **Relacionamentos:** Vinculos entre versoes (predecessora, sucessora, alternativa)

**Acoes de admin (visiveis apenas para administradores):**
- Editar metadados do produto (nome, descricao, escala, tipo)
- Adicionar nova versao ou versao historica a um produto existente
- Editar versao (metadados, descricao, palavras-chave, lote)
- Adicionar/editar/excluir arquivos individuais de uma versao
- Excluir produto ou versao (com motivo de exclusao obrigatorio)
- Gerenciar relacionamentos entre versoes

**Resultado:** Visao completa do historico e estado atual de qualquer produto do acervo.

---

### 2.3 Buscar Produtos

**O que faz:** Pesquisa textual e filtrada no catalogo de produtos.

**Passo a passo:**
1. Abre "Buscar Produtos"
2. Define criterios:
   - Termo de busca (nome, descricao)
   - Filtro por tipo de produto (Carta Topografica, Ortoimagem, MDE, etc.)
   - Filtro por escala (1:25k, 1:50k, 1:100k, 1:250k)
   - Filtro por projeto
   - Filtro por lote
3. Clica "Buscar"
4. Tabela de resultados mostra: ID, Nome, MI, INOM, Escala, Tipo, Descricao, Datas, No de Versoes
5. Navega entre paginas (20 itens por pagina)
6. Clica em "Detalhes" para abrir informacoes completas de um produto
7. Pode exportar resultados como CSV

**Resultado:** Localiza rapidamente qualquer produto do acervo por diferentes criterios textuais.

---

### 2.4 Buscar Produtos por Area Geografica

**O que faz:** Seleciona produtos que intersectam uma area de interesse desenhada no mapa.

**Passo a passo:**
1. Carrega as camadas de produtos no mapa (fluxo 2.1)
2. Usa a ferramenta de selecao por area do QGIS (selecao por retangulo, poligono ou mao livre)
3. Seleciona as feicoes desejadas diretamente no mapa
4. Com as feicoes selecionadas, pode:
   - Abrir "Informacoes do Produto" para consultar detalhes (fluxo 2.2)
   - Abrir "Download de Produtos" para baixar os arquivos (fluxo 2.5)

**Resultado:** Localiza produtos por localizacao geografica usando as ferramentas nativas do QGIS combinadas com as camadas carregadas pelo plugin.

**Nota:** A busca espacial depende das camadas estarem carregadas no mapa. Para buscas textuais, usar o fluxo 2.3.

---

### 2.5 Download de Produtos

**O que faz:** Baixa os arquivos dos produtos selecionados para o computador local, com verificacao de integridade.

**Pre-condicoes:** Produtos devem estar selecionados no mapa (feicoes da camada carregada) ou via busca.

**Passo a passo:**
1. Seleciona feicoes (produtos) na camada carregada no QGIS
2. Abre "Download de Produtos"
3. Ve a lista de produtos selecionados
4. Escolhe tipos de arquivo para baixar (checkboxes):
   - Arquivo principal
   - Formato alternativo
   - Metadados
   - Outros tipos disponiveis
5. Seleciona pasta de destino
6. Clica "Download"
7. Para cada arquivo:
   - Servidor gera token de download (validade 24h)
   - Arquivo e transferido (copia Windows ou SMB)
   - Checksum SHA-256 e verificado localmente
   - Confirmacao enviada ao servidor
8. Barra de progresso mostra andamento
9. Resumo final: sucessos e falhas

**Retentativas:** Em caso de falha na transferencia, o sistema tenta novamente 3 vezes com backoff exponencial (2s, 4s, 8s).

**Erros possiveis:**
- Arquivo nao encontrado no volume: erro indicando caminho inexistente
- Checksum nao confere: arquivo descartado e retentativa iniciada
- Apos 3 falhas: arquivo marcado como falha no resumo final

**Resultado:** Arquivos dos produtos copiados para pasta local com integridade garantida.

---

### 2.6 Download da Situacao Geral

**O que faz:** Baixa um pacote com a situacao geral do acervo por escala.

**Passo a passo:**
1. Abre "Download da Situacao Geral"
2. Seleciona escalas desejadas (1:25k, 1:50k, 1:100k, 1:250k)
3. Seleciona pasta de destino
4. Clica "Download"
5. Servidor gera ZIP com GeoJSONs
6. Plugin extrai os arquivos localmente

**Resultado:** GeoJSONs com a cobertura geografica de todo o acervo, util para planejamento e analise de lacunas.

---

### 2.7 Visualizar Relacionamentos entre Versoes

**O que faz:** Mostra todas as relacoes registradas entre versoes de produtos em formato tabular.

**Passo a passo:**
1. Abre "Visualizar Relacionamentos entre Versoes"
2. Ve tabela com 11 colunas:
   - ID, Tipo de Relacionamento
   - Produto 1: nome, MI, INOM, nome da versao
   - Produto 2: nome, MI, INOM, nome da versao
   - Data do relacionamento
3. Pode atualizar a tabela com o botao "Atualizar"
4. Pode exportar todos os dados como CSV

**Resultado:** Visao geral de todas as dependencias e linhagens entre versoes de produtos (predecessora, sucessora, alternativa, derivada, etc.).

---

### 2.8 Configuracoes

**O que faz:** Ajusta parametros locais do plugin.

**Opcoes disponiveis:**
- **Dominio SMB padrao:** Define o dominio de rede Windows para transferencia de arquivos via SMB (padrao: "1CGEO"). Usado nas operacoes de download e upload que acessam compartilhamentos de rede.

**Nota:** URL do servidor e credenciais sao configuradas na tela de login (fluxo 1.1), nao aqui.

---

## 3. Fluxos do Administrador

### 3.1 Cadastro de Produto Individual

**O que faz:** Registra um novo produto no acervo com suas versoes e arquivos.

**Pre-condicoes:**
- Projeto e lote devem existir (fluxos 3.5 e 3.6) se for atribuir a versao a um lote
- Volume de armazenamento deve estar configurado para o tipo de produto (fluxos 3.7 e 3.8)

**Passo a passo:**
1. Abre "Adicionar Produto"
2. **Aba Produto:**
   - Preenche: nome (obrigatorio), MI, INOM, descricao
   - Seleciona: tipo de produto, tipo de escala
   - Para escala especial (tipo 5): informa denominador customizado
   - Desenha a geometria (poligono) no mapa -- clique esquerdo adiciona vertices, clique direito finaliza. EPSG:4674 (SIRGAS 2000)
3. **Aba Versoes** (pode adicionar multiplas em abas dinamicas):
   - Para cada versao: nome, numero da versao, tipo de versao, subtipo de produto
   - Atribui a um lote (opcional)
   - Preenche: descricao, orgao produtor (padrao: "DSG"), palavras-chave
   - Define: datas de criacao e modificacao
   - Metadados em JSON (campo valida em tempo real, fundo vermelho se JSON invalido)
   - Botao "Remover Versao" (desabilitado se so houver uma)
4. **Aba Arquivos** (por versao):
   - Navega e seleciona arquivos do sistema de arquivos ou compartilhamento SMB
   - Define: nome, tipo de arquivo (principal, alternativo, metadados, etc.), extensao
5. Clica "Salvar"
6. Fluxo de upload:
   - Produto criado no banco -> Versoes criadas -> Sessao de upload preparada
   - Cada arquivo e transferido com barra de progresso
   - Checksums SHA-256 validados -> Upload confirmado

**Resultado:** Produto completo cadastrado com metadados, geometria, versoes e arquivos.

---

### 3.2 Cadastro de Produto com Versao Historica

**O que faz:** Registra um produto cujas versoes sao historicas -- ou seja, referem-se a producoes passadas para as quais nao ha arquivos digitais disponiveis para upload. A diferenca em relacao ao cadastro normal (3.1) e que nao ha aba de arquivos e as datas de criacao/edicao tipicamente sao no passado.

**Passo a passo:**
1. Abre "Adicionar Produto com Versao Historica"
2. **Dados do Produto:**
   - Preenche: nome (obrigatorio), MI, INOM, descricao
   - Seleciona: tipo de produto, tipo de escala (com denominador customizado para escala especial)
   - Desenha a geometria (poligono) no mapa
3. **Versoes** (multiplas em abas dinamicas):
   - Numero da versao (obrigatorio, ex: "1-DSGEO", "2a Edicao")
   - Nome da versao
   - Subtipo de produto (filtrado pelo tipo de produto selecionado)
   - Lote (opcional)
   - Orgao produtor (padrao: "DSG")
   - Palavras-chave (separadas por virgula)
   - Data de criacao e data de edicao (tipicamente datas no passado)
   - Descricao
   - Metadados em JSON (validacao em tempo real)
4. Clica "Salvar"
5. Produto e versoes sao criados no banco sem sessao de upload

**Resultado:** Produtos historicos catalogados preservando as datas originais de producao, sem necessidade de arquivos fisicos.

---

### 3.3 Carregar Produtos (Camadas de Administracao)

**O que faz:** Carrega camadas de produtos do acervo no QGIS com filtros por tipo de produto e escala. Funcionalidade identica ao fluxo 2.1 (Carregar Camadas de Produtos), mas posicionada no menu de administrador para facilitar o acesso durante tarefas administrativas.

**Passo a passo:** Identico ao fluxo 2.1.

---

### 3.4 Carregar Arquivos Sistematicos

**O que faz:** Faz upload em lote de arquivos para versoes ja existentes a partir de uma camada QGIS com os mapeamentos de arquivo.

**Pre-condicoes:**
- Versoes de destino devem existir no banco
- Camada (sem geometria) deve conter os campos obrigatorios

**Passo a passo:**
1. Abre "Carregar Arquivos Sistematicos"
2. Seleciona uma camada nao-espacial no QGIS (ou cria uma camada modelo com o botao "Criar Camada Modelo")
3. Campos obrigatorios na camada:
   - `versao_id` -- ID da versao de destino
   - `nome` -- nome de exibicao do arquivo
   - `nome_arquivo` -- nome fisico do arquivo
   - `tipo_arquivo_id` -- tipo (principal, alternativo, metadados, etc.)
   - `extensao` -- extensao do arquivo
   - `path` -- caminho completo do arquivo no disco/rede
   - `situacao_carregamento_id` -- situacao de carregamento
4. Campos opcionais: `descricao`, `crs_original`, `metadado` (JSON)
5. Clica "Carregar"
6. Plugin valida estrutura da camada e existencia dos arquivos
7. Calcula checksums SHA-256 e tamanhos
8. Prepara sessao de upload no servidor
9. Transfere cada arquivo com barra de progresso
10. Confirma upload no servidor

**Retentativas:** Em caso de falha, oferece opcao de retentar apenas os arquivos que falharam.

**Resultado:** Arquivos vinculados as versoes existentes com integridade verificada.

---

### 3.5 Gerenciar Projetos

**O que faz:** Administra a estrutura organizacional de projetos.

**Passo a passo:**
1. Abre "Gerenciar Projetos"
2. Tabela com: ID, Nome, Descricao, Data Inicio/Fim, Status
3. Busca por nome/descricao
4. Acoes: Adicionar, Editar, Excluir

**Campos do Projeto:**
- Nome, Descricao
- Data de inicio e fim
- Status de execucao (planejamento, execucao, concluido, etc.)

**Regra:** Nao e possivel excluir projetos que possuam lotes associados.

---

### 3.6 Gerenciar Lotes

**O que faz:** Administra lotes dentro dos projetos. Lotes agrupam versoes de produtos.

**Passo a passo:**
1. Abre "Gerenciar Lotes"
2. Tabela com: ID, Nome, PIT, Projeto, Descricao, Datas, Status
3. Busca por nome/PIT/descricao
4. Acoes: Adicionar, Editar, Excluir

**Campos do Lote:**
- Nome, PIT (codigo de identificacao)
- Projeto associado
- Descricao, Datas, Status

**Regra:** Nao e possivel excluir lotes que possuam versoes associadas.

---

### 3.7 Gerenciar Volumes de Armazenamento

**O que faz:** Configura os volumes (discos/compartilhamentos) onde os arquivos sao armazenados fisicamente.

**Passo a passo:**
1. Abre "Gerenciar Volumes"
2. Tabela com: ID, Nome, Caminho do Volume, Capacidade (GB)
3. Acoes: Adicionar, Editar, Excluir

**Regra:** Nao e possivel excluir volumes que contenham arquivos.

---

### 3.8 Gerenciar Associacao Volume x Tipo de Produto

**O que faz:** Define em qual volume cada tipo de produto deve ser armazenado.

**Pre-condicoes:** Volumes devem estar cadastrados (fluxo 3.7).

**Passo a passo:**
1. Abre "Gerenciar Relacionamento Volume e Tipo de Produto"
2. Define mapeamento: Tipo de Produto -> Volume de Armazenamento (primario/secundario)
3. Acoes: Adicionar, Editar, Excluir

**Resultado:** Distribuicao organizada de arquivos por volume conforme o tipo de produto.

---

### 3.9 Gerenciar Usuarios

**O que faz:** Controla quem pode acessar o sistema e com quais permissoes.

**Passo a passo:**
1. Abre "Gerenciar Usuarios"
2. Tabela com: Posto/Graduacao, Nome, Login, Administrador (checkbox), Ativo (checkbox)
3. Busca por nome
4. Acoes:
   - **Alterar:** Liga/desliga status de administrador e ativo
   - **Importar:** Busca novos usuarios do servidor de autenticacao externo
   - **Sincronizar:** Atualiza lista completa do servidor de autenticacao

**Resultado:** Controle de acesso ao sistema com dois niveis (usuario comum e administrador).

---

## 4. Fluxos de Diagnostico e Manutencao

### 4.1 Verificar Inconsistencias

**O que faz:** Executa verificacao de integridade do acervo.

**Passo a passo:**
1. Abre "Verificar Inconsistencias"
2. Clica "Executar Verificacao"
3. Servidor verifica: arquivos faltando, checksums incorretos, metadados orfaos, inconsistencias de versoes
4. Tabela de resultados: ID, Nome, Tipo, Caminho, Descricao do Problema
5. Exporta como CSV

**Resultado:** Lista de problemas encontrados no acervo para correcao manual.

---

### 4.2 Gerenciar Arquivos com Problemas

**O que faz:** Lista arquivos que apresentam erros (checksum invalido, arquivo ausente, formato incorreto, etc.).

**Passo a passo:**
1. Abre "Gerenciar Arquivos com Problemas"
2. Tabela paginada: ID, Nome, Nome do Arquivo, Extensao, Volume, Tipo do Problema, Data, Tipo
3. Paginacao configuravel (10, 20, 50, 100 por pagina)
4. Navegacao: Primeira, Anterior, Proxima, Ultima pagina
5. Exporta como CSV

**Resultado:** Visao de todos os arquivos com status problematico para acao corretiva.

---

### 4.3 Gerenciar Arquivos Excluidos (Auditoria)

**O que faz:** Trilha de auditoria de todos os arquivos excluidos.

**Campos exibidos:** ID, Nome, Nome do Arquivo, Extensao, Produto, MI, INOM, Lote, PIT, Versao, Volume, Tamanho (MB), Data de Exclusao, Motivo da Exclusao

**Paginacao:** Configuravel (10, 20, 50, 100 por pagina) com navegacao e exportacao CSV.

---

### 4.4 Gerenciar Sessoes de Upload

**O que faz:** Monitora e gerencia operacoes de upload em andamento ou concluidas.

**Passo a passo:**
1. Abre "Gerenciar Sessoes de Upload"
2. Tabela: UUID, Tipo de Operacao, Status (pendente/concluido/falhou/cancelado), Mensagem de Erro, Datas, Nome do Usuario
3. Acao: Cancelar sessoes pendentes

**Ciclo de vida:** Sessoes expiram automaticamente apos 24 horas; limpeza horaria via cron no servidor.

---

### 4.5 Visualizar Uploads com Problemas

**O que faz:** Exibe sessoes de upload que falharam, com detalhamento hierarquico dos erros por arquivo.

**Passo a passo:**
1. Abre "Visualizar Uploads com Problemas"
2. Tabela de sessoes com problemas: UUID, Tipo de Operacao, Mensagem de Erro, Data de Criacao, Usuario
3. Ao selecionar uma sessao, exibe:
   - **Painel de informacoes:** UUID, tipo de operacao, status, erro, datas, usuario
   - **Arvore de arquivos com problemas:** estrutura hierarquica que varia conforme o tipo de operacao:
     - "Adicionar Arquivos": Versao ID -> Arquivos com erro
     - "Adicionar Versao": Produto -> Versao -> Arquivos com erro
     - "Adicionar Produto": Produto -> Versao -> Arquivos com erro
4. Cada no da arvore mostra nome do arquivo e mensagem de erro detalhada
5. Botao "Atualizar" para recarregar dados

**Resultado:** Diagnostico detalhado de falhas de upload para correcao e reenvio.

---

### 4.6 Limpar Downloads Expirados

**O que faz:** Remove tokens e registros de downloads expirados (>24h) do banco de dados.

**Passo a passo:**
1. Abre "Limpar Downloads Expirados"
2. Clica "Limpar"
3. Dialogo de confirmacao: "Tem certeza que deseja limpar todos os downloads expirados?"
4. Servidor remove tokens e registros expirados
5. Mensagem de sucesso ou erro

**Nota:** O cron do servidor ja executa essa limpeza a cada hora automaticamente. Este fluxo e para limpeza manual sob demanda.

**Resultado:** Tokens de download expirados removidos, liberando recursos no banco.

---

### 4.7 Atualizar Views Materializadas

**O que faz:** Reconstroi os indices espaciais (views materializadas) que alimentam as camadas do QGIS.

**Quando usar:** Apos grandes alteracoes no acervo, ou quando as camadas no QGIS parecem desatualizadas.

---

### 4.8 Criar View Materializada

**O que faz:** Cria uma nova view materializada para uma combinacao tipo de produto + escala.

**Quando usar:** Quando um novo tipo de produto/escala e adicionado ao sistema e precisa ser visivel como camada no QGIS.

---

### 4.9 Gerenciar Downloads Excluidos

**O que faz:** Trilha de auditoria de downloads de arquivos que foram posteriormente excluidos do acervo.

**Passo a passo:**
1. Abre "Gerenciar Downloads Excluidos"
2. Tabela paginada com 7 colunas: ID, Arquivo, Nome do Arquivo, Usuario, Data do Download, Motivo da Exclusao, Data da Exclusao
3. Paginacao configuravel (10, 20, 50, 100 por pagina)
4. Navegacao: Primeira, Anterior, Proxima, Ultima pagina
5. Informacao de pagina: "Pagina X de Y (Total: Z itens)"
6. Exporta como CSV

**Resultado:** Rastreabilidade de quais usuarios baixaram arquivos que depois foram removidos do acervo.

---

## 5. Fluxos de Operacoes em Lote

### 5.1 Criar Produtos em Lote

**O que faz:** Cadastra multiplos produtos (sem versoes/arquivos) a partir de uma camada QGIS.

**Passo a passo:**
1. Prepara camada nao-espacial com colunas: `nome`, `mi`, `inom`, `escala_denominador`, `tipo_produto_id`, `tipo_escala_id`, `descricao`, `geom_wkt`
2. Carrega a camada no QGIS (ou usa "Criar Camada Modelo" para gerar template)
3. Abre "Criar Produtos em Lote"
4. Seleciona a camada
5. Plugin valida a estrutura e dados
6. Envia os dados ao servidor

**Resultado:** Produtos "vazios" criados em massa, prontos para receber versoes e arquivos.

---

### 5.2 Adicionar Produtos Completos em Lote

**O que faz:** Cadastra produtos + versoes + arquivos de uma so vez a partir de uma camada.

**Campos esperados na camada:**
- Produto: `produto_nome`, `produto_mi`, `produto_inom`, `escala_denominador`, `tipo_produto_id`, `tipo_escala_id`
- Versao: `versao_nome`, `versao_numero`, `tipo_versao_id`, `subtipo_produto_id`, `lote_id`
- Arquivo: `arquivo_nome`, `arquivo_nome_arquivo`, `tipo_arquivo_id`, `arquivo_path`

**Resultado:** Cadastro completo em massa com transferencia de todos os arquivos.

---

### 5.3 Adicionar Versoes a Produtos em Lote

**O que faz:** Adiciona novas versoes (com arquivos) a produtos ja existentes.

**Campos esperados:** `produto_id`, `versao_nome`, `versao_numero`, `arquivo_path`, etc.

---

### 5.4 Adicionar Arquivos em Lote

**O que faz:** Adiciona arquivos a versoes ja existentes a partir de uma camada/planilha.

**Campos esperados:** `versao_id`, `nome`, `nome_arquivo`, `tipo_arquivo_id`, `extensao`, `path`, `situacao_carregamento_id`

**Campos opcionais:** `descricao`, `crs_original`, `metadado` (JSON)

**Fluxo:**
1. Prepara camada com os dados (ou usa "Criar Camada Modelo")
2. Plugin valida estrutura, existencia dos arquivos e formato dos metadados
3. Calcula checksums SHA-256 e tamanhos
4. Prepara sessao de upload no servidor
5. Cada arquivo e transferido com progresso
6. Checksums validados e upload confirmado
7. Em caso de falhas, oferece opcao de retentar apenas os arquivos que falharam

---

### 5.5 Adicionar Produtos com Versoes Historicas em Lote

**O que faz:** Cadastro em massa de produtos com versoes historicas (sem arquivos, datas no passado).

**Campos obrigatorios na camada:**
- Produto: `produto_grupo_id` (agrupa registros do mesmo produto), `produto_nome`, `tipo_escala_id`, `tipo_produto_id`, `geom` (WKT)
- Versao: `versao_grupo_id` (agrupa registros da mesma versao), `versao` (numero), `nome_versao`, `subtipo_produto_id`, `orgao_produtor`, `data_criacao`, `data_edicao`

**Campos opcionais:**
- Produto: `mi`, `inom`, `denominador_escala_especial`, `descricao_produto`
- Versao: `lote_id`, `descricao_versao`, `palavras_chave` (separadas por virgula), `metadado_versao` (JSON), `uuid_versao`

**Comportamento:**
- Registros sao agrupados por `produto_grupo_id` para formar produtos
- Dentro de cada produto, versoes sao agrupadas por `versao_grupo_id`
- Datas aceitas nos formatos: ISO 8601, DD/MM/AAAA, ou QDate
- Registros invalidos sao ignorados e os validos prosseguem

**Resultado:** Produtos historicos catalogados em massa com suas versoes, sem necessidade de arquivos.

---

### 5.6 Adicionar Versoes Historicas em Lote

**O que faz:** Adiciona versoes historicas a produtos ja existentes em massa (sem arquivos).

**Campos obrigatorios na camada:**
- `produto_id` (produto existente), `versao` (numero), `nome`, `subtipo_produto_id`
- `orgao_produtor`, `data_criacao`, `data_edicao`

**Campos opcionais:**
- `lote_id`, `descricao`, `palavras_chave` (separadas por virgula), `metadado` (JSON), `uuid_versao`

**Comportamento:**
- Datas aceitas nos formatos: ISO 8601, DD/MM/AAAA, ou QDate
- Registros invalidos sao ignorados e os validos prosseguem

**Resultado:** Versoes historicas vinculadas a produtos existentes em massa.

---

### 5.7 Criar Relacionamentos entre Versoes em Lote

**O que faz:** Define relacionamentos (predecessora, sucessora, alternativa) entre versoes em massa.

**Campos esperados:** `versao_origem_id`, `versao_destino_id`, `tipo_relacionamento_id`

**Validacoes:** Sem ciclos, sem duplicatas, sem auto-relacionamento.

---

## 6. Resumo: Perfis de Uso

| Perfil | Operacoes Principais | Frequencia Tipica |
|--------|---------------------|-------------------|
| **Operador de campo** | Carregar camadas, buscar produtos (textual e espacial), download de arquivos | Diario |
| **Cartografo** | Consultar versoes, download de produtos, visualizar relacionamentos | Diario |
| **Administrador de acervo** | Cadastrar produtos, gerenciar versoes/arquivos, operacoes em lote | Diario |
| **Gestor de projeto** | Gerenciar projetos/lotes, consultar situacao geral | Semanal |
| **Administrador de TI** | Gerenciar volumes, usuarios, diagnosticar inconsistencias, manutencao de views | Sob demanda |

---

## 7. Fluxo Completo Tipico: Do Cadastro ao Download

```
1. Admin configura Volumes de armazenamento (3.7)
   e associa Tipo de Produto -> Volume (3.8)
                                    |
2. Admin cria Projeto (3.5) -> Admin cria Lotes (3.6)
                                    |
3. Admin cadastra Produtos (3.1 individual ou 5.1/5.2 em lote)
   -> Define geometria, tipo, escala, metadados
                                    |
4. Admin adiciona Versoes aos Produtos
   -> Atribui ao Lote, define metadados da versao
                                    |
5. Admin faz Upload dos Arquivos das Versoes
   -> Transferencia com verificacao de checksum
                                    |
6. Admin atualiza Views Materializadas (4.7)
                                    |
7. Usuario carrega camadas no QGIS (2.1)
   -> Ve poligonos dos produtos no mapa
                                    |
8. Usuario localiza produtos de interesse
   -> Por busca textual (2.3) ou selecao espacial no mapa (2.4)
   -> Consulta informacoes detalhadas (2.2)
                                    |
9. Usuario faz Download dos arquivos (2.5)
   -> Escolhe tipos de arquivo, pasta destino
   -> Transferencia com verificacao de integridade
```
