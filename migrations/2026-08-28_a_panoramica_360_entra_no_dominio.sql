-- A PANORAMICA 360 PASSA A SER UM TIPO DE PRODUTO DO ACERVO.
--
-- POR QUE. O `ebgeo_360` guarda 35 projetos e 100.937 fotos panoramicas, hoje
-- so no disco do servico. O acervo nao tinha como nomea-las: o tipo mais
-- proximo, 12 (Insumos fotogrametricos), e insumo de outro produto, e a
-- panoramica e o produto. Sem tipo proprio, ela entraria com rotulo errado e
-- sumiria de toda contagem por tipo.
--
-- UM PRODUTO POR PROJETO, e nao por foto. O projeto e a unidade que se captura,
-- se calibra e se serve: a piramide de tiles e um arquivo por projeto
-- (`{slug}_tiles.db`), e a geometria e a envoltoria das posicoes das fotos dele.
-- Cadastrar foto a foto inflaria `acervo.produto` em 100 mil linhas que nenhuma
-- consulta do acervo pergunta.
--
-- O SUBTIPO E OBRIGATORIO, porque `acervo.versao.subtipo_produto_id` e NOT NULL.
-- O 31 nomeia a REPRESENTACAO, e nao o produto, do mesmo jeito que o 25
-- (Modelo 3D Tiles) faz para o tipo 9: hoje a panoramica existe em piramide de
-- tiles, e o `full_webp` foi podado em 2026-08-19. Se um dia voltar outra
-- representacao, ela entra como subtipo irmao sem mexer no tipo.
--
-- POR QUE MEXE EM `nome_arquivo_padrao`. O CASE dela mapeia tipo para prefixo e
-- cai num ELSE que devolve 'TP' || codigo. Sem o `WHEN 14`, todo nome derivado
-- de uma panoramica sairia 'TP14', e o invariante 7a passaria a comparar contra
-- um prefixo que ninguem escolheu. O volume do 360 e `layout_origem`, entao a
-- funcao nao manda nele hoje; ela manda no dia em que uma panoramica for parar
-- num volume comum, e e cedo demais para deixar essa armadilha armada.
--
-- POR QUE CHAMA `criar_views_materializadas`. Cada par (tipo_produto,
-- tipo_escala) tem uma view materializada com dois indices e um GRANT. Tipo novo
-- sao 6 views, uma por escala. Foi o que o `ensaiar_migracao.cjs` reprovou na
-- migracao irma de hoje, quando faltou a chamada.
--
-- IDEMPOTENTE pelo ON CONFLICT, pelo CREATE OR REPLACE e pelo IF NOT EXISTS das
-- views: reaplicar nao duplica nem falha.

BEGIN;

INSERT INTO dominio.tipo_produto (code, nome) VALUES
(14, 'Panorâmica 360')
ON CONFLICT (code) DO NOTHING;

INSERT INTO dominio.subtipo_produto (code, nome, tipo_id) VALUES
(31, 'Panorâmica 360 em pirâmide de tiles', 14)
ON CONFLICT (code) DO NOTHING;

-- Prefixo do nome fisico derivado. Unica mudanca: o `WHEN 14 THEN 'P360'`.
CREATE OR REPLACE FUNCTION acervo.nome_arquivo_padrao(
  p_tipo_produto_id     smallint,
  p_subtipo_produto_id  smallint,
  p_mi                  varchar,
  p_inom                varchar,
  p_produto_nome        varchar,
  p_tipo_escala_id      smallint,
  p_denominador         integer,
  p_versao              varchar
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  WITH partes AS (
    SELECT
      CASE p_tipo_produto_id
        WHEN 1 THEN 'CDGV'   WHEN 2 THEN 'CT'      WHEN 3 THEN 'CO'
        WHEN 4 THEN 'ORTO'   WHEN 5 THEN 'MDS'     WHEN 6 THEN 'MDT'
        WHEN 7 THEN 'TEM'    WHEN 8 THEN 'CDGVTEM' WHEN 9 THEN 'M3D'
        WHEN 10 THEN 'PC'    WHEN 11 THEN 'CDGVCO' WHEN 12 THEN 'INSUMO'
        WHEN 13 THEN 'LEVTOPO'
        WHEN 14 THEN 'P360'
        ELSE 'TP' || p_tipo_produto_id::text
      END AS tp,
      's' || lpad(p_subtipo_produto_id::text, 2, '0') AS sub,
      acervo.edicao_slug(p_versao) AS ed,
      -- COALESCE(mi, inom): o INOM identifica a folha tao bem quanto o MI, e o
      -- schema admite produto com um sem o outro.
      coalesce(nullif(btrim(p_mi), ''), nullif(btrim(p_inom), '')) AS ident,
      CASE p_tipo_escala_id
        WHEN 1 THEN '25k' WHEN 2 THEN '50k' WHEN 3 THEN '100k' WHEN 4 THEN '250k'
        ELSE coalesce('e' || p_denominador::text, 'esp')
      END AS esc
  )
  SELECT CASE
    WHEN ed IS NULL THEN NULL
    WHEN ident IS NOT NULL THEN tp || '_' || sub || '_' || acervo.slug_nome(ident) || '_' || ed
    WHEN nullif(btrim(coalesce(p_produto_nome, '')), '') IS NULL THEN NULL
    ELSE tp || '_' || sub || '_' || acervo.slug_nome(p_produto_nome) || '_' || esc || '_' || ed
  END
  FROM partes;
$$;

COMMENT ON FUNCTION acervo.nome_arquivo_padrao(smallint, smallint, varchar, varchar, varchar, smallint, integer, varchar) IS
  'Nome fisico padrao do arquivo. Fonte unica: usada pela rota de renome e pelo invariante 7a. NULL = nao computavel, o que e defeito.';

-- As 6 views materializadas do tipo novo, uma por escala, com os dois indices e
-- o GRANT de cada uma.
SELECT acervo.criar_views_materializadas();

UPDATE public.versao SET nome = '3.11.0' WHERE code = 1;

COMMIT;

-- COMO DESFAZER
--
-- So e reversivel enquanto nenhum produto usar o tipo 14. Os DELETE falham pela
-- FK se ja houver, e falhar e o certo.
--
--   BEGIN;
--   DO $$ DECLARE e RECORD; BEGIN
--     FOR e IN SELECT code FROM dominio.tipo_escala LOOP
--       EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS acervo.mv_produto_14_%s', e.code);
--     END LOOP;
--   END $$;
--   DELETE FROM dominio.subtipo_produto WHERE code = 31;
--   DELETE FROM dominio.tipo_produto WHERE code = 14;
--   -- e reponha o corpo anterior de acervo.nome_arquivo_padrao, sem o WHEN 14.
--   UPDATE public.versao SET nome = '3.10.0' WHERE code = 1;
--   COMMIT;
