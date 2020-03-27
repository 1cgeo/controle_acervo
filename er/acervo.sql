BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA acervo;

CREATE TABLE acervo.tipo_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO acervo.tipo_produto (nome) VALUES
('Conjunto de dados geoespaciais vetoriais'),
('Carta Topográfica'),
('Carta Ortoimagem'),
('Ortoimagem'),
('Modelo Digital de Superfície'),
('Modelo Digital de Terreno'),
('Carta Temática'),
('Carta de Trafegabilidade'),
('Conjunto de dados geoespaciais vetoriais - Trafegabilidade'),
('Conjunto de dados geoespaciais vetoriais - MGCP'),
('Fototriangulação'),
('Imagem aérea/satélite'),
('Ponto de controle');

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

-- Constraint
CREATE OR REPLACE FUNCTION acervo.verifica_volume_primario()
  RETURNS trigger AS
$BODY$
    DECLARE erro BOOLEAN;
    BEGIN

	SELECT count(CASE WHEN vtp.primario THEN 1 END) != 1 INTO erro 
	FROM acervo.volume_tipo_produto AS vtp
	GROUP BY vtp.tipo_produto_id;

	IF erro IS TRUE THEN
		RAISE EXCEPTION 'Deve existir um e somente um volume primário para cada tipo de produto';
	END IF;

	RETURN NEW;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;
ALTER FUNCTION acervo.verifica_volume_primario()
  OWNER TO postgres;

CREATE TRIGGER verifica_volume_primario
BEFORE UPDATE OR INSERT ON acervo.volume_tipo_produto
FOR EACH STATEMENT EXECUTE PROCEDURE acervo.verifica_volume_primario();

--

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

-- Adapted from
-- https://raw.githubusercontent.com/jawg/blog-resources/master/how-to-make-mvt-with-postgis/bbox.sql
CREATE OR REPLACE FUNCTION acervo.BBox(x integer, y integer, zoom integer)
    RETURNS geometry AS
$BODY$
DECLARE
    max numeric := 6378137 * pi();
    res numeric := max * 2 / 2^zoom;
    bbox geometry;
BEGIN
    return ST_Transform(ST_MakeEnvelope(
        -max + (x * res),
        max - (y * res),
        -max + (x * res) + res,
        max - (y * res) - res,
        3857), 4326);
END;
$BODY$
LANGUAGE plpgsql IMMUTABLE;

ALTER FUNCTION acervo.BBox(integer,integer,integer)
  OWNER TO postgres;

COMMIT;