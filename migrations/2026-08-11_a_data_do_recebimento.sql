-- O RECEBIMENTO DE MATERIAL PASSA A DIZER QUANDO, E NAO SO EM QUE ANO.
--
-- POR QUE. A subsecao 4.6 do RPCMTec e mensal, como todo o relatorio, e ate aqui
-- ela nao tinha como ser. `orcamento.recebimento_material` guarda `ano_referencia`
-- e mais nada de tempo: o mes existia so dentro da prosa de `situacao`
-- ("Recebidos em julho de 2026"). O gerador, sem ter o que filtrar, devolvia a
-- tabela INTEIRA do ano em toda edicao.
--
-- A CONSEQUENCIA MEDIDA, em 2026-08-11, no banco de producao: a edicao de
-- JANEIRO de 2026 listava, na 4.6, material recebido em abril, em junho e em
-- julho. Fechar aquela edicao congelaria isso dentro de um documento assinado em
-- fevereiro. As cinco linhas de 2026 e o RPCMTec de cada mes concordam sobre
-- quando cada material chegou; o banco e que nao sabia guardar.
--
-- O QUE ELA FAZ
--
--   1. Cria `data_recebimento DATE`, anulavel.
--   2. Preenche as cinco linhas de 2026 pelo mes que a propria `situacao` diz,
--      no ULTIMO DIA daquele mes.
--
-- POR QUE DATE, E NAO `mes_referencia SMALLINT` ao lado do ano. Uma data e uma
-- coluna so, compara com o `cutoff` do relatorio pelo mesmo operador que a 4.1 e
-- a 4.2 ja usam (`<= $<cutoff>`), e nao abre a porta para a combinacao invalida
-- de ano e mes preenchidos pela metade. O `ano_referencia` FICA, e continua sendo
-- quem escolhe o ANO da tabela: ele resolve o caso do item de RPNP, empenhado num
-- ano e recebido no outro, e apagar a coluna quebraria isso.
--
-- O PREENCHIMENTO E APROXIMADO, E ISSO ESTA DECLARADO. A fonte e a prosa da
-- `situacao` cruzada com a edicao do RPCMTec em que cada linha aparece pela
-- primeira vez, e nao um documento de recebimento. Por isso o dia e o ultimo do
-- mes: ele e o unico dia que a fonte sustenta, e ele nao muda de qual MES a linha
-- e, que e a unica pergunta que a 4.6 faz. Quem tiver o termo de recebimento em
-- maos deve corrigir o dia pela tela.
--
-- AS DEZ LINHAS DE 2025 FICAM NULAS, de proposito. A prosa delas nao nomeia mes
-- ("Material recebido", "aguardando TREM"), e inventar um dia para caber num
-- filtro seria pior que a lacuna. Elas nao aparecem na 4.6 de 2026 de todo jeito,
-- porque `COALESCE(ano_referencia, ne.ano)` as manda para 2025. O gerador trata
-- NULO como "sem data conhecida" e a mantem visivel, pela mesma regra que a 4.1 e
-- a 4.2 aplicam a `data_emissao` nula.

BEGIN;

ALTER TABLE orcamento.recebimento_material
  ADD COLUMN IF NOT EXISTS data_recebimento DATE;

COMMENT ON COLUMN orcamento.recebimento_material.data_recebimento IS
  'Dia em que o material chegou. Recorta a subsecao 4.6 do RPCMTec pelo mes da '
  'edicao. NULO quer dizer que o dia nao e conhecido, e a linha continua '
  'aparecendo. O ano da tabela continua saindo de ano_referencia.';

-- As cinco linhas de 2026, pelo mes que a propria situacao declara.
UPDATE orcamento.recebimento_material SET data_recebimento = DATE '2026-01-31'
 WHERE situacao ILIKE '%janeiro de 2026%' AND data_recebimento IS NULL;

UPDATE orcamento.recebimento_material SET data_recebimento = DATE '2026-04-30'
 WHERE situacao ILIKE '%abril de 2026%' AND data_recebimento IS NULL;

UPDATE orcamento.recebimento_material SET data_recebimento = DATE '2026-06-30'
 WHERE situacao ILIKE '%junho de 2026%' AND data_recebimento IS NULL;

UPDATE orcamento.recebimento_material SET data_recebimento = DATE '2026-07-31'
 WHERE situacao ILIKE '%julho de 2026%' AND data_recebimento IS NULL;

UPDATE public.versao SET nome = '3.2.0' WHERE code = 1;

COMMIT;

-- Para desfazer:
--
--   BEGIN;
--   ALTER TABLE orcamento.recebimento_material DROP COLUMN IF EXISTS data_recebimento;
--   UPDATE public.versao SET nome = '3.1.0' WHERE code = 1;
--   COMMIT;
--
-- O DESFAZER DEVOLVE O DEFEITO, e nao so a coluna: sem ela o gerador da 4.6 volta
-- a nao ter o que filtrar, e toda edicao mensal volta a listar o ano inteiro. Se
-- alguma edicao tiver sido FECHADA nesse meio tempo, o congelado dela nao muda --
-- e essa e a unica parte que o desfazer nao alcanca.
--
-- O DESFAZER EXIGE VOLTAR O CODIGO JUNTO: `VERSION` e `MIN_DATABASE_VERSION` de
-- server/src/config.js, o INSERT de er/versao.sql, a coluna em er/orcamento.sql e
-- o recorte de `gerarRecebimentoMaterial` em
-- server/src/rpcmtec/rpcmtec_ctrl.js voltam ao estado anterior.
