BEGIN;

CREATE SCHEMA dominio;

CREATE TABLE dominio.tipo_posto_grad(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	nome_abrev VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_posto_grad (code, nome, nome_abrev) VALUES
(1, 'Civil', 'Civ'),
(2, 'Mão de Obra Temporária', 'MOT'),
(3, 'Soldado EV', 'Sd EV'),
(4, 'Soldado EP', 'Sd EP'),
(5, 'Cabo', 'Cb'),
(6, 'Terceiro Sargento', '3º Sgt'),
(7, 'Segundo Sargento', '2º Sgt'),
(8, 'Primeiro Sargento', '1º Sgt'),
(9, 'Subtenente', 'ST'),
(10, 'Aspirante', 'Asp'),
(11, 'Segundo Tenente', '2º Ten'),
(12, 'Primeiro Tenente', '1º Ten'),
(13, 'Capitão', 'Cap'),
(14, 'Major', 'Maj'),
(15, 'Tenente Coronel', 'TC'),
(16, 'Coronel', 'Cel'),
(17, 'General de Brigada', 'Gen Bda'),
(18, 'General de Divisão', 'Gen Div'),
(19, 'General de Exército', 'Gen Ex');

CREATE TABLE dominio.tipo_escala (
	code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO dominio.tipo_escala (code, nome) VALUES
(1, '1:25.000'),
(2, '1:50.000'),
(3, '1:100.000'),
(4, '1:250.000'),
(5, 'Escala personalizada');

CREATE TABLE dominio.situacao_carregamento(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.situacao_carregamento (code, nome) VALUES
(1, 'Não carregado'),
(2, 'Carregado BDGEx Ostensivo'),
(3, 'Carregado BDGEx Operações'),
(4, 'Carregado IGW'),
(5, 'Carregado GEDW');

CREATE TABLE dominio.tipo_arquivo(
	code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO dominio.tipo_arquivo (code, nome) VALUES
(1, 'Arquivo principal'),
(2, 'Formato alternativo'),
(3, 'Insumo'),
(4, 'Metadados'),
(5, 'JSON Edição'),
(6, 'Documentos'),
(7, 'Projeto QGIS'),
(8, 'Arquivos complementares'),
(9, 'Tileserver');

CREATE TABLE dominio.tipo_relacionamento(
	code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO dominio.tipo_relacionamento (code, nome) VALUES
(1, 'Insumo'),
(2, 'Complementar'),
(3, 'Conjunto');

CREATE TABLE dominio.tipo_status_arquivo (
	code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO dominio.tipo_status_arquivo (code, nome) VALUES
(1, 'Carregado'),
(2, 'Erro no carregamento'),
(3, 'Excluído'),
(4, 'Erro na exclusão');

CREATE TABLE dominio.tipo_versao (
	code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO dominio.tipo_versao (code, nome) VALUES
(1, 'Regular'),
(2, 'Registro Histórico'),
-- Folha que o acervo ainda VAI produzir, cadastrada para o item do pedido poder
-- apontar para ela. Nasce sem arquivo; o arquivo entra na MESMA versão quando a
-- produção terminar. Ver migrations/2026-07-30_tipo_versao_planejada.sql.
(3, 'Planejada');

CREATE TABLE dominio.tipo_status_execucao (
	code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO dominio.tipo_status_execucao (code, nome) VALUES
(1, 'Não iniciado'),
(2, 'Em execução'),
(3, 'Concluído'),
(4, 'Concluído parcialmente'),
(5, 'Pausado');

CREATE TABLE dominio.tipo_produto (
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.tipo_produto (code, nome) VALUES
(1, 'CDGV'),
(2, 'Carta Topográfica'),
(3, 'Carta Ortoimagem'),
(4, 'Ortoimagem'),
(5, 'Modelo Digital de Superfície'),
(6, 'Modelo Digital de Terreno'),
(7, 'Carta temática'),
(8, 'CDGV temático'),
(9, 'Modelo 3D'),
(10, 'Ponto de controle'),
(11, 'CDGV Carta Ortoimagem'),
(12, 'Insumos fotogramétricos'),
(13, 'Levantamento topográfico');

CREATE TABLE dominio.subtipo_produto (
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL UNIQUE,
	tipo_id SMALLINT NOT NULL REFERENCES dominio.tipo_produto(code),
	-- Marca os subtipos que DEFINEM a identidade de um produto proprio (ex.: Carta
	-- Topografica Militar). Um subtipo assim so pode existir como produto proprio
	-- (acervo.produto.subtipo_produto_id), nunca como versao de um produto de outro
	-- subtipo. Ver acervo.validate_version e DECISIONS 2026-07-06.
	define_produto BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO dominio.subtipo_produto (code, nome, tipo_id) VALUES
(1, 'Conjunto de dados geoespaciais vetoriais - ET-EDGV 2.1.3', 1),
(2, 'Carta Topográfica - T34-700', 2),
(3, 'Carta Ortoimagem', 3),
(4, 'Ortoimagem', 4),
(5, 'Modelo Digital de Superfície', 5),
(6, 'Modelo Digital de Terreno', 6),
(7, 'Conjunto de dados geoespaciais vetoriais - ET-EDGV 3.0', 1),
(8, 'Conjunto de dados geoespaciais vetoriais - MGCP', 1),
(9, 'Fototriangulação', 12),
(10, 'Imagem aérea/satélite', 12),
(11, 'Ponto de controle', 10),
(12, 'Carta Topográfica - ET-RDG', 2),
(13, 'Carta Temática', 7),
(14, 'Mapa de unidades', 7),
(15, 'Carta de trafegabilidade', 7),
(16, 'Rede de transporte', 8),
(17, 'Mapa de geografia humana', 7),
(18, 'Levantamento topográfico', 13),
(19, 'Carta Ortoimagem de SARP', 7),
(20, 'Conjunto de dados geoespaciais vetoriais - MUVD', 1),
(21, 'Modelo Digital de Superfície - TREx', 5),
(22, 'Conjunto de dados geoespaciais vetoriais para Ortoimagem - ET-EDGV 3.0', 11),
(23, 'Conjunto de dados geoespaciais vetoriais para Trafegabilidade', 8),
(24, 'Carta Topográfica Militar', 2),
(25, 'Modelo 3D Tiles', 9),
(26, 'Modelo 3D', 9),
(27, 'Carta Ortoimagem Especial', 7),
(28, 'Carta Topográfica Não-SCN', 2),
(29, 'Carta Aeronáutica', 7),
(30, 'CDGV Especial', 8);

-- Carta Topografica Militar define seu proprio produto (distinta da carta civil no
-- mesmo MI): a chave de identidade do produto e o subtipo, nao o tipo (chefe 2026-07-06).
UPDATE dominio.subtipo_produto SET define_produto = true WHERE code = 24;

-- ---------------------------------------------------------------------------
-- Dominios do modulo orcamento (absorvidos do SCO em 2026-07-27). Ficam aqui,
-- e nao em orcamento.sql, porque o schema dominio e unico na plataforma.
-- tipo_posto_grad, tipo_perfil e modulo NAO foram duplicados: ja existiam aqui,
-- identicos.
-- ---------------------------------------------------------------------------

-- Natureza de Despesa (ND). code = ND sem pontos (ex.: 339015). gnd: 3 custeio, 4 capital.
CREATE TABLE dominio.natureza_despesa(
  code VARCHAR(6) NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  gnd SMALLINT NOT NULL,
  grupo VARCHAR(20) NOT NULL
);

INSERT INTO dominio.natureza_despesa (code, nome, gnd, grupo) VALUES
('339014', 'Diárias - pessoal civil', 3, 'custeio'),
('339015', 'Diárias - pessoal militar', 3, 'custeio'),
('339030', 'Material de consumo', 3, 'custeio'),
('339033', 'Passagens e despesas com locomoção', 3, 'custeio'),
('339039', 'Serviços de terceiros - pessoa jurídica', 3, 'custeio'),
('339040', 'Serviços de TIC - pessoa jurídica', 3, 'custeio'),
('339047', 'Obrigações tributárias e contributivas', 3, 'custeio'),
('339139', 'Publicações oficiais', 3, 'custeio'),
('449040', 'Serviços de TIC (capital)', 4, 'capital'),
('449052', 'Equipamentos e material permanente', 4, 'capital');

-- Plano Interno (PI)
CREATE TABLE dominio.plano_interno(
  code VARCHAR(20) NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  alinea CHAR(1)
);

INSERT INTO dominio.plano_interno (code, nome, alinea) VALUES
('K4CAIFGDIAR', 'Diárias', 'a'),
('K4CAIFGPASS', 'Passagens', 'b'),
('K4CAIFGPRCA', 'Serviços, materiais e capital', 'c');

-- Unidade Gestora emitente da NC (default DSG)
CREATE TABLE dominio.ug(
  code VARCHAR(10) NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.ug (code, nome) VALUES
('160035', 'Departamento de Ciencia e Tecnologia'),
('167035', 'Departamento de Ciencia e Tecnologia - Gestor'),
('160089', 'DSG - Diretoria de Serviço Geográfico'),
('160382', '1 CGEO - Primeiro Centro de Geoinformação'),
('160507', 'EME - Estado-Maior do Exército');

-- Tipo de licitacao (3.4 GCALC DSG / 3.5 propria)
CREATE TABLE dominio.tipo_licitacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_licitacao (code, nome) VALUES
(1, 'GCALC DSG'),
(2, 'Própria'),
(3, 'Participante');

-- Fase da licitação. Classifica o processo para filtrar e agrupar.
--
-- NÃO substitui `orcamento.licitacao.fase_atual`, que é texto livre e continua
-- existindo. Um registro real guarda 103 caracteres ("Homologado. Vencedor não
-- entregou os softwares licitados, o que implica que o pregão se tornou
-- fracassado"). Isso não é uma fase, é a história do processo, e é ela que
-- explica por que o empenho foi anulado. O código classifica; o texto narra.
--
-- Os valores saem do texto REAL das subseções 3.4 e 3.5 do RPCMTec de 2025 e de
-- 2026. Fase intermediária de tramitação ("na SALC", "na AGU") fica de fora até
-- que alguém a registre. Ver migrations/2026-08-04_licitacao_campos_fase_e_anexo.sql.
CREATE TABLE dominio.fase_licitacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

-- Os quatro valores saem dos `fase_atual` que os registros reais exibem. O
-- code 2 fica reservado para a fase anterior a homologacao, e so entra quando
-- aparecer o primeiro caso: dominio grande e vazio convida a classificar errado.
INSERT INTO dominio.fase_licitacao (code, nome) VALUES
(1, 'Previsto'),
(3, 'Homologado'),
(4, 'Fracassado'),
(5, 'Renovando contrato vigente');

-- Classificacao da NC (4.2 PDR / 4.7 Extra-PDR)
CREATE TABLE dominio.classificacao_nc(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.classificacao_nc (code, nome) VALUES
(1, 'PDR'),
(2, 'Extra-PDR');

-- Categoria do material de impressão da mapoteca.
--
-- Existe porque o RPCMTec separa o estoque em duas tabelas, "Insumos de
-- Impressão - Papel" (7.2) e "- Tintas" (7.3), e a separação PRECISA ser um
-- dado. Derivá-la do nome ("começa com Cartucho") funcionaria com o catálogo de
-- hoje e cairia calada no dia em que alguém cadastrasse "Tinta preta 300ml": o
-- material iria para a tabela errada sem erro nenhum, e o relatório do chefe
-- mentiria sem avisar. Ver migrations/2026-08-01_material_categoria.sql.
--
-- OUTRO existe para o material que não é insumo de impressão (cabeçote, peça de
-- reposição). Ele não sai em nenhuma das duas tabelas do RPCMTec, e é assim que
-- se declara isso: sem a opção, alguém teria de escolher entre papel e tinta
-- para algo que não é nem um nem outro.
CREATE TABLE dominio.categoria_material(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.categoria_material (code, nome) VALUES
(1, 'Papel'),
(2, 'Tinta'),
(3, 'Outro');

-- Tipo de item do DFD (material / servico)
CREATE TABLE dominio.tipo_item_dfd(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_item_dfd (code, nome) VALUES
(1, 'Material'),
(2, 'Serviço');

-- Grau de prioridade do DFD
CREATE TABLE dominio.grau_prioridade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.grau_prioridade (code, nome) VALUES
(1, 'Alta'),
(2, 'Normal'),
(3, 'Baixa');

-- Nivel de acesso DENTRO de um modulo, hierarquico (perfil_id >= minimo).
-- O administrador NAO e um nivel daqui: e a coluna dgeo.usuario.administrador,
-- global, acima de todo modulo e unica na plataforma.
CREATE TABLE dominio.tipo_perfil(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_perfil (code, nome) VALUES
(1, 'Consulta'),
(2, 'Operador'),
(3, 'Gerente');

-- Modulo funcional. E tabela, e nao CHECK na coluna, porque a plataforma vai
-- absorver outros modulos (producao): acrescentar um passa a ser INSERT, nao
-- migracao de constraint. Acervo, mapoteca e orcamento sao modulos distintos de
-- proposito: quem atende a mapoteca nao cataloga o acervo, e quem lanca empenho
-- nao precisa de nenhum dos dois. O codigo 3 e o SCO absorvido em 2026-07-27
-- (no repo de origem ele era o codigo 1).
CREATE TABLE dominio.modulo(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  nome_abrev VARCHAR(255) UNIQUE NOT NULL
);

INSERT INTO dominio.modulo (code, nome, nome_abrev) VALUES
(1, 'Controle do Acervo', 'acervo'),
(2, 'Mapoteca', 'mapoteca'),
(3, 'Controle Orçamentário', 'orcamento');

-- ---------------------------------------------------------------------------
-- Domínios do PIT e do efetivo (absorvidos do SAP em 2026-08-02).
--
-- Eles vieram porque as subseções 2.1, 2.6, 3.3, 6.1 e 6.2 do RPCMTec não
-- tinham dono no SCA e tinham no SAP, num dado que NÃO depende da produção: o
-- Extra-PIT, a execução manual de meta e o efetivo se cadastram à mão e não
-- olham `macrocontrole` nenhum. Nada saiu do SAP (decisão do chefe,
-- 2026-08-02): lá as tabelas continuam, e o SCA passa a ser quem gera essas
-- subseções.
--
-- Os códigos são os MESMOS do SAP, e isso é deliberado: quando os dois sistemas
-- se fundirem, a linha migrada não precisa de tradução de código. O que mudou
-- foi o NOME das tabelas, para caber na convenção daqui.
-- ---------------------------------------------------------------------------

-- Situação da demanda Extra-PIT (3.3 do RPCMTec).
CREATE TABLE dominio.situacao_extra_pit(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.situacao_extra_pit (code, nome) VALUES
(1, 'Previsto'),
(2, 'Em produção'),
(3, 'Enviado'),
(4, 'Concluído'),
(5, 'Cancelado');

-- Capacitação MINISTRADA alimenta a 2.6 (externos treinados por nós) e
-- RECEBIDA alimenta a 6.2 (nosso militar em curso). São duas subseções
-- diferentes do relatório e um cadastro só, porque a linha é a mesma coisa
-- vista dos dois lados; o que muda são as colunas que cada uma preenche.
CREATE TABLE dominio.tipo_capacitacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.tipo_capacitacao (code, nome) VALUES
(1, 'Ministrada'),
(2, 'Recebida');

CREATE TABLE dominio.situacao_capacitacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.situacao_capacitacao (code, nome) VALUES
(1, 'Prevista'),
(2, 'Em execução'),
(3, 'Concluída'),
(4, 'Cancelada');

-- De onde vem o número de uma meta do PIT (2026-08-03). Manual é o lançamento à
-- mão em `pit.execucao`, que foi o único jeito até esta data. Os outros três são
-- calculados na LEITURA, a partir do módulo que já registra o trabalho: nada é
-- gravado, porque dado derivado que se grava vira segunda verdade no primeiro
-- que editar a cópia à mão.
CREATE TABLE dominio.origem_meta(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.origem_meta (code, nome) VALUES
(1, 'Manual'),
(2, 'Capacitação'),
(3, 'Produção'),
(4, 'Impressão');

-- NÃO EXISTE `dominio.situacao_meta`. Ela existiu por um dia, em 2026-08-03,
-- com quatro estados. Dos quatro, só 'Cancelada' era ato da DSG, e por isso
-- virou o booleano `pit.meta_revisao.cancelada`; 'Em execução' e 'Concluída' a
-- grade calcula do que foi lançado, e status digitado ao lado de status
-- calculado é a segunda verdade que este banco vem eliminando.

-- O QUE A META DO PIT CONTA (2026-08-04). Antes era texto livre em
-- `pit.meta.unidade`, com 13 valores: 'carta' e 'folha' para a mesma coisa, e 12
-- itens SEM unidade nenhuma, incluindo as duas metas que já calculam sozinhas.
--
-- Cinco códigos, e o corte é por como se conta. Folha absorve carta e CDGV
-- (decisão do chefe, 2026-08-04). Marco é entregável único, e Atividade é o que
-- se repete no ano (12 atualizações de conteúdo). Item de acervo é o que a APHC
-- cataloga ou digitaliza.
--
-- A COERÊNCIA COM A ORIGEM é cobrada pelo controlador: origem Produção e
-- Impressão exigem Folha, e Capacitação exige Capacitação. É o que impede virar
-- automática uma meta cuja unidade não é a que a origem sabe contar.
CREATE TABLE dominio.unidade_meta(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.unidade_meta (code, nome) VALUES
(1, 'Folha'),
(2, 'Marco'),
(3, 'Capacitação'),
(4, 'Item de acervo'),
(5, 'Atividade');

-- O estado do ANO do PIT. 'Encerrado' é o que faz o servidor recusar lançamento
-- em ano fechado.
CREATE TABLE dominio.situacao_exercicio(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.situacao_exercicio (code, nome) VALUES
(1, 'Em elaboração'),
(2, 'Vigente'),
(3, 'Encerrado');

-- Quem preenche cada bloco do RPCMTec. É propriedade do NÚMERO da subseção, e
-- ainda assim vai gravada em cada linha de `rpcmtec.subsecao`: uma subseção
-- pode GRADUAR de digitada para calculada, e a edição fechada antes disso
-- continua sendo o que foi.
CREATE TABLE dominio.origem_subsecao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT
);

INSERT INTO dominio.origem_subsecao (code, nome, descricao) VALUES
(1, 'Calculada', 'O SCA a monta do banco. Recalcula enquanto a edição está aberta e congela no fechamento.'),
(2, 'Digitada', 'O gestor a preenche na edição do mês. É o que o SCA não sabe calcular.'),
(3, 'Fixa', 'Texto imutável do documento, igual em toda edição.');

COMMIT;