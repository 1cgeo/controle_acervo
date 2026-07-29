-- Limite politico-administrativo: municipio e estado, para o filtro por lugar.
--
-- Dado de REFERENCIA em schema proprio: o acervo e o ponto de controle
-- consultam, nenhum e dono. Ver er/limites.sql para o porque de cada escolha.
--
-- Esta migracao cria a ESTRUTURA vazia. A carga dos 5.572 municipios e dos 27
-- estados e um passo separado (ogr2ogr a partir dos gpkg simplificados), porque
-- sao 26 MB de geometria e nao cabem num arquivo de migracao.
--
-- Idempotente: roda duas vezes sem erro.

BEGIN;

CREATE SCHEMA IF NOT EXISTS limites;

CREATE TABLE IF NOT EXISTS limites.estado (
    id SMALLINT NOT NULL PRIMARY KEY,
    sigla CHAR(2) NOT NULL UNIQUE,
    nome VARCHAR(255) NOT NULL,
    regiao VARCHAR(255) NOT NULL,
    geom geometry(MULTIPOLYGON, 4674) NOT NULL
);

CREATE INDEX IF NOT EXISTS estado_geom_idx ON limites.estado USING gist (geom);
CREATE INDEX IF NOT EXISTS estado_nome_idx ON limites.estado (nome);

CREATE TABLE IF NOT EXISTS limites.municipio (
    id INTEGER NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    nome_busca VARCHAR(255) NOT NULL,
    estado_id SMALLINT NOT NULL REFERENCES limites.estado (id),
    geom geometry(MULTIPOLYGON, 4674) NOT NULL
);

CREATE INDEX IF NOT EXISTS municipio_geom_idx ON limites.municipio USING gist (geom);
CREATE INDEX IF NOT EXISTS municipio_nome_busca_idx
    ON limites.municipio (nome_busca varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS municipio_estado_idx ON limites.municipio (estado_id);

UPDATE public.versao SET nome = '1.8.0' WHERE code = 1;

COMMIT;
