BEGIN;

-- O PostGIS é declarado AQUI, e não só em `er/acervo.sql`, porque este arquivo
-- roda ANTES dele na ordem do create_config.js (limites não referencia ninguém,
-- e o filtro por município do acervo o consulta). Sem esta linha a instalação
-- nova morria em `tipo "geometry" não existe`, na primeira coluna geométrica
-- abaixo; o banco de teste não pegava porque o globalSetup do Jest cria as
-- extensões antes do laço. Todo arquivo de `er/` que usa geometria declara a
-- extensão, que é a convenção que `acervo.sql` já seguia.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Limite político-administrativo: município e estado.
--
-- Dado de REFERÊNCIA, e não acervo. Ele não é produto nem ponto de controle:
-- serve para RESPONDER onde as coisas estão, no filtro da busca e na tela de
-- ponto de controle ("o que existe em Cruz Alta?", "o que existe no RS?").
-- Por isso mora em schema próprio, e não dentro de `acervo` nem de
-- `ponto_controle`: os dois consultam, nenhum é dono.
--
-- Origem: malha municipal do IBGE, simplificada para 1/10 do tamanho original
-- (263 MB para 25,8 MB) pelo mesmo procedimento que gerou as malhas do plugin
-- `pto_controle` (ver `distributeImages/malhas/LEIA-ME.md` naquele repo). A
-- simplificação é de COBERTURA, então a adjacência sobrevive e não há fenda
-- entre municípios vizinhos: um ponto sobre a divisa cai em um dos dois, nunca
-- em nenhum.
--
-- O estado NÃO é uma tabela derivada por dissolve em tempo de consulta: ele
-- vem pronto, porque a pergunta "o que existe no RS" é frequente e dissolver
-- 497 municípios a cada consulta seria pagar caro por um dado que não muda.

CREATE SCHEMA limites;

CREATE TABLE limites.estado (
    id SMALLINT NOT NULL PRIMARY KEY,          -- código do IBGE (11 a 53)
    sigla CHAR(2) NOT NULL UNIQUE,
    nome VARCHAR(255) NOT NULL,
    regiao VARCHAR(255) NOT NULL,
    geom geometry(MULTIPOLYGON, 4674) NOT NULL
);

CREATE INDEX estado_geom_idx ON limites.estado USING gist (geom);
CREATE INDEX estado_nome_idx ON limites.estado (nome);

CREATE TABLE limites.municipio (
    id INTEGER NOT NULL PRIMARY KEY,           -- código do IBGE (7 dígitos)
    nome VARCHAR(255) NOT NULL,
    -- O nome sem acento e em minúscula, gravado na carga.
    --
    -- É coluna e não expressão de índice porque o `unaccent` do PostgreSQL não
    -- é IMMUTABLE, então não entra em índice sem embrulho, e a extensão nem
    -- está instalada neste banco. Quem digita "sao gabriel" precisa achar
    -- "São Gabriel", e sem esta coluna cada tecla varreria 5.572 linhas.
    nome_busca VARCHAR(255) NOT NULL,
    estado_id SMALLINT NOT NULL REFERENCES limites.estado (id),
    geom geometry(MULTIPOLYGON, 4674) NOT NULL
);

CREATE INDEX municipio_geom_idx ON limites.municipio USING gist (geom);
CREATE INDEX municipio_nome_busca_idx ON limites.municipio (nome_busca varchar_pattern_ops);
CREATE INDEX municipio_estado_idx ON limites.municipio (estado_id);

COMMIT;
