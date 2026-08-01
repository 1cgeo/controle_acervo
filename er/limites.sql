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

-- Área Sob Coordenação (ASC): a área de suprimento cartográfico do Centro.
--
-- Mora em `limites` pelo mesmo motivo que o município e o estado: é geometria de
-- REFERÊNCIA, que serve para RESPONDER onde as coisas estão. Quem a consulta é o
-- acervo (a subseção 2.7 do RPCMTec, "Estado do Acervo"), e ele não é dono dela.
--
-- POR QUE ELA PRECISA EXISTIR. A 2.7 mede a fração da ASC já catalogada. Sem o
-- polígono, o numerador contava o acervo INTEIRO, que inclui folha de fora da
-- área, e a conta passava de 100 por cento. Medido em 2026-08-01, contra
-- produção: a 1:50.000 Carta Topográfica dava 943 sobre 927, porque o acervo
-- guarda 943 folhas distintas nessa escala e só 927 são da ASC. Com o recorte dá
-- 927 sobre 927, e a 1:250.000 dá 49 sobre 49 -- os dois fecham EXATAMENTE com o
-- universo do RT 11/2025, e é essa coincidência que prova que o polígono e o
-- critério (ST_Intersects) são os certos.
--
-- SEMEADA AQUI, e não carregada de fora como a malha municipal, porque é UM
-- polígono de 61 pontos: 2 KB. A malha do IBGE tem 5.572 municípios e 25,8 MB, e
-- por isso a tabela dela nasce vazia. Deixar esta vazia faria toda instalação
-- nova nascer com a 2.7 errada, e ninguém perceberia.
--
-- Origem: banco `asc_insumos`, tabela `asc1cgeo.area_suprimento`, em 2026-08-01.
-- Só o 1º CGEO é semeado: é a única área que este sistema mede. As outras quatro
-- existem na fonte e entram por carga, se um dia fizerem falta.
CREATE TABLE limites.area_suprimento (
    id SMALLINT NOT NULL PRIMARY KEY,
    cgeo VARCHAR(255) NOT NULL,
    -- Verdadeiro só na área DESTE Centro. É por esta coluna que a 2.7 filtra, e
    -- não pelo nome: o nome é texto livre da fonte, e comparar texto para
    -- decidir de quem é a área é o tipo de regra que quebra calado.
    e_1cgeo BOOLEAN NOT NULL DEFAULT FALSE,
    area_km2 DOUBLE PRECISION,
    geom geometry(MULTIPOLYGON, 4674) NOT NULL
);

CREATE INDEX area_suprimento_geom_idx ON limites.area_suprimento USING gist (geom);
-- Índice parcial e ÚNICO: existe uma só "nossa área", e a 2.7 a lê sem LIMIT.
-- Duas linhas com e_1cgeo verdadeiro dobrariam a contagem em silêncio.
CREATE UNIQUE INDEX area_suprimento_1cgeo_idx ON limites.area_suprimento (e_1cgeo) WHERE e_1cgeo;

-- O WKT vai quebrado em pedaços de 72 caracteres por POSIÇÃO, e não por palavra:
-- literais adjacentes separados por quebra de linha o PostgreSQL concatena, mas
-- quebrar no espaço COMERIA o separador entre duas coordenadas e o polígono
-- sairia corrompido sem dar erro.
INSERT INTO limites.area_suprimento (id, cgeo, e_1cgeo, area_km2, geom) VALUES (
  1, '1º Centro de Geoinformação', TRUE, 694301,
  ST_GeomFromText(
    'MULTIPOLYGON(((-54.999999820477626 -27.499999859365687,-54.9999998204776'
    '26 -26.999999804532052,-54.49999976564399 -26.999999804532052,-54.000000'
    '21372452 -26.999999804532052,-54.00000021372452 -25.99999994632185,-54.9'
    '99999820477626 -25.99999994632185,-54.999999820477626 -24.49999978182094'
    '7,-55.49999987531126 -24.499999781820947,-55.49999987531126 -23.99999997'
    '8444407,-54.00000021372452 -23.999999978444407,-54.00000021372452 -22.99'
    '999986877711,-52.500000049223615 -22.99999986877711,-49.49327022543048 -'
    '23.010429806186636,-49.50000022313597 -23.999999978444407,-48.0000000586'
    '3504 -23.999999978444407,-48.00000005863504 -25.499999891488216,-48.0000'
    '0005863504 -25.99999994632185,-48.00000005863504 -26.500000001155513,-48'
    '.50000011346867 -26.500000001155513,-48.50000011346867 -26.9999998045320'
    '52,-48.00000005863504 -26.999999804532052,-48.00000005863504 -27.9999999'
    '1419932,-48.50000011346867 -27.99999991419932,-48.50000011346867 -28.999'
    '999772409524,-49.00000016830231 -28.999999772409524,-49.00000016830231 -'
    '29.49999982724316,-49.50000022313597 -29.49999982724316,-49.500000223135'
    '97 -29.999999882076793,-50.00000002651251 -29.999999882076793,-50.000000'
    '02651251 -30.999999991744062,-50.500000081346144 -30.999999991744062,-50'
    '.500000081346144 -31.49999979512063,-51.00000013617978 -31.4999997951206'
    '3,-51.00000013617978 -31.999999849954264,-51.50000019101341 -31.99999984'
    '9954264,-51.50000019101341 -32.4999999047879,-52.000000245847076 -32.499'
    '9999047879,-52.000000245847076 -32.99999995962153,-52.000000245847076 -3'
    '3.50000001445517,-52.500000049223615 -33.50000001445517,-52.500000049223'
    '615 -33.999999817831736,-54.00000021372452 -33.999999817831736,-54.00000'
    '021372452 -31.999999849954264,-54.999999820477626 -31.999999849954264,-5'
    '4.999999820477626 -31.49999979512063,-55.49999987531126 -31.499999795120'
    '63,-56.49999998497853 -31.49999979512063,-56.49999998497853 -30.49999993'
    '6910427,-57.99999989802237 -30.499999936910427,-57.99999989802237 -29.99'
    '9999882076793,-57.49999984318873 -29.999999882076793,-57.49999984318873 '
    '-29.49999982724316,-56.9999997883551 -29.49999982724316,-56.999999788355'
    '1 -28.999999772409524,-56.49999998497853 -28.999999772409524,-56.4999999'
    '8497853 -28.499999969032956,-55.999999930144895 -28.499999969032956,-55.'
    '999999930144895 -27.99999991419932,-55.49999987531126 -27.99999991419932'
    ',-55.49999987531126 -27.499999859365687,-54.999999820477626 -27.49999985'
    '9365687)))',
    4674)
);

COMMIT;
