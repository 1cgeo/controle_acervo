-- A NOTA DE CREDITO CHEGA AO PIT PELO ITEM DO PDR, E NAO POR FORA DELE.
--
-- A DECISAO, na palavra do chefe da DGEO: "nota_credito na verdade deve estar
-- apontado a pdr_item e nao a pit, e o pdr_item aponta o pit. Em orcamento a
-- ligacao com o PIT e o PDR."
--
-- O QUE O BANCO FAZIA. `orcamento.nota_credito` tinha DUAS declaracoes sobre o
-- mesmo assunto: `pdr_item_id`, que diz qual item do PDR aquele credito executa,
-- e `meta_pit_id`, que dizia qual meta ele financia. As duas eram independentes,
-- e nada obrigava a segunda a concordar com a primeira.
--
-- ELAS DISCORDAVAM, E FOI MEDIDO EM PRODUCAO (2026-08-06, em transacao somente
-- leitura, com as migracoes 1.27.0 a 1.30.0 aplicadas na propria transacao). Das
-- 95 NCs cadastradas, 29 tinham os dois campos preenchidos. Em 25 delas a meta
-- batia com a do item; em 4 nao batia:
--
--   NC             ND       a NC dizia   o item do PDR diz
--   2026NC400706   449040   Meta 1       Meta 3 (item 28, softwares)
--   2026NC401276   339039   Meta 1       nenhuma (item 14, manut. de TIC)
--   2026NC400412   339039   Meta 4       nenhuma (item 16, Correios)
--   2026NC401277   339039   Meta 4       nenhuma (item 16, Correios)
--
-- Nenhuma tela acusava. A grade do PIT somava `credito_nc` pela coluna da NC, e
-- por isso creditava R$ 129.484,00 a metas que o PDR nao financiou.
--
-- `orcamento.pdr_item.meta_pit_id` FICA APONTANDO `pit.meta`, o GRUPO, e a
-- medicao decide isso pela CONTAGEM. Se o item do PDR fosse um recorte do
-- trabalho, ele nunca poderia haver mais itens de PDR do que itens de PIT dentro
-- da mesma meta. Ha:
--
--   meta de 2026                          itens do PDR   itens do PIT
--   1 Producao de Geoinformacao                      5             11
--   3 Producao de Geoinformacao (EBGeo)              6              2
--   4 Servico de Impressao                           1              3
--   5 Servicos de Capacitacao                        5              3
--
-- Nas metas 3 e 5 os itens do PDR SOBRAM. O que eles recortam e a natureza da
-- despesa, e nao o trabalho: a Meta 1 tem uma linha de diarias (339015), uma de
-- passagens (339033), duas de viatura (339039) e uma de pecas (339030). A
-- descricao gravada confirma na letra, porque ela e o nome do GRUPO mais a
-- despesa: 'Producao de Geoinformacao (diarias)', 'Capacitacao em Geoinformacao
-- (passagens)'. Qual dos 11 itens da Meta 1 a diaria financiou nao esta no
-- documento assinado, e por isso nao vai para o banco.
--
-- O QUE ESTA MIGRACAO FAZ COM O DADO GRAVADO. Ela nao traduz meta em item: onde
-- a correspondencia nao e unica e defensavel, ela deixa NULO e conta.
--
--   * 29 NCs ja tem `pdr_item_id` (todas de 2026). Nada a fazer: a meta delas
--     passa a ser lida pelo item, e as 4 divergentes passam a dizer a verdade do
--     PDR em vez da segunda opiniao que alguem digitou.
--   * 17 NCs de 2025, classificacao PDR, tem meta e nao tem item. O PDR de 2025
--     tem 8 itens, UM POR NATUREZA DE DESPESA, e cada uma dessas 17 casa com
--     EXATAMENTE UM deles pela ND do ano. E correspondencia unica, e a migracao
--     a grava. Em 2026 esse casamento nao serviria (a ND 339039 sozinha tem 9
--     itens), e por isso a regra e "so quando houver exatamente um", e nunca "o
--     primeiro que aparecer".
--   * 4 NCs de 2025 tem meta e sao Extra-PDR (classificacao 2). Elas FICAM SEM
--     item, por regra de negocio: Extra-PDR e, por definicao, o credito que o PDR
--     nao previu. Sao a 2025NC400441, a 2025NC400442, a 2025NC400432 e a
--     2025NC400448, todas apontando a Meta 2 (MGCP), R$ 36.841,00 no total.
--   * As 45 NCs restantes nao tinham meta nenhuma e nao perdem nada.
--
-- O QUE SE PERDE, E E PRECISO DIZER. Os 8 itens do PDR de 2025 tem
-- `meta_pit_id` NULO: o PDR daquele ano foi transcrito sem vinculo com o PIT.
-- Entao as 17 NCs que ganham item continuam sem meta, e as metas de 2025 passam
-- a mostrar credito zero, onde hoje mostram R$ 195.101,00. Esse numero nao
-- desapareceu do banco: ele deixa de ser afirmado por um caminho que o PDR de
-- 2025 nao sustenta. Para trazer os valores de volta basta preencher a meta dos
-- 8 itens do PDR de 2025, o que e trabalho de cadastro, e nao de migracao.
-- Promove-la aqui seria invencao: o item 29 (ND 339015, diarias) e apontado por
-- NCs que reivindicam as metas 1, 3 E 5, entao nao ha uma meta para promover.
--
-- IDEMPOTENTE. O transporte de dados so acha algo para fazer enquanto
-- `meta_pit_id` existir, e o DROP dela e o ultimo passo do bloco. Na segunda
-- rodada o ramo nao executa e o plpgsql nao analisa nada la dentro.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A COLUNA DO ELO. Ela ja existe desde a fusao do orcamento (1.0.0); o
-- IF NOT EXISTS esta aqui para a migracao valer sozinha, e nao por duvida.
-- ---------------------------------------------------------------------------
ALTER TABLE orcamento.nota_credito
  ADD COLUMN IF NOT EXISTS pdr_item_id BIGINT REFERENCES orcamento.pdr_item (id);

COMMENT ON COLUMN orcamento.nota_credito.pdr_item_id IS
    'O item do PDR que este crédito executa, e o único caminho da NC até a meta do PIT. Nulo é honesto: a NC Extra-PDR não tem item por definição.';

-- ---------------------------------------------------------------------------
-- 2. O TRANSPORTE, E A CONTA DO QUE FICOU DE FORA.
--
-- Guardado por "a coluna `meta_pit_id` ainda existe em orcamento.nota_credito".
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo        INTEGER;
  casadas     INTEGER;
  ambiguas    INTEGER;
  sem_item    INTEGER;
  extra_pdr   INTEGER;
  ano_errado  INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'orcamento' AND table_name = 'nota_credito'
      AND column_name = 'meta_pit_id'
  ) THEN
    RAISE NOTICE 'orcamento.nota_credito.meta_pit_id ja foi removida: transporte ja aplicado.';
    RETURN;
  END IF;

  -- 2.1 QUANTAS ESTAO EM JOGO: as que declaram meta, nao declaram item, e sao da
  -- classificacao que admite item.
  SELECT count(*) INTO alvo
  FROM orcamento.nota_credito
  WHERE meta_pit_id IS NOT NULL AND pdr_item_id IS NULL AND classificacao_id = 1;

  -- 2.2 AS QUE SAO EXTRA-PDR E TEM META. Ficam sem item, e a conta sai no log
  -- para nao passarem em silencio: elas PERDEM o vinculo com o PIT.
  SELECT count(*) INTO extra_pdr
  FROM orcamento.nota_credito
  WHERE meta_pit_id IS NOT NULL AND classificacao_id <> 1;

  -- 2.3 O CASAMENTO, SO QUANDO HOUVER EXATAMENTE UM CANDIDATO.
  --
  -- A chave e (ano, natureza de despesa). O HAVING count(*) = 1 e o coracao
  -- desta migracao: sem ele, o `min(id)` sortearia um item entre varios e
  -- gravaria numero plausivel e falso. Com ele, um ano cujo PDR detalha a mesma
  -- ND em varias linhas (2026 tem 9 linhas de 339039) simplesmente nao casa
  -- nada, que e a resposta certa.
  WITH candidato AS (
    SELECT n.id AS nc_id, min(pi.id) AS item_id
    FROM orcamento.nota_credito n
    INNER JOIN orcamento.pdr_item pi
      ON pi.ano = n.ano AND pi.cod_nd = n.cod_nd
    WHERE n.meta_pit_id IS NOT NULL
      AND n.pdr_item_id IS NULL
      AND n.classificacao_id = 1
    GROUP BY n.id
    HAVING count(pi.id) = 1
  )
  UPDATE orcamento.nota_credito nc
  SET pdr_item_id = c.item_id
  FROM candidato c
  WHERE nc.id = c.nc_id;

  GET DIAGNOSTICS casadas = ROW_COUNT;

  SELECT count(*) INTO ambiguas
  FROM orcamento.nota_credito
  WHERE meta_pit_id IS NOT NULL AND pdr_item_id IS NULL AND classificacao_id = 1;

  RAISE NOTICE 'NCs com meta e sem item, classificacao PDR: % alvo, % casadas, % sem candidato unico.',
    alvo, casadas, ambiguas;
  RAISE NOTICE 'NCs com meta e classificacao Extra-PDR: % ficam sem item, por regra de negocio.', extra_pdr;

  -- 2.4 A CONFERENCIA QUE PODE REPROVAR. Uma NC nunca pode apontar item de outro
  -- ano: o credito de 2025 nao executa a previsao de 2026. A FK nao cobre isso,
  -- porque ela so olha o id.
  SELECT count(*) INTO ano_errado
  FROM orcamento.nota_credito nc
  INNER JOIN orcamento.pdr_item pi ON pi.id = nc.pdr_item_id
  WHERE pi.ano <> nc.ano;
  IF ano_errado > 0 THEN
    RAISE EXCEPTION
      '% nota(s) de credito apontam item de PDR de outro ano. A migracao para aqui.', ano_errado;
  END IF;

  -- 2.5 O TOTAL QUE SEGUE SEM ITEM, de todas as causas. So para o log.
  SELECT count(*) INTO sem_item FROM orcamento.nota_credito WHERE pdr_item_id IS NULL;
  RAISE NOTICE '% de % nota(s) de credito seguem sem item do PDR.',
    sem_item, (SELECT count(*) FROM orcamento.nota_credito);

  -- 2.6 A SEGUNDA DECLARACAO SAI.
  --
  -- Sem CASCADE, de proposito: se alguma view ou restricao ainda ler esta
  -- coluna, o comando falha e a migracao inteira volta atras. Falhar alto custa
  -- menos do que derrubar em silencio um objeto que ninguem sabia que existia.
  ALTER TABLE orcamento.nota_credito DROP COLUMN meta_pit_id;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O INDICE DO CAMINHO NOVO.
--
-- A grade do PIT soma `credito_nc` juntando nota_credito -> pdr_item -> pit.meta,
-- uma vez por meta na tela. Sem indice, cada uma varre a tabela inteira.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_nota_credito_pdr_item
  ON orcamento.nota_credito (pdr_item_id);

-- ---------------------------------------------------------------------------
-- 4. O COMENTARIO DO ELO QUE FICA.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN orcamento.pdr_item.meta_pit_id IS
    'A meta do PIT (o GRUPO) que este item do PDR financia. É o único elo entre o orçamento e o PIT: a nota de crédito chega à meta por aqui.';

UPDATE public.versao SET nome = '1.31.0' WHERE code = 1;

COMMIT;

-- Para desfazer. A migracao NAO e reversivel sem perda: `meta_pit_id` guardava a
-- meta que alguem digitou na NC, e as 4 divergencias e as 4 Extra-PDR de 2025 so
-- voltam do backup. O caminho, na ordem:
--   1. ALTER TABLE orcamento.nota_credito
--        ADD COLUMN meta_pit_id BIGINT REFERENCES pit.meta (id);
--   2. UPDATE orcamento.nota_credito nc
--        SET meta_pit_id = pi.meta_pit_id
--        FROM orcamento.pdr_item pi
--        WHERE pi.id = nc.pdr_item_id;
--      (Isto recompoe a meta COERENTE com o PDR, e nao a que estava gravada.)
--   3. Restaurar do backup as NCs cuja meta divergia do item, e as Extra-PDR.
--   4. DROP INDEX IF EXISTS orcamento.idx_nota_credito_pdr_item;
--      (Opcional: o indice nao atrapalha o desenho antigo.)
--   5. Reverter em server/src/pit/pit_ctrl.js a soma de `credito_nc` para
--      `nc.meta_pit_id`, e em server/src/orcamento/dashboard/dashboard_ctrl.js a
--      pendencia `nc_sem_pdr_item` para `nc_sem_meta`.
--   6. UPDATE public.versao SET nome = '1.30.0' WHERE code = 1;
