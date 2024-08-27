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

CREATE TABLE dominio.situacao_bdgex(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.situacao_bdgex (code, nome) VALUES
(1, 'Não carregado'),
(2, 'Carregado BDGEx Ostensivo'),
(3, 'Carregado BDGEx Operações');

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
(2, 'Registro Histórico');

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
(1, 'Conjunto de dados geoespaciais vetoriais - ET-EDGV 2.1.3'),
(2, 'Carta Topográfica - T34-700'),
(3, 'Carta Ortoimagem'),
(4, 'Ortoimagem'),
(5, 'Modelo Digital de Superfície'),
(6, 'Modelo Digital de Terreno'),
(7, 'Conjunto de dados geoespaciais vetoriais - ET-EDGV 3.0'),
(8, 'Conjunto de dados geoespaciais vetoriais - MGCP'),
(9, 'Fototriangulação'),
(10, 'Imagem aérea/satélite'),
(11, 'Ponto de controle'),
(12, 'Carta Topográfica - ET-RDG'),
(13, 'Carta Temática'),
(14, 'Mapa de unidades'),
(15, 'Carta de trafegabilidade'),
(16, 'Rede de transporte'),
(17, 'Mapa de geografia humana'),
(18, 'Levantamento topográfico'),
(19, 'Carta ortoimagem de OM'),
(20, 'Conjunto de dados geoespaciais vetoriais - MUVD'),
(21, 'Modelo Digital de Superfície - TREx'),
(22, 'Conjunto de dados geoespaciais vetoriais para Ortoimagem - ET-EDGV 3.0'),
(23, 'Conjunto de dados geoespaciais vetoriais para Trafegabilidade'),
(24, 'Carta Topográfica Militar');

COMMIT;