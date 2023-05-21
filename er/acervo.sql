BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA acervo;

CREATE TABLE acervo.tipo_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO acervo.tipo_produto (nome) VALUES
('Conjunto de dados geoespaciais vetoriais - ET-EDGV 2.1.3'),
('Carta Topográfica - T34-700'),
('Carta Ortoimagem'),
('Ortoimagem'),
('Modelo Digital de Superfície'),
('Modelo Digital de Terreno'),
('Conjunto de dados geoespaciais vetoriais - ET-EDGV 3.0'),
('Conjunto de dados geoespaciais vetoriais - MGCP'),
('Fototriangulação'),
('Imagem aérea/satélite'),
('Ponto de controle'),
('Carta Topográfica - ET-RDG'),
('Carta Temática'),
('Mapa de unidades'),
('Carta de trafegabilidade'),
('Rede de transporte'),
('Mapa de geografia humana'),
('Levantamento topográfico'),
('Carta ortoimagem de OM'),
('Conjunto de dados geoespaciais vetoriais - MUVD'),
('Modelo Digital de Superfície - TREx'),
('Conjunto de dados geoespaciais vetoriais para Ortoimagem - ET-EDGV 3.0'),
('Conjunto de dados geoespaciais vetoriais para Trafegabilidade');

CREATE TABLE acervo.volume_armazenamento(
	id SERIAL NOT NULL PRIMARY KEY,
	volume VARCHAR(255) NOT NULL
);

CREATE TABLE acervo.volume_tipo_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	tipo_produto_id SMALLINT NOT NULL REFERENCES acervo.tipo_produto (id),
	volume_armazenamento_id SMALLINT NOT NULL REFERENCES acervo.volume_armazenamento (id),
	primario BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE acervo.produto(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	uuid UUID UNIQUE NOT NULL,
	data_produto TIMESTAMP WITH TIME ZONE NOT NULL,
	mi VARCHAR(255),
	inom VARCHAR(255),
	denominador_escala INTEGER,
	tipo_produto_id SMALLINT NOT NULL REFERENCES acervo.tipo_produto (id),
	situacao_bdgex_id SMALLINT NOT NULL REFERENCES dominio.situacao_bdgex (code),
	orgao_produtor VARCHAR(255) NOT NULL,
	observacao TEXT,
	data_cadastramento  timestamp with time zone NOT NULL,
	usuario_cadastramento_id SMALLINT REFERENCES dgeo.usuario (id),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_id SMALLINT REFERENCES dgeo.usuario (id),
	geom geometry(POLYGON, 4326) NOT NULL	
);

CREATE INDEX produto_geom
    ON acervo.produto USING gist
    (geom)
    TABLESPACE pg_default;

CREATE TABLE acervo.arquivo(
	id SERIAL NOT NULL PRIMARY KEY,
	volume_armazenamento_id SMALLINT NOT NULL REFERENCES acervo.volume_armazenamento (id),
	produto_id SMALLINT NOT NULL REFERENCES acervo.produto (id),
	nome VARCHAR(255) NOT NULL,
	extensao VARCHAR(255) NOT NULL,
	tamanho_mb REAL NOT NULL,
	metadado BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE acervo.produto_deletado(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	uuid UUID UNIQUE NOT NULL,
	data_produto TIMESTAMP WITH TIME ZONE NOT NULL,
	tipo_produto_id SMALLINT REFERENCES acervo.tipo_produto (id),
	data_delete  timestamp with time zone,
	usuario_delete_id SMALLINT REFERENCES dgeo.usuario (id),
	geom geometry(POLYGON, 4326) NOT NULL
);

CREATE TABLE acervo.download(
	id SERIAL NOT NULL PRIMARY KEY,
	produto_id SMALLINT REFERENCES acervo.produto (id),
	usuario_id SMALLINT REFERENCES dgeo.usuario (id),
	data TIMESTAMP WITH TIME ZONE NOT NULL
);

COMMIT;