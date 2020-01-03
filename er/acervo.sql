BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA acervo;

CREATE TABLE acervo.tipo_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO acervo.tipo_produto (id, nome) VALUES
(1, 'Conjunto de dados geoespaciais vetoriais'),
(2, 'Carta Topográfica'),
(3, 'Carta Ortoimagem'),
(4, 'Ortoimagem'),
(5, 'Modelo Digital de Superfície'),
(6, 'Modelo Digital de Terreno'),
(7, 'Carta Temática'),
(8, 'Conjunto de dados geoespaciais vetoriais - MGCP'),
(9, 'Fototriangulação'),
(10, 'Imagem aérea/satélite'),
(11, 'Ponto de controle');

CREATE TABLE acervo.volume_armazenamento(
	id SERIAL NOT NULL PRIMARY KEY,
	tipo_produto_id SMALLINT NOT NULL REFERENCES acervo.tipo_produto (id),
	volume VARCHAR(255) NOT NULL
);

CREATE TABLE acervo.produto(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	uuid UUID UNIQUE,
	data_produto TIMESTAMP WITH TIME ZONE NOT NULL,
	mi VARCHAR(255),
	inom VARCHAR(255),
	denominador_escala INTEGER NOT NULL,
	tipo_produto_id SMALLINT NOT NULL REFERENCES acervo.tipo_produto (id),
	situacao_bdgex_id SMALLINT NOT NULL REFERENCES dominio.situacao_bdgex (code),
	orgao_produtor VARCHAR(255) NOT NULL,
	observacao TEXT,
	data_cadastramento  timestamp with time zone NOT NULL,
	usuario_cadastramento SMALLINT NOT NULL REFERENCES dgeo.usuario (id),
	data_modificacao  timestamp with time zone,
	usuario_modificacao SMALLINT REFERENCES dgeo.usuario (id),
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
	path_relativo TEXT NOT NULL,
	nome VARCHAR(255) NOT NULL,
	extensao VARCHAR(255) NOT NULL,
	tamanho_mb REAL NOT NULL,
	metadado BOOLEAN NOT NULL DEFAULT FALSE
);

-- Constraint
CREATE OR REPLACE FUNCTION acervo.verifica_tipo_produto()
  RETURNS trigger AS
$BODY$
    DECLARE nr_erro integer;
    BEGIN

	SELECT count(*) into nr_erro from acervo.arquivo AS a
	INNER JOIN acervo.volume_armazenamento AS va ON va.id = a.volume_armazenamento_id
	INNER JOIN acervo.produto AS p ON p.id = a.produto_id
	WHERE va.tipo_produto_id != p.tipo_produto_id;

	IF nr_erro > 0 THEN
		RAISE EXCEPTION 'O arquivo deve ser adicionado em um volume compatível com o tipo_produto.';
	END IF;

	RETURN NEW;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;
ALTER FUNCTION acervo.verifica_tipo_produto()
  OWNER TO postgres;

CREATE TRIGGER verifica_tipo_produto
BEFORE UPDATE OR INSERT ON acervo.arquivo
FOR EACH STATEMENT EXECUTE PROCEDURE acervo.verifica_tipo_produto();

--

CREATE TABLE acervo.produto_deletado(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	uuid UUID UNIQUE,
	data_produto TIMESTAMP WITH TIME ZONE NOT NULL,
	mi VARCHAR(255),
	inom VARCHAR(255),
	denominador_escala INTEGER NOT NULL,
	tipo_produto_id SMALLINT NOT NULL REFERENCES acervo.tipo_produto (id),
	nome_arquivo VARCHAR(255) NOT NULL,
	extensao VARCHAR(255) NOT NULL,
	geom geometry(POLYGON, 4326) NOT NULL
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