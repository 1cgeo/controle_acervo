-- A NOTA DE EMPENHO GANHA A IDENTIDADE QUE O SIAFI USA.
--
-- O QUE O BANCO FAZIA. `orcamento.nota_empenho` guardava `numero` e `ano`, e
-- nada mais. Nao havia unicidade nenhuma, e a tabela aceitava dois registros com
-- o mesmo numero sem reclamar. Em 2026-08-07 a producao tinha 38 registros em 32
-- numeros.
--
-- A PRIMEIRA EXPLICACAO ESTAVA ERRADA, e o registro fica porque o erro custou uma
-- proposta inteira. Eu diagnostiquei os homonimos como carga em duplicidade e
-- propus um indice unico `(ano, numero)`. Ele teria RECUSADO DADO LEGITIMO.
--
-- O QUE O SIAFI MOSTRA. A chave de um empenho e
-- `UG + GESTAO + ANO + NUMERO` (ex.: `160382000012026NE000005`). A **UG 167382 e
-- uma unidade gestora distinta da 160382**, com numeracao propria comecando do 1
-- e credito na acao 21GO. As duas tem legitimamente uma 2026NE000005, com datas,
-- ND e valores diferentes. Medido no SAG em 2026-08-07: a 167382 tem oito
-- empenhos, numerados de 000001 a 000008.
--
-- A REGRA DO BACKFILL, e ela sai do DADO, nao de uma lista. Quem empenha e a UG
-- que RECEBEU o credito, e o credito da 167382 e emitido pela UG 167035, do mesmo
-- modo que o da 160382 vem da 160035. Entao:
--
--   nota_credito.ug_emitente = '167035'  ->  a NE e da UG 167382
--   qualquer outra                       ->  a NE e da UG 160382
--
-- Conferido antes de escrever: a regra separa exatamente as oito NEs numeradas
-- 000001 a 000008 que o SAG lista na 167382, e nenhuma outra. Depois dela,
-- sobrava UM homonimo, a 2026NE000024, que era o caso legitimo de um empenho
-- coberto por tres NCs e foi fundido pelo rateio (`nota_empenho_nota_credito`).
--
-- `gestao` entra junto porque ela faz parte da chave. Hoje so existe a '00001',
-- e guardar a coluna agora evita repetir esta migracao no dia em que aparecer
-- outra.
--
-- AS COLUNAS NASCEM ANULAVEIS. O NOT NULL vem quando o servidor passar a exigi-las
-- na escrita; enquanto o Joi nao as cobra, um NOT NULL aqui recusaria a proxima
-- NE cadastrada pelo client. Ver `nota_empenho_schema.js`.

BEGIN;

ALTER TABLE orcamento.nota_empenho
  ADD COLUMN IF NOT EXISTS ug VARCHAR(10),
  ADD COLUMN IF NOT EXISTS gestao VARCHAR(5);

COMMENT ON COLUMN orcamento.nota_empenho.ug IS
    'UG que emitiu o empenho (a que recebeu o credito). Parte da chave do SIAFI, com gestao, ano e numero.';
COMMENT ON COLUMN orcamento.nota_empenho.gestao IS
    'Gestao da UG emitente. Compoe a chave do SIAFI.';

-- Backfill pela regra medida. Só toca linha ainda sem UG, para a migração poder
-- rodar duas vezes.
UPDATE orcamento.nota_empenho AS ne
   SET ug = CASE WHEN nc.ug_emitente = '167035' THEN '167382' ELSE '160382' END,
       gestao = '00001'
  FROM orcamento.nota_credito AS nc
 WHERE nc.id = ne.nota_credito_id
   AND ne.ug IS NULL;

-- Sobra alguma NE sem nota de crédito representativa? Não deveria: a FK é
-- obrigatória. O UPDATE acima já cobre todas; este segundo é a rede.
UPDATE orcamento.nota_empenho SET ug = '160382', gestao = '00001' WHERE ug IS NULL;

-- ---------------------------------------------------------------------------
-- Guarda: o índice não nasce com número repetido DENTRO da mesma UG.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  repetidos TEXT;
BEGIN
  SELECT string_agg(t.rotulo, '; ')
    INTO repetidos
    FROM (
      SELECT ug || ' ' || numero || ' (ids ' || string_agg(id::text, ', ' ORDER BY id) || ')' AS rotulo
        FROM orcamento.nota_empenho
       GROUP BY ug, gestao, ano, numero
      HAVING count(*) > 1
    ) AS t;

  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION
      'Ha nota de empenho com numero repetido na mesma UG: %. '
      'Um empenho coberto por varias NCs se representa pelo RATEIO '
      '(orcamento.nota_empenho_nota_credito), e nao por um registro por NC.',
      repetidos;
  END IF;
END $$;

-- A identidade do SIAFI, inteira. Sem a UG, dois empenhos legítimos de unidades
-- diferentes colidiriam; sem o ano, a numeração que reinicia a cada exercício
-- colidiria consigo mesma.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_nota_empenho_chave_siafi
  ON orcamento.nota_empenho (ug, gestao, ano, numero);

UPDATE public.versao SET nome = '1.39.0' WHERE code = 1;

COMMIT;

-- ---------------------------------------------------------------------------
-- COMO REVERTER
-- ---------------------------------------------------------------------------
--   1. DROP INDEX orcamento.uniq_nota_empenho_chave_siafi;
--   2. ALTER TABLE orcamento.nota_empenho DROP COLUMN ug, DROP COLUMN gestao;
--   3. UPDATE public.versao SET nome = '1.38.0' WHERE code = 1;
--   4. Reverter em nota_empenho_schema.js e no client os campos ug e gestao.
