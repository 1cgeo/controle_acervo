BEGIN;

-- ---------------------------------------------------------------------------
-- QGIS: a configuração que o cliente de produção baixa do banco
-- ---------------------------------------------------------------------------
--
-- VEIO DO `dgeo` DO SAP 2.3.5, e o motivo da mudança de schema é de uma palavra
-- só: aqui `dgeo` é GENTE. Ele guarda `usuario`, `usuario_perfil`, `login`,
-- `efetivo_periodo` e `impedimento`, e nada mais. No SAP o mesmo nome carregava
-- a pessoa E o catálogo de estilos, menus, temas, atalhos e modelos do QGIS, que
-- é configuração de FERRAMENTA e não tem relação nenhuma com quem opera.
--
-- SÃO 13 TABELAS, as mesmas do SAP e com os mesmos nomes: `plugin`,
-- `versao_qgis`, `qgis_shortcuts`, `gerenciador_fme`, `qgis_menus`,
-- `qgis_themes`, `layer_alias`, `group_styles`, `layer_styles`, `layer_rules`,
-- `qgis_models`, `workflow_dsgtools` e `plugin_path`.
--
-- `public.layer_styles` NÃO ESTÁ AQUI, e a ausência é a regra. Ela mora em
-- `er/versao.sql`, no schema `public`, porque quem a lê é o PRÓPRIO QGIS: o
-- gerenciador de estilos do QGIS abre uma conexão ao banco e procura
-- `public.layer_styles` por nome e por schema, sem passar pela API do SAP. Mudar
-- o nome dela ou o schema dela não quebra nada no servidor e quebra tudo no
-- cliente, em silêncio. `qgis.layer_styles` abaixo é OUTRA coisa: é o CATÁLOGO
-- do SAP, agrupado por `qgis.group_styles`, que o SAP Gerente publica e o SAP
-- distribui por subfase e por lote (`producao.perfil_estilo`).
--
-- `owner` E `update_time` FICAM COMO ESTAVAM, e não viram o par
-- `usuario_cadastramento_uuid`/`data_cadastramento` do resto do SCA. Não é
-- esquecimento: estas colunas são LIDAS PELO NOME pelo plugin do QGIS e pelo SAP
-- Gerente, que são clientes compilados fora deste repositório. Renomeá-las
-- obrigaria a soltar uma versão nova dos dois no mesmo dia da migração de banco,
-- para ganhar uma coluna de auditoria num catálogo que a auditoria do SCA
-- (`auditoria.evento`) já cobre pela rota. `owner` é o LOGIN de quem publicou,
-- texto e não chave estrangeira, pelo mesmo motivo.
--
-- CARREGA ANTES DE `er/producao.sql`: onze tabelas de perfil de lá apontam para
-- cá (`perfil_fme` para `gerenciador_fme`, `perfil_estilo` para `group_styles`,
-- `perfil_menu` para `qgis_menus`, e assim por diante).
-- ---------------------------------------------------------------------------

CREATE SCHEMA qgis;

COMMENT ON SCHEMA qgis IS
    'Configuração da ferramenta QGIS que o cliente de produção baixa do banco: estilos, menus, temas, atalhos, modelos e regras. Saiu de dgeo porque dgeo é gente.';

-- ---------------------------------------------------------------------------
-- O que o cliente precisa ter instalado
-- ---------------------------------------------------------------------------

-- A versão MÍNIMA do plugin do SAP. O cliente compara a sua com esta e se recusa
-- a trabalhar se estiver atrás: o plugin velho grava atividade com contrato
-- velho, e o estrago só aparece depois.
--
-- O CHECK do formato fica: 'versao_minima' é comparada por parte numérica no
-- cliente, e um '3.22-beta' escrito à mão faria a comparação decidir errado sem
-- erro nenhum.
CREATE TABLE qgis.plugin(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  versao_minima TEXT,
  CHECK (versao_minima ~ '^\d+(\.\d+){0,2}$')
);

COMMENT ON TABLE qgis.plugin IS
    'Versão mínima exigida de cada plugin do cliente de produção. O cliente atrás desta versão é recusado no login.';

-- A versão MÍNIMA do próprio QGIS. UMA linha, e a chave é `code` justamente para
-- não haver duas: a pergunta "qual o QGIS mínimo" tem uma resposta só.
CREATE TABLE qgis.versao_qgis(
  code SMALLINT NOT NULL PRIMARY KEY,
  versao_minima TEXT,
  CHECK (versao_minima ~ '^\d+(\.\d+){0,2}$')
);

INSERT INTO qgis.versao_qgis (code, versao_minima) VALUES
(1, '3.22.2');

COMMENT ON TABLE qgis.versao_qgis IS
    'Versão mínima do QGIS aceita pelo SAP. Uma linha só, e o code existe para garantir isso.';

-- Onde o cliente procura o plugin para se atualizar sozinho.
--
-- NASCE VAZIA (texto vazio, não nulo), e é deliberado: o valor é uma pasta de
-- rede DA INSTALAÇÃO, e este repositório é público. Quem instala preenche pelo
-- SAP Gerente. O CHECK `code = 1` é o que impede uma segunda linha.
CREATE TABLE qgis.plugin_path(
  code SMALLINT NOT NULL PRIMARY KEY,
  path TEXT,
  CHECK (code = 1)
);

INSERT INTO qgis.plugin_path (code, path) VALUES
(1, '');

COMMENT ON TABLE qgis.plugin_path IS
    'Caminho de onde o cliente baixa o plugin. Nasce vazia: o valor é da instalação e se preenche pelo SAP Gerente.';

-- ---------------------------------------------------------------------------
-- Os atalhos de teclado
-- ---------------------------------------------------------------------------
--
-- A FERRAMENTA É IDENTIFICADA PELO RÓTULO TRADUZIDO, e é por isso que `idioma`
-- existe e que a mesma tecla aparece duas vezes ('Mesclar feições selecionadas'
-- e 'Merge Selected Features' são a MESMA ação com a mesma tecla M). O QGIS não
-- expõe um identificador estável da ação para quem configura de fora: o que ele
-- expõe é o texto do menu, que muda com o idioma da instalação. Casar por texto
-- é frágil, e é o que existe.
--
-- SEMEADA COM O PADRÃO DA DIVISÃO, e as linhas abaixo são as do SAP 2.3.5, sem
-- corte. Elas não são exemplo: um operador que entra hoje espera o teclado que
-- ele já usa, e um banco novo sem elas obrigaria a redigitar 128 linhas.
CREATE TABLE qgis.qgis_shortcuts(
  id SERIAL NOT NULL PRIMARY KEY,
  ferramenta VARCHAR(255) NOT NULL,
  idioma VARCHAR(255) NOT NULL,
  atalho VARCHAR(255),
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE qgis.qgis_shortcuts IS
    'Atalho de teclado por ferramenta do QGIS. A ferramenta é identificada pelo RÓTULO TRADUZIDO, e por isso a mesma ação aparece uma vez por idioma.';

INSERT INTO qgis.qgis_shortcuts (ferramenta, idioma, atalho, owner) VALUES
('Sair do QGIS','português','', 'sap'),
('Exit QGIS','inglês','', 'sap'),
('Mesclar feições selecionadas','português','M', 'sap'),
('Merge Selected Features','inglês','M', 'sap'),
('Quebrar Feições','português','C', 'sap'),
('Split Features','inglês','C', 'sap'),
('Identificar feições','português','I', 'sap'),
('Identify Features','inglês','I', 'sap'),
('Adicionar Polígono','português','A', 'sap'),
('Add Polygon','inglês','A', 'sap'),
('Desfazer seleção de feições em todas as camadas','português','D', 'sap'),
('Deselect Features from All Layers','inglês','D', 'sap'),
('Ferramenta Vértice (Todas as Camadas)','português','N', 'sap'),
('Vertex Tool (All Layers)','inglês','N', 'sap'),
('Salvar para todas as camadas','português','Ctrl+S', 'sap'),
('Save for All Layers','inglês','Ctrl+S', 'sap'),
('Habilitar traçar','português','T', 'sap'),
('Enable Tracing','inglês','T', 'sap'),
('Remodelar feições','português','R', 'sap'),
('Reshape Features','inglês','R', 'sap'),
('Área','português','Z', 'sap'),
('Measure Area','inglês','Z', 'sap'),
('Linha','português','X', 'sap'),
('Measure Line','inglês','X', 'sap'),
('DSGTools: Seletor Genérico','português','S', 'sap'),
('DSGTools: Generic Selector','inglês','S', 'sap'),
('DSGTools: Ferramenta de aquisição com ângulos retos','português','E', 'sap'),
('DSGTools: Right Degree Angle Digitizing','inglês','E', 'sap'),
('Edição Topológica','português','H', 'sap'),
('Topological Editing','inglês','H', 'sap'),
('Salvar','português','', 'sap'),
('Save','inglês','', 'sap'),
('Select Feature(s)','inglês','V', 'sap'),
('Feição(s)','português','V', 'sap'),
('DSGTools: Inspecionar anterior','português','Q', 'sap'),
('DSGTools: Back Inspect','inglês','Q', 'sap'),
('DSGTools: Inspecionar próximo','português','W', 'sap'),
('DSGTools: Next Inspect','inglês','W', 'sap'),
('DSGTools: Desenhar Forma','português','G', 'sap'),
('DSGTools: Draw Shape','inglês','G', 'sap'),
('Desfazer','português','', 'sap'),
('Undo','inglês','', 'sap'),
('Mostrar camadas selecionadas','português','', 'sap'),
('Show Selected Layers','inglês','', 'sap'),
('Esconder camadas selecionadas','português','', 'sap'),
('Hide Selected Layers','inglês','', 'sap'),
('Alternar Aderência','português','', 'sap'),
('Toggle Snapping','inglês','', 'sap'),
('DSGTools: Alterna a visibilidade de todos os textos','português','L', 'sap'),
('DSGTools: Toggle all labels visibility','inglês','L', 'sap'),
('DSGTools: Ferramenta de Aquisição à Mão Livre','português','F', 'sap'),
('DSGTools: Free Hand Acquisition','inglês','F', 'sap'),
('DSGTools: Ferramenta de remodelagem à mão livre','português','Shift+R', 'sap'),
('DSGTools: Free Hand Reshape','inglês','Shift+R', 'sap'),
('Mostrar/Esconder marcadores para feições selecionadas','português','B', 'sap'),
('Mostrar/Esconder marcadores para feições selecionadas','inglês','B', 'sap'),
('DSGTools: Active Layer Visibility','português','Y', 'sap'),
('DSGTools: Active Layer Visibility','inglês','Y', 'sap'),
('Próximo estilo','português','Shift+W', 'sap'),
('Próximo estilo','inglês','Shift+W', 'sap'),
('Último estilo','português','Shift+Q', 'sap'),
('Último estilo','inglês','Shift+Q', 'sap'),
('DSGTools: Select Raster','português',E'\'', 'sap'),
('DSGTools: Select Raster','inglês',E'\'', 'sap'),
('Remover camada/grupo','português','Ctrl+D', 'sap'),
('Remove Layer/Group','inglês','Ctrl+D', 'sap'),
('Adicionar Linha','português','A', 'sap'),
('Add Line','inglês','A', 'sap'),
('Adicionar Ponto','português','A', 'sap'),
('Add Point','inglês','A', 'sap'),
('DSGTools: Go to next tile','inglês','Shift+S', 'sap'),
('DSGTools: Go to previous tile','inglês','Shift+A', 'sap'),
('DSGTools: Mark tile as done','inglês','Shift+D', 'sap'),
('DSGTools: Go to next tile','português','Shift+S', 'sap'),
('DSGTools: Go to previous tile','português','Shift+A', 'sap'),
('DSGTools: Mark tile as done','português','Shift+D', 'sap');

-- ---------------------------------------------------------------------------
-- As rotinas que rodam fora do QGIS
-- ---------------------------------------------------------------------------
--
-- O SERVIDOR FME de onde as rotinas de validação são chamadas.
--
-- `url` É COLUNA, E NASCE SEM LINHA NENHUMA. O endereço do servidor é da
-- instalação e este repositório é público: quem instala cadastra o dele pelo SAP
-- Gerente. O UNIQUE existe porque dois cadastros do mesmo servidor fariam a
-- mesma rotina aparecer duas vezes na lista da subfase.
CREATE TABLE qgis.gerenciador_fme(
  id SERIAL NOT NULL PRIMARY KEY,
  url VARCHAR(255) NOT NULL,
  UNIQUE(url)
);

COMMENT ON TABLE qgis.gerenciador_fme IS
    'Servidor FME de onde as rotinas de validação são chamadas. Nasce vazia: o endereço é da instalação.';

-- ---------------------------------------------------------------------------
-- O catálogo que o SAP Gerente publica
-- ---------------------------------------------------------------------------
--
-- AS SEIS TABELAS ABAIXO NASCEM VAZIAS, e nenhuma delas tem semente aqui. O
-- conteúdo é XML e JSON de dezenas de KB por linha (um QML de estilo tem
-- centenas de linhas), produzido dentro do QGIS e enviado pelo SAP Gerente. O
-- `er/` do SAP 2.3.5 trazia dois estilos de exemplo colados dentro de INSERTs,
-- o que fazia um arquivo de instalação de 1.380 linhas em que 1.350 eram
-- exemplo. Aqui não vêm: instalação nova é ESTRUTURA, e conteúdo se carrega.
--
-- `nome` É A CHAVE DE NEGÓCIO em todas elas, e por isso é UNIQUE: o cliente pede
-- o menu, o tema e o alias PELO NOME.

-- O menu customizado do QGIS (a definição inteira em texto).
CREATE TABLE qgis.qgis_menus(
  id SERIAL NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL,
  definicao_menu TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_menus UNIQUE (nome)
);

COMMENT ON TABLE qgis.qgis_menus IS
    'Menu customizado do QGIS. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O tema de camadas (quais camadas ficam visíveis em cada contexto).
CREATE TABLE qgis.qgis_themes(
  id SERIAL NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL,
  definicao_tema TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_themes UNIQUE (nome)
);

COMMENT ON TABLE qgis.qgis_themes IS
    'Tema de camadas do QGIS. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O apelido de cada campo de cada camada, para o formulário de aquisição não
-- mostrar o nome cru da coluna.
CREATE TABLE qgis.layer_alias(
  id SERIAL NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL,
  definicao_alias TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_alias UNIQUE (nome)
);

COMMENT ON TABLE qgis.layer_alias IS
    'Apelido dos campos das camadas de aquisição. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O GRUPO de estilos. É ele, e não o estilo, que a subfase escolhe: uma linha de
-- produção usa "o estilo de restituição", que são dezenas de QMLs, um por
-- camada.
CREATE TABLE qgis.group_styles(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  UNIQUE(nome)
);

COMMENT ON TABLE qgis.group_styles IS
    'Grupo de estilos. É o grupo, e não o estilo camada a camada, que producao.perfil_estilo aponta.';

-- O ESTILO DE UMA CAMADA DENTRO DE UM GRUPO.
--
-- NÃO CONFUNDIR COM `public.layer_styles`, que vive em `er/versao.sql`: aquela é
-- lida pelo GERENCIADOR DE ESTILOS DO PRÓPRIO QGIS, direto do banco, sem passar
-- pela API, e por isso não pode mudar de nome nem de schema. Esta aqui é o
-- catálogo do SAP, agrupado, versionado por `owner`/`update_time` e distribuído
-- por subfase e lote. As duas guardam QML e as duas existem de propósito.
--
-- A identidade é (schema, tabela, grupo), e NÃO inclui a coluna de geometria:
-- uma camada com duas geometrias teria dois estilos indistinguíveis pela chave,
-- e isso nunca aconteceu na produção da Divisão. É a chave do SAP 2.3.5, mantida
-- para o catálogo publicado de lá entrar aqui sem tradução.
CREATE TABLE qgis.layer_styles(
  id SERIAL NOT NULL PRIMARY KEY,
  f_table_schema VARCHAR(255) NOT NULL,
  f_table_name VARCHAR(255) NOT NULL,
  f_geometry_column VARCHAR(255) NOT NULL,
  grupo_estilo_id INTEGER NOT NULL REFERENCES qgis.group_styles (id),
  styleqml TEXT,
  stylesld TEXT,
  ui TEXT,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_styles UNIQUE (f_table_schema, f_table_name, grupo_estilo_id)
);

COMMENT ON TABLE qgis.layer_styles IS
    'Estilo de uma camada dentro de um grupo. É o CATÁLOGO do SAP, e não a public.layer_styles que o próprio QGIS lê.';

-- `grupo_estilo_id` é o terceiro campo do UNIQUE, então não tem índice próprio
-- por ele. Apagar um grupo varre a tabela inteira sem este índice.
CREATE INDEX idx_layer_styles_grupo ON qgis.layer_styles (grupo_estilo_id);

-- As regras de atributo que o DSGTools cobra durante a aquisição.
CREATE TABLE qgis.layer_rules(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  regra TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(nome)
);

COMMENT ON TABLE qgis.layer_rules IS
    'Regra de atributo cobrada durante a aquisição. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O modelo de processamento do QGIS (o .model3 exportado como XML).
CREATE TABLE qgis.qgis_models(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  model_xml TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE qgis.qgis_models IS
    'Modelo de processamento do QGIS. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O workflow do DSGTools (a sequência de modelos com os seus parâmetros).
CREATE TABLE qgis.workflow_dsgtools(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  workflow_json TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE qgis.workflow_dsgtools IS
    'Workflow do DSGTools. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

COMMIT;
