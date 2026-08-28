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
(5, 'Escala personalizada'),
-- O produto sem escala: modelo 3D e panoramica 360 nao tem denominador, e a
-- escala de um tileset varia com a distancia da camera. Ver
-- migrations/2026-08-28_o_modelo_3d_nao_tem_escala.sql.
(6, 'Sem escala');

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
(13, 'Levantamento topográfico'),
-- A panoramica 360 do ebgeo_360: um produto por PROJETO, e nao por foto. Ver
-- migrations/2026-08-28_a_panoramica_360_entra_no_dominio.sql.
(14, 'Panorâmica 360');

CREATE TABLE dominio.subtipo_produto (
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL UNIQUE,
	tipo_id SMALLINT NOT NULL REFERENCES dominio.tipo_produto(code),
	-- Marca os subtipos que DEFINEM a identidade de um produto proprio (ex.: Carta
	-- Topografica Militar). Um subtipo assim so pode existir como produto proprio
	-- (acervo.produto.subtipo_produto_id), nunca como versao de um produto de outro
	-- subtipo. Ver acervo.validate_version.
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
(30, 'CDGV Especial', 8),
-- Nomeia a REPRESENTACAO da panoramica, como o 25 faz para o Modelo 3D: hoje
-- ela existe em piramide de tiles, e o full_webp foi podado em 2026-08-19.
(31, 'Panorâmica 360 em pirâmide de tiles', 14);

-- Carta Topografica Militar define seu proprio produto (distinta da carta civil no
-- mesmo MI): a chave de identidade do produto e o subtipo, nao o tipo.
UPDATE dominio.subtipo_produto SET define_produto = true WHERE code = 24;

-- ---------------------------------------------------------------------------
-- Dominios do modulo orcamento. Ficam aqui, e nao em orcamento.sql, porque o
-- schema dominio e unico na plataforma. tipo_posto_grad, tipo_perfil e modulo
-- NAO se duplicam por modulo.
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

-- NAO EXISTE `dominio.categoria_material`, desde 2026-08-08. Ela separava o
-- material da mapoteca em Papel, Tinta e Outro, e a unica coisa que a separacao
-- decidia era em qual das duas tabelas de insumo do RPCMTec o material sairia:
-- a 7.2 (Papel) ou a 7.3 (Tintas).
--
-- O chefe FUNDIU as duas na 7.2, e a 7.3 sumiu. Sem duas tabelas, a coluna
-- `mapoteca.tipo_material.categoria_id` deixou de decidir qualquer coisa: ela
-- classificava para um recorte que nao existe mais. Ver
-- migrations/2026-08-08_livro_de_movimentos.sql, que a apaga junto com a mesa
-- de dominio, e a secao "Mapoteca e plugin" de docs/decisoes.md.
--
-- A CATEGORIA DE 29 MATERIAIS foi dumpada antes do DROP, porque ela nao existe
-- em nenhum outro lugar do banco. O arquivo esta FORA do repositorio.

-- Tipo de item do DFD (material / servico)
CREATE TABLE dominio.tipo_item_dfd(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_item_dfd (code, nome) VALUES
(1, 'Material'),
(2, 'Serviço');

-- NAO HA `dominio.grau_prioridade`, e a ausencia acompanha a coluna que a
-- citava. Ela guardava Alta, Normal e Baixa, e a UNICA chave estrangeira para
-- ela em todo o sistema era `orcamento.dfd.grau_prioridade_id`, preenchida em 1
-- linha de 8 e sempre com o codigo 1. Nenhum WHERE, nenhuma agregacao, nenhum
-- relatorio. Podar a coluna e deixar o catalogo servindo por
-- `GET /orcamento/dominio/grau_prioridade` seria deixar meio cadaver, que e o
-- que a 1.34.0 ja recusou uma vez: a coluna, a tabela e a rota sairam no MESMO
-- commit. Ver migrations/2026-08-08_poda_do_orcamento.sql.

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

-- Modulo funcional. E tabela, e nao CHECK na coluna, e a promessa ja foi cobrada
-- TRES vezes: producao e efetivo entraram na 1.33.0 por INSERT, equipamento na
-- 1.46.0 e producao (o de verdade, o code 7) em 2026-08-09, nenhum deles com
-- migracao de constraint. Os SETE sao compartimentos
-- distintos de proposito: quem atende a mapoteca nao cataloga o acervo, quem
-- lanca empenho nao precisa de nenhum dos dois, e quem lanca a execucao do PIT
-- nao mexe em dinheiro.
--
-- PIT (4) e EFETIVO (5) nasceram para haver como dar MENOS que a flag global.
-- Ate a 1.32.0 a execucao do PIT, o Extra-PIT, a capacitacao e o aproveitamento
-- do efetivo so tinham `verifyAdmin`, e por isso 5 das 7 contas que trabalhavam
-- no sistema eram administradoras (medido em 2026-08-06). Ver
-- migrations/2026-08-06_modulos_producao_e_efetivo.sql. O 4 se chamava
-- `producao` ate 2026-08-09.
--
-- O `code` E FIXO, e nao serial: `dgeo.usuario_perfil.modulo_id` o referencia, e
-- o mapa `MODULO` de server/src/login/verify_perfil.js espelha estes numeros.
--
-- AS DUAS COLUNAS DE NOME NAO SAO A MESMA COISA, e confundi-las quebra a
-- autorizacao inteira:
--
--   `nome`       ROTULO, e so isso. E o que a interface mostra no menu, no
--                cabecalho da tela de usuarios e na pagina de perfil. Trocar e
--                inocente, e foi trocado em 2026-08-08 (ver
--                migrations/2026-08-08_rotulo_dos_modulos.sql).
--   `nome_abrev` IDENTIFICADOR, e o codigo inteiro depende do valor exato:
--                `verifyPerfil(nivel, 'acervo')`, o mapa `MODULO` de
--                verify_perfil.js, o prefixo de rota `/api/orcamento/`, a chave
--                do mapa `perfis` que o login devolve e o manifesto de modulo do
--                client. NAO SE MEXE.
CREATE TABLE dominio.modulo(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  nome_abrev VARCHAR(255) UNIQUE NOT NULL
);

-- O CODE 4 CHAMAVA-SE 'Produção' / 'producao' ATÉ 2026-08-09.
--
-- Ele nunca guardou a produção de verdade: o que mora nele é o PIT (a execução
-- do plano, o Extra-PIT, a capacitação ministrada e as atividades de campo). O
-- menu já dizia "PIT" desde que a seção nasceu, e o `nome_abrev` dizia outra
-- coisa. O CLAUDE.md carregava um parágrafo só para explicar a divergência.
--
-- O QUE FORÇOU A TROCA foi o SAP. O core de produção dele (`macrocontrole`, 45
-- tabelas) entra num módulo, e esse módulo é que se chama Produção. Com o nome
-- ocupado por quem não é produção, o módulo novo nasceria com um nome de
-- segunda ou herdaria as telas do PIT por engano.
--
-- O CODE 7 É O MÓDULO PRODUÇÃO DE VERDADE, e nasceu em 2026-08-09, no mesmo dia
-- em que o 4 devolveu o nome. Ele cobre o core de produção que veio do SAP
-- 2.3.5: a linha de produção, as subfases, as unidades de trabalho, a fila de
-- distribuição e o acompanhamento, que moram no schema `producao`. Não tem
-- rota ainda, e o mapa `MODULO` de server/src/login/verify_perfil.js só o ganha
-- quando as rotas do módulo entrarem: conceder perfil num módulo sem tela é
-- linha morta em `dgeo.usuario_perfil`, e o DDL é que nasce primeiro porque a
-- chave estrangeira precisa do code existir antes da primeira concessão.
--
-- O CORPO DESTE INSERT NÃO ACEITA PROSA, e o comentário mora aqui em cima por
-- isso: `__tests__/routes/orcamento/verify_perfil.test.js` lê este bloco com um
-- `[\s\S]*?;` não guloso, e um ponto e vírgula dentro dele corta a captura no
-- meio. Custou uma suíte vermelha em 2026-08-09.
INSERT INTO dominio.modulo (code, nome, nome_abrev) VALUES
(1, 'Acervo', 'acervo'),
(2, 'Mapoteca', 'mapoteca'),
(3, 'Orçamento', 'orcamento'),
(4, 'PIT', 'pit'),
(5, 'Efetivo', 'efetivo'),
(6, 'Equipamento', 'equipamento'),
(7, 'Produção', 'producao');

-- ---------------------------------------------------------------------------
-- Domínios do PIT e do efetivo, absorvidos do SAP.
--
-- Eles estão aqui porque as subseções 2.1, 2.6, 3.3, 6.1 e 6.2 do RPCMTec saem
-- de dado que NÃO depende da produção: o Extra-PIT, a execução manual de meta e
-- o efetivo se cadastram à mão e não olham `macrocontrole` nenhum. Nada SAIU do
-- SAP: lá as tabelas continuam, e o SCA é quem gera essas subseções.
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

-- De onde vem o número de uma meta do PIT. Manual é o lançamento à
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

-- NÃO EXISTE `dominio.situacao_meta`. Dos quatro estados que ela teria, só
-- 'Cancelada' é ato da DSG, e por isso ele é o booleano
-- `pit.meta_item_revisao.cancelada`; 'Em execução' e 'Concluída' a
-- grade calcula do que foi lançado, e status digitado ao lado de status
-- calculado é a segunda verdade que este banco vem eliminando.

-- O QUE A META DO PIT CONTA. Antes era texto livre em
-- `pit.meta.unidade`, com 13 valores (a coluna e hoje `pit.meta_item.unidade_id`): 'carta' e 'folha' para a mesma coisa, e 12
-- itens SEM unidade nenhuma, incluindo as duas metas que já calculam sozinhas.
--
-- Cinco códigos, e o corte é por como se conta. Folha absorve carta e CDGV.
-- Marco é entregável único, e Atividade é o que
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

-- ---------------------------------------------------------------------------
-- Domínios do módulo PRODUÇÃO (code 7), absorvidos do SAP 2.3.5 em 2026-08-09.
--
-- São os domínios que o schema `producao` referencia. Eles moram aqui, e não em
-- producao.sql, porque o schema `dominio` é único na plataforma: é a mesma
-- regra que já trouxe para cá os domínios do orçamento e os do PIT.
--
-- OS CÓDIGOS SÃO OS MESMOS DO SAP, code a code, e isso é deliberado: o dump de
-- produção do SAP 2.3.5 é o que vai popular estes schemas, e linha migrada não
-- pode precisar de tradução de código. Renumerar custaria um de-para em toda a
-- carga para não ganhar nada.
--
-- DOIS NOMES FORAM QUALIFICADOS. `tipo_situacao` e `tipo_problema` eram nomes
-- bons num banco que só falava de produção, e são genéricos demais num
-- `dominio` de sete módulos: aqui situação já é a do pedido da mapoteca, a da
-- capacitação, a do Extra-PIT e a do exercício do PIT. Entram como
-- `tipo_situacao_atividade` e `tipo_problema_atividade`, que é do que eles
-- sempre falaram: da atividade de `producao.atividade`.
--
-- QUATRO DOMÍNIOS DO SAP NÃO ATRAVESSARAM. Quem vier procurar por eles lê aqui
-- o porquê, porque procurar e não achar é o que faz alguém recriá-los:
--
--   `dominio.status` do SAP (Previsto / Em Execução, Finalizado, Abandonado)
--   duplicaria `dominio.tipo_status_execucao` deste arquivo, que o
--   `acervo.projeto` e o `acervo.lote` já usam. Toda coluna que apontava para
--   ela passa a apontar `dominio.tipo_status_execucao (code)`. Dois catálogos
--   para a mesma pergunta é a segunda verdade que este banco vem eliminando.
--
--   `dominio.tipo_posto_grad` do SAP já existe aqui, no topo deste arquivo, e é
--   IDÊNTICA: os mesmos 19 códigos, o mesmo `nome` e a mesma `nome_abrev`,
--   conferidos linha a linha em 2026-08-09. Não há o que trazer.
--
--   `dominio.tipo_produto` do SAP é o `dominio.subtipo_produto` daqui, código a
--   código: 22 dos 23 batem até no nome, e só o 19 difere de rótulo ('Carta
--   ortoimagem de OM' lá, 'Carta Ortoimagem de SARP' aqui). Toda coluna que no
--   SAP apontava `dominio.tipo_produto` passa a apontar
--   `dominio.subtipo_produto (code)`. CUIDADO com o homônimo: o
--   `dominio.tipo_produto` DESTE arquivo é outra coisa, um nível acima do
--   subtipo, e apontar para ele daria a granularidade errada sem erro nenhum.
--
--   `dominio.tipo_turno` (Manhã, Tarde, Integral) foi REMOVIDA por decisão do
--   chefe em 2026-08-09. Ela tinha dois consumidores no SAP, e nenhum dos dois
--   atravessa: `dgeo.usuario.tipo_turno_id`, e usuário aqui é o do SCA (que
--   nunca teve turno), e o code 3 de `tipo_restricao`, que sai junto. Leia o
--   comentário daquela tabela, que é onde está a medição.
-- ---------------------------------------------------------------------------

-- Fase agrupa subfases, e corresponde às fases do RTM e às do metadado do
-- BDGEx. A `cor` (R,G,B em texto) não é enfeite: as funções do schema
-- `acompanhamento` a injetam no estilo das views que o QGIS abre, e por isso
-- ela viaja no domínio e não no client.
CREATE TABLE dominio.tipo_fase(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  cor VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_fase (code, nome, cor) VALUES
(1, 'Extração', '252,141,89'),
(2, 'Reambulação', '254,224,139'),
(3, 'Validação', '255,255,191'),
(4, 'Edição', '217,239,139'),
(5, 'Disseminação', '145,207,96'),
(6, 'Vetorização', '222,119,174'),
(7, 'Avaliação', '175,141,195'),
(8, 'Generalização', '224,243,248'),
(9, 'Fototriangulação', '44,127,184'),
(10, 'Restituição', '186,186,186'),
(11, 'Processamento Digital de Imagens', '215,48,39'),
(12, 'Medição de pontos de controle', '0,0,0'),
(13, 'Geração de ortoimagem', '128,205,193'),
(14, 'Geração de MDE', '191,129,45'),
(15, 'Levantamento topográfico', '37,52,148'),
(16, 'Preparo', '175,141,195');

-- O que uma subfase exige da subfase anterior para liberar a distribuição.
CREATE TABLE dominio.tipo_pre_requisito(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_pre_requisito (code, nome) VALUES
(1, 'Região concluída'),
(2, 'Região não estar em execução');

-- O papel da etapa dentro da subfase. É o que distingue quem produz de quem
-- confere, e é sobre ele que a restrição de operador é escrita.
CREATE TABLE dominio.tipo_etapa(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_etapa (code, nome) VALUES
(1, 'Execução'),
(2, 'Revisão'),
(3, 'Correção'),
(4, 'Revisão/Correção'),
(5, 'Revisão final');

-- Quanto da linhagem o operador vê. Quem revisa precisa saber quem executou;
-- quem executa nem sempre precisa saber quem revisou.
CREATE TABLE dominio.tipo_exibicao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_exibicao (code, nome) VALUES
(1, 'Não exibir usuários na linhagem'),
(2, 'Exibir usuários na linhagem somente para revisores'),
(3, 'Sempre exibir usuários na linhagem');

-- Restrição entre duas etapas da MESMA unidade de trabalho: quem fez uma não
-- pode (ou tem de) fazer a outra. É o que impede o operador de revisar o
-- próprio trabalho.
--
-- SÃO DOIS CÓDIGOS, E NÃO TRÊS. O code 3 era 'Operadores no mesmo turno' e não
-- atravessou: ele dependia de `dominio.tipo_turno`, removida por decisão do
-- chefe em 2026-08-09. A ausência foi MEDIDA antes de decidir, no dump de
-- produção do SAP em 2026-08-09: `restricao_etapa` tem 98 linhas, 49 do tipo 1
-- e 49 do tipo 2, e ZERO do tipo 3. Ressuscitá-lo é decisão, e decisão se
-- registra em docs/decisoes.md.
CREATE TABLE dominio.tipo_restricao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_restricao (code, nome) VALUES
(1, 'Operadores distintos'),
(2, 'Operadores iguais');

-- COMO o insumo chega ao operador. Não é o que o insumo É: é o caminho que o
-- QGIS percorre para abri-lo, e por isso 'cópia via rede' e 'aberto via rede'
-- são dois códigos para o mesmo arquivo.
CREATE TABLE dominio.tipo_insumo(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_insumo (code, nome) VALUES
(1, 'Arquivo (cópia via rede)'),
(2, 'Arquivo (aberto via rede)'),
(3, 'Banco de dados PostGIS'),
(4, 'Insumo físico'),
(5, 'URL'),
(6, 'Serviço WMS'),
(7, 'Serviço WFS'),
(8, 'XYZ Tiles'),
(9, 'Download via HTTP'),
(10, 'ArcGis MapServer');

-- Quanto o sistema manda no dado que a subfase produz. O code 2 é o único em
-- que ele concede e revoga permissão no banco de produção a cada distribuição.
CREATE TABLE dominio.tipo_dado_producao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_dado_producao (code, nome) VALUES
(1, 'Dado não controlado pelo SAP'),
(2, 'Banco de dados PostGIS com controle de permissões'),
(3, 'Banco de dados PostGIS');

-- O ESTADO DE UMA ATIVIDADE, e o coração da distribuição. Chamava-se
-- `dominio.tipo_situacao` no SAP.
--
-- 'Não finalizada' (5) NÃO é 'Pausada' (3), e confundi-las mente na estatística
-- de produção: pausada é a que volta para a mesma mão, e não finalizada é a que
-- foi interrompida por fora e não volta. É o que o SAP grava quando o gerente
-- interrompe a atividade em execução e quando unidades de trabalho são fundidas
-- ou redivididas por baixo dela (conferido no código do SAP 2.3.5 em
-- 2026-08-09).
CREATE TABLE dominio.tipo_situacao_atividade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_situacao_atividade (code, nome) VALUES
(1, 'Não iniciada'),
(2, 'Em execução'),
(3, 'Pausada'),
(4, 'Finalizada'),
(5, 'Não finalizada');

-- Ferramenta de aquisição do DSGTools que o perfil de configuração liga.
CREATE TABLE dominio.tipo_configuracao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_configuracao (code, nome) VALUES
(1, 'DSGTools - Centroide'),
(2, 'DSGTools - Mão livre'),
(3, 'DSGTools - Seletor Genérico'),
(4, 'DSGTools - Ângulo Reto');

-- Como a fila prioritária escolhe entre as unidades de trabalho disponíveis
-- para um operador, dada a dificuldade delas.
CREATE TABLE dominio.tipo_perfil_dificuldade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_perfil_dificuldade (code, nome) VALUES
(1, 'Distribuir atividades mais fáceis'),
(2, 'Distribuir atividades mais difíceis'),
(3, 'Distribuir de forma balanceada');

-- Quanto controle de qualidade a rotina de criação de fluxo põe nas subfases.
-- NÃO é coluna de tabela nenhuma: é argumento da criação em massa, e por isso
-- não tem chave estrangeira apontando para cá.
CREATE TABLE dominio.tipo_controle_qualidade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_controle_qualidade (code, nome) VALUES
(1, 'Sem controle de qualidade nas subfases'),
(2, 'Uma Revisão/Correção em todas as subfases'),
(3, 'Uma Revisão em todas as subfases');

-- Em que pedaço o produto vira unidade de trabalho. Também é argumento de
-- rotina de criação em massa, e não coluna.
CREATE TABLE dominio.tipo_criacao_unidade_trabalho(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_criacao_unidade_trabalho (code, nome) VALUES
(1, 'Produto'),
(2, '1/4 de produto'),
(3, '1/9 de produto'),
(4, 'Bloco'),
(5, '1/4 de bloco'),
(6, '1/9 de bloco');

-- O QUE O OPERADOR RECLAMOU. Chamava-se `dominio.tipo_problema` no SAP.
--
-- O 99 É 'Outros', e não 8: a lacuna deixa o catálogo crescer pelo fim sem que
-- 'Outros' deixe de ser o último da lista e sem renumerar linha já gravada.
CREATE TABLE dominio.tipo_problema_atividade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_problema_atividade (code, nome) VALUES
(1, 'Insumo não é suficiente para execução da atividade'),
(2, 'Problema em etapa anterior, necessita ser refeita'),
(3, 'Erro durante execução da atividade atual'),
(4, 'Problema em unidade de trabalho vizinha'),
(5, 'Grande quantidade de objetos na unidade de trabalho, necessita ser dividida'),
(6, 'Problema nas rotinas'),
(7, 'Finalizei a atividade incorretamente'),
(99, 'Outros');

-- A regra espacial que casa um insumo com as unidades de trabalho. Argumento
-- da rotina de associação, e não coluna.
CREATE TABLE dominio.tipo_estrategia_associacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_estrategia_associacao (code, nome) VALUES
(1, 'Centroide da unidade de trabalho contido no insumo'),
(2, 'Centroide do insumo contido na unidade de trabalho'),
(3, 'Interseção entre insumo e unidade de trabalho'),
(4, 'Sobreposição entre insumo e unidade de trabalho'),
(5, 'Associar insumo a todas as unidades de trabalho');

-- Para que serve a rotina que o perfil de requisito de finalização exige. A
-- diferença entre 1 e 2 é se o operador pode marcar apontamento como falso
-- positivo e finalizar assim mesmo.
CREATE TABLE dominio.tipo_rotina(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_rotina (code, nome) VALUES
(1, 'Controle de qualidade sem falso positivo'),
(2, 'Controle de qualidade com falso positivo'),
(3, 'Auxiliar');

COMMIT;