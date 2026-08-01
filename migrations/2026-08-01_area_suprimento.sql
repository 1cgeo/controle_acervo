-- A Area Sob Coordenacao (ASC) entra no banco, e a 2.7 do RPCMTec para de
-- passar de 100 por cento.
--
-- O PROBLEMA, medido em 2026-08-01 contra producao. A subsecao 2.7 do RPCMTec
-- ("Estado do Acervo") mede a fracao da nossa area ja catalogada. O numerador
-- contava o acervo INTEIRO, e o acervo tem folha de fora da ASC: na 1:50.000
-- Carta Topografica eram 943 folhas distintas contra um universo de 927, ou
-- seja, 101,7 por cento. Um relatorio que o chefe assina dizendo que 101,7 por
-- cento da area esta pronta.
--
-- A CORRECAO e recortar o numerador pela ASC. Com o recorte, a 1:50.000 da 927
-- sobre 927 e a 1:250.000 da 49 sobre 49 -- os dois fecham EXATAMENTE com o
-- universo do RT 11/2025, e e essa coincidencia que prova que o poligono e o
-- criterio (ST_Intersects) sao os certos. Nenhuma escala passa mais de 100.
--
-- POR QUE ST_Intersects, e nao "centro dentro da area": medido, o centro
-- (ST_PointOnSurface) da 43 na 1:250.000 contra as 49 do universo, porque a
-- folha de borda tem o centro fora. Folha que TOCA a ASC e folha da ASC.
--
-- O DDL abaixo e o mesmo de er/limites.sql, com IF NOT EXISTS e ON CONFLICT.
-- Aditiva e idempotente.
--
-- Para desfazer: DROP TABLE limites.area_suprimento;

BEGIN;

CREATE TABLE IF NOT EXISTS limites.area_suprimento (
    id SMALLINT NOT NULL PRIMARY KEY,
    cgeo VARCHAR(255) NOT NULL,
    -- Verdadeiro só na área DESTE Centro. É por esta coluna que a 2.7 filtra, e
    -- não pelo nome: o nome é texto livre da fonte, e comparar texto para
    -- decidir de quem é a área é o tipo de regra que quebra calado.
    e_1cgeo BOOLEAN NOT NULL DEFAULT FALSE,
    area_km2 DOUBLE PRECISION,
    geom geometry(MULTIPOLYGON, 4674) NOT NULL
);

CREATE INDEX IF NOT EXISTS area_suprimento_geom_idx ON limites.area_suprimento USING gist (geom);
-- Índice parcial e ÚNICO: existe uma só "nossa área", e a 2.7 a lê sem LIMIT.
-- Duas linhas com e_1cgeo verdadeiro dobrariam a contagem em silêncio.
CREATE UNIQUE INDEX IF NOT EXISTS area_suprimento_1cgeo_idx ON limites.area_suprimento (e_1cgeo) WHERE e_1cgeo;

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
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
