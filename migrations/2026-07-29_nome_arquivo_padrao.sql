-- Fonte UNICA da regra do nome fisico do arquivo.
--
-- Por que no banco e nao em JS: a regra precisa ser usada por quem ESCREVE
-- (a rota de renome, o prepare-upload) e por quem AUDITA (o invariante 7a, que
-- e SQL puro). Duas implementacoes da mesma regra divergem com o tempo, e a
-- divergencia entre auditor e escritor e justo o defeito que o 7a existe para
-- pegar. Uma funcao no schema versionado nao pode divergir de si mesma.
--
-- Padrao (docs/regras_carga_produtos.md):
--   {TIPOPROD}_s{NN}_{MI ou INOM}_{EDICAO}
--   {TIPOPROD}_s{NN}_{SLUG-DO-NOME}_{ESCALA}_{EDICAO}   sem MI e sem INOM
--
-- Devolve NULL quando nao consegue computar (rotulo de versao fora das duas
-- formas canonicas). NULL e sinal de defeito, nunca um nome improvisado: nome
-- improvisado colide em silencio, que e o que se quer impedir.

BEGIN;

-- Sem a extensao unaccent (o banco tem so plpgsql, postgis e uuid-ossp), o
-- translate resolve o portugues sem dependencia nova.
CREATE OR REPLACE FUNCTION acervo.slug_nome(p_texto text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT upper(btrim(regexp_replace(
    translate(coalesce(p_texto, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
    '[^A-Za-z0-9]+', '-', 'g'), '-'));
$$;

COMMENT ON FUNCTION acervo.slug_nome(text) IS
  'Normaliza texto para uso em nome fisico: sem acento, so [A-Z0-9-], maiusculo.';

-- Slug da edicao. Regex ANCORADA de proposito: as duas formas abaixo sao as
-- unicas que o trigger acervo.validate_version admite. Sem ancora, "1-DSG" e
-- "1-DSGE" colapsam no mesmo slug (a sigla vai de 1 a 5 letras).
CREATE OR REPLACE FUNCTION acervo.edicao_slug(p_versao text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_versao ~ '^[0-9]+ª Edição$'
      THEN 'ed' || (regexp_match(p_versao, '^([0-9]+)ª Edição$'))[1]
    WHEN p_versao ~ '^[0-9]+-[A-Z]{1,5}$'
      THEN (regexp_match(p_versao, '^([0-9]+)-([A-Z]{1,5})$'))[1]
        || lower((regexp_match(p_versao, '^([0-9]+)-([A-Z]{1,5})$'))[2])
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION acervo.edicao_slug(text) IS
  'Slug da edicao a partir do rotulo. NULL quando o rotulo foge das duas formas canonicas.';

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

COMMIT;

-- Para desfazer:
--   DROP FUNCTION IF EXISTS acervo.nome_arquivo_padrao(smallint,smallint,varchar,varchar,varchar,smallint,integer,varchar);
--   DROP FUNCTION IF EXISTS acervo.edicao_slug(text);
--   DROP FUNCTION IF EXISTS acervo.slug_nome(text);
