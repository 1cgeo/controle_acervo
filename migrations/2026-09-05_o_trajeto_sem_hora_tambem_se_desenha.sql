-- O TRAJETO SEM HORA TAMBEM SE DESENHA.
--
-- POR QUE. A view `campo.track_linha` filtrava `WHERE p.momento IS NOT NULL` e
-- costurava `ORDER BY p.momento`. Um trajeto importado de GeoJSON entra com
-- `momento` NULO em TODO ponto -- GeoJSON de linha nao carrega hora, e o
-- conversor do client monta `momento: null` para cada coordenada --, entao
-- aquele filtro descartava o track inteiro e a view nao devolvia linha nenhuma
-- para ele.
--
-- O que a pessoa via: o servidor respondia "Trajeto importado com 6.500
-- pontos", a lista mostrava os 6.500 pontos e, ao lado, "sem linha para
-- desenhar". O trajeto nunca aparecia no mapa, e nada explicava por que. Quem
-- exporta do GPS Garmin (GPX, com `time`) nunca viu o defeito; quem passou pelo
-- QGIS antes, sempre.
--
-- A hora e o que ORDENA MELHOR o trajeto, e nao o que o autoriza a existir. A
-- view passa a desenhar os dois casos:
--
--   com `momento` -> ordena pela HORA, como sempre;
--   sem `momento` -> ordena pela ordem de INSERCAO (`id`), que e a ordem do
--                    arquivo, porque os pontos entram num INSERT unico na
--                    ordem em que foram lidos.
--
-- `ORDER BY p.momento NULLS LAST, p.id` faz os dois de uma vez, e num track
-- MISTO poe o trecho cronometrado na frente e o resto atras -- que e o melhor
-- que se pode afirmar sem inventar hora.
--
-- O `NaN` NO M NAO E ENFEITE, e sem ele nada disto funciona. `ST_MakePointM` e
-- STRICT: com `momento` nulo ele devolve PONTO NULO, e o agregado
-- `ST_MakeLine` PULA os nulos -- um track todo sem hora viraria uma linha de
-- zero vertices, isto e, NULL, e a mudanca do `WHERE` sozinha nao teria efeito
-- nenhum. Um zero no lugar do `NaN` seria pior que a falta: ele afirmaria
-- 1970-01-01T00:00:00Z em cada vertice, e quem lesse o M acreditaria. O `NaN`
-- diz "nao ha hora aqui", e some no `ST_Force2D` que o servidor aplica antes de
-- serializar a linha para o mapa.
--
-- O `WHERE` sobrou como guarda de geometria: `geom` e NOT NULL na tabela, e a
-- condicao existe para que uma linha sem ponto nunca chegue ao `ST_MakeLine`.
--
-- O `HAVING count(*) > 1` FICA COMO ESTAVA, e continua sendo o que impede um
-- track de um ponto so de derrubar a consulta: `ST_MakeLine` com um vertice
-- devolve um ponto, e a coluna se declara LineString. O que muda e a CONTAGEM
-- que ele avalia -- antes so os pontos com hora, agora todos --, entao um track
-- de dois pontos em que so um tem hora deixa de sumir e passa a ter linha.
--
-- SO REESCREVE A VIEW. Nao nasce coluna, nao nasce tabela, nao muda dado. Por
-- isso NAO sobe o `MIN_DATABASE_VERSION` do servico: este codigo roda inteiro
-- contra um banco 3.13.0 -- o que aquela instalacao continua nao tendo e o
-- desenho do trajeto sem hora, que e o proprio defeito corrigido aqui.
--
-- IDEMPOTENTE pelo `CREATE OR REPLACE`: reaplicar nao duplica nem falha. A
-- lista de colunas e os tipos nao mudam (track_id, momento_inicio, momento_fim,
-- pontos, geom), que e a condicao do `OR REPLACE`.

BEGIN;

CREATE OR REPLACE VIEW campo.track_linha AS
SELECT
  p.track_id,
  min(p.momento) AS momento_inicio,
  max(p.momento) AS momento_fim,
  count(*) AS pontos,
  ST_MakeLine(
    ST_SetSRID(
      ST_MakePointM(
        ST_X(p.geom), ST_Y(p.geom),
        COALESCE(extract(epoch FROM p.momento), 'NaN'::double precision)
      ),
      4674
    ) ORDER BY p.momento NULLS LAST, p.id
  )::geometry(LineStringM, 4674) AS geom
FROM campo.track_ponto p
WHERE p.geom IS NOT NULL
GROUP BY p.track_id
HAVING count(*) > 1;

COMMENT ON TABLE campo.track_ponto IS
    'Ponto do GPS. A ordem do trajeto vem de momento; sem hora, da ordem de inserção (id).';

UPDATE public.versao SET nome = '3.14.0' WHERE code = 1;

COMMIT;

-- COMO DESFAZER
--
-- Reversivel por inteiro: a view volta a definicao anterior e nenhum dado foi
-- tocado. O preco de desfazer e o defeito de volta -- o trajeto importado de
-- GeoJSON some do mapa outra vez.
--
--   BEGIN;
--   CREATE OR REPLACE VIEW campo.track_linha AS
--   SELECT
--     p.track_id,
--     min(p.momento) AS momento_inicio,
--     max(p.momento) AS momento_fim,
--     count(*) AS pontos,
--     ST_MakeLine(
--       ST_SetSRID(
--         ST_MakePointM(ST_X(p.geom), ST_Y(p.geom), extract(epoch FROM p.momento)),
--         4674
--       ) ORDER BY p.momento
--     )::geometry(LineStringM, 4674) AS geom
--   FROM campo.track_ponto p
--   WHERE p.momento IS NOT NULL
--   GROUP BY p.track_id
--   HAVING count(*) > 1;
--   COMMENT ON TABLE campo.track_ponto IS
--       'Ponto do GPS. A ordem do trajeto vem de momento, e não de uma coluna de sequência.';
--   UPDATE public.versao SET nome = '3.13.0' WHERE code = 1;
--   COMMIT;
