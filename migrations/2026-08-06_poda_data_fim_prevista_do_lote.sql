-- `acervo.lote.data_fim_prevista` sai: ela virou copia de `data_fim` e perdeu o
-- unico papel que tinha.
--
-- POR QUE ELA EXISTIU. Ela nasceu na migracao de 2026-08-03 para dar o MES do
-- planejado do PIT. A promessa do lote seria a data prometida, e `data_fim` o
-- fato consumado.
--
-- POR QUE ELA DEIXOU DE SERVIR, medido em 2026-08-05 e registrado na migracao
-- daquele dia. Duas razoes, e as duas continuam valendo:
--
--   1. Ela era preenchida NO FIM, junto com o fato. Nos 19 lotes que a tem, ela
--      e igual a `data_fim`, entao o planejado da grade era copia do realizado.
--      A meta 1.3 prometia 48 folhas em agosto e a grade mostrava 49 em junho,
--      porque foi em junho que o lote acabou.
--   2. O lote e a granularidade errada. A meta 1.1 promete 4 em abril, 1 em
--      maio, 16 em julho e 3 em agosto, e uma data de lote nao expressa quatro
--      meses.
--
-- Desde entao o planejado sai de `acervo.versao.data_prevista`, uma promessa por
-- FOLHA. A coluna do lote ficou "porque a promessa do lote e um fato do lote",
-- e um comentario do DDL chegou a afirmar que a tela de projetos a mostrava.
--
-- NAO MOSTRAVA. Varredura de 2026-08-06: o identificador `data_fim_prevista` nao
-- aparece uma vez no cliente web, no `acervo_cli` nem no plugin QGIS. A aba de
-- lotes nao tem a coluna e o dialogo nao manda o campo. A API a aceitava e a
-- devolvia, e ninguem dos dois lados a usava.
--
-- ---------------------------------------------------------------------------
-- AS 19 LINHAS, LIDAS DA PRODUCAO EM 2026-08-06 ANTES DO DROP
-- ---------------------------------------------------------------------------
-- Sao 99 lotes, 19 com a coluna preenchida, e as 19 tem `data_fim_prevista`
-- EXATAMENTE IGUAL a `data_fim`. Zero divergentes, e zero lotes com promessa mas
-- sem fim. Nenhum bit se perde no DROP: os 19 valores continuam legiveis na
-- coluna `data_fim` da mesma linha.
--
-- Ficam registrados aqui assim mesmo, porque a decisao de apagar se toma uma vez
-- e o git e o arquivo.
--
--   id | pit                    | data_fim = data_fim_prevista
--   ---+------------------------+-----------------------------
--   55 | 2026-1a                | 2026-04-01
--   56 | 2026-1e                | 2026-04-01
--   57 | 2026-1f                | 2026-03-01
--   58 | 2026-1i                | 2026-01-01
--   59 | 2026-1p                | 2026-01-01
--   60 | 2026-1q                | 2026-03-01
--   67 | 2026-1o                | 2026-06-01
--   68 | 2026-1k                | 2026-05-01
--   69 | 2026-1n                | 2026-05-01
--   70 | 2026-1r                | 2026-05-01
--   71 | 2026-1l                | 2026-06-01
--   72 | 2026-1j                | 2026-06-01
--   73 | 2026-1s                | 2026-05-01
--   74 | 2026-1t                | 2026-05-01
--   75 | 2026-1c                | 2026-06-30
--   76 | 2026-1b                | 2026-06-30
--   78 | 2026-mapas-tematicos   | 2026-06-26
--   86 | 2026-extrapit-co-bento | 2026-07-01
--   87 | 2026-extrapit-coesp    | 2026-04-20
--
-- ---------------------------------------------------------------------------
--
-- O QUE SAI JUNTO. O `DROP COLUMN` leva consigo a restricao
-- `lote_data_fim_prevista_check`, unica do catalogo que cita a coluna, e o
-- COMMENT dela.
--
-- Nada mais depende dela. Consultado o catalogo da PRODUCAO em 2026-08-06:
-- 0 indices em `pg_indexes` com o nome no `indexdef`, 0 views em `pg_views`,
-- 0 views materializadas em `pg_matviews`, 0 funcoes com o nome no `prosrc` e
-- 0 gatilhos nao internos em `acervo.lote`. A unica restricao encontrada foi o
-- proprio CHECK acima.
--
-- Idempotente: DROP COLUMN IF EXISTS.

BEGIN;

ALTER TABLE acervo.lote
    DROP COLUMN IF EXISTS data_fim_prevista;

UPDATE public.versao SET nome = '1.35.0' WHERE code = 1;

COMMIT;

-- Para desfazer (a coluna volta vazia; os 19 valores se repoem a partir da
-- propria `data_fim`, que e de onde eles eram copia):
--   ALTER TABLE acervo.lote ADD COLUMN data_fim_prevista DATE;
--   ALTER TABLE acervo.lote ADD CONSTRAINT lote_data_fim_prevista_check
--     CHECK (data_fim_prevista IS NULL OR data_fim_prevista >= data_inicio);
--   UPDATE acervo.lote SET data_fim_prevista = data_fim
--     WHERE id IN (55,56,57,58,59,60,67,68,69,70,71,72,73,74,75,76,78,86,87);
--   UPDATE public.versao SET nome = '1.34.0' WHERE code = 1;
