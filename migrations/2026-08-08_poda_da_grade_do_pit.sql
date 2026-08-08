-- A PODA DA GRADE DO PIT: duas colunas que nunca guardaram nada, e dezenove
-- lancamentos que nao se leem mais mas ressuscitariam.
--
-- Decisao do chefe em 2026-08-08, depois de medir contra o banco de producao
-- restaurado (109 celulas de execucao, 42 itens, 144 eventos de auditoria em
-- `pit.execucao`). Sao DOIS cortes, e cada um tem numero atras.
--
-- 1. `pit.execucao.data_conclusao` e `pit.execucao.observacao` SAEM.
--
--    Sao as UNICAS 2 colunas das 88 do schema `pit` nulas em 100% das linhas:
--    0 de 109, nas duas. ZERO eventos de auditoria em 144, ou seja, elas nao
--    aparecem uma vez sequer em `campos_alterados`. Nenhuma mensagem de commit
--    jamais as justificou: nasceram no CREATE TABLE original e a unica
--    justificativa escrita era um comentario de duas linhas em `er/pit.sql`
--    para a `data_conclusao` -- a `observacao` nunca teve racional em lugar
--    nenhum.
--
--    O CRITERIO E O DO PROPRIO CHEFE, e ja esta escrito em `docs/decisoes.md`:
--    as colunas `Situacao` e `Pronto` da planilha EXEC_PIT ficaram de fora
--    porque estavam vazias no arquivo, e "nao se inventa campo sem saber o que
--    ele guarda". Estas duas sao exatamente esse erro, cometido no mesmo mes e
--    nao pego na hora.
--
--    O QUE ELAS PROMETIAM: registrar que uma meta se cumpriu num ato so, numa
--    data, e uma nota livre por celula. As metas 6 (Programa Memoria) e 7 (TI)
--    sao justamente as de marco, e MESMO ELAS lancam por quantidade.
--
--    UM BECO SEM SAIDA MORRE JUNTO. As duas entravam no CHECK
--    `execucao_diz_alguma_coisa`, que decide se a linha diz alguma coisa. Uma
--    linha que so as tivesse NAO PODIA ser apagada pela tela, que so sabe mandar
--    `planejada` e `realizada`: a limpeza deixava a linha viva e invisivel. O
--    CHECK passa de quatro termos para dois.
--
--    A DISTINCAO NULO-VERSUS-ZERO DE `quantidade` E `quantidade_planejada`
--    FICA, e a medicao diz que ela nunca foi exercida (zero zeros em 109
--    celulas). Ela fica porque a tela ja a expoe ("· ninguem lancou | 0
--    conferido, nao houve"), porque manter custa nada (as colunas ja sao
--    anulaveis) e porque o zero e o que se digita ao FECHAR um mes sem entrega
--    -- e nenhum mes foi fechado por esta ferramenta ainda. Com NOT NULL,
--    planejar agosto gravaria um realizado zero e a 2.1 afirmaria que se
--    conferiu e nao houve entrega.
--
-- 2. AS 19 LINHAS DE `pit.execucao` EM ITEM DE ORIGEM CALCULADA SAEM.
--
--    Dado morto, e nao schema. Sete itens automaticos carregam lancamento
--    manual, todo ele de 2026-08-03, medido na producao:
--
--      item 1.3 (Producao)     6 linhas
--      item 4.1 (Impressao)    8 linhas
--      itens 1.4, 1.8 (Producao), 4.2, 4.3 (Impressao), 5.1 (Capacitacao)
--                              1 linha cada
--      ------------------------------------
--      TOTAL                  19 linhas, de 109
--
--    Elas entraram ANTES de o item virar automatico (a troca de `origem_id`
--    esta auditada em 2026-08-03 15:16, 15:49 e 2026-08-07 17:36) e hoje sao
--    INVISIVEIS: a CTE `celula` do servidor escolhe o valor CALCULADO quando a
--    origem e 2, 3 ou 4, e nunca olha a linha gravada. O servidor tambem ja
--    recusa escrita nova ali, com 400.
--
--    O QUE SE PERDE: nada que alguem leia hoje. O QUE SE GANHA: a armadilha
--    some. No dia em que um item voltar a ser Manual -- e voltar e um clique na
--    tela de metas --, esses 19 lancamentos REAPARECEM na grade como se alguem
--    os tivesse lancado, com numeros de agosto de 2026 e sem nada acusando.
--
--    A CONTAGEM E CONFERIDA NA HORA DE APLICAR, e nao confiada a medicao de
--    ontem: o bloco abaixo conta antes de apagar e AVISA quantas achou. Se um
--    lancamento novo tiver entrado em item calculado entre a medicao e a
--    aplicacao, ele nao existe -- o servidor o recusa --, mas a contagem sai no
--    NOTICE de qualquer modo.
--
--    REVERSIVEL PELO PROPRIO RASTRO, e por isso este e o unico passo que
--    escreve em `auditoria.evento`: cada linha apagada vira um evento 'D' com o
--    `dados_antes` inteiro, com `origem = 'migracao'` e `usuario_uuid` nulo
--    (que e como o schema descreve o evento de migracao). Desfazer e ler o
--    JSON de volta. Sem isso, 19 linhas de dado de producao sumiriam sem deixar
--    onde procura-las.
--
--    A ORDEM IMPORTA: o DELETE roda ANTES do DROP COLUMN, para o `to_jsonb` da
--    linha guardar o registro COMPLETO como ele era.
--
-- VERSAO: 1.44.0, e ESTA MIGRACAO NAO SOBE O PISO. Pela regra do README o piso
-- (MIN_DATABASE_VERSION, em server/src/config.js) so sobe quando a migracao
-- ACRESCENTA schema, tabela ou coluna que o codigo passa a LER, ou quando ela
-- REMOVE o que o codigo ainda le. Aqui nada nasce, e o codigo desta versao
-- PAROU de ler as duas colunas antes de elas cairem: um banco que ainda as tenha
-- continua servindo o servidor inteiro. A unica diferenca la e que o CHECK
-- antigo, de quatro termos, aceitaria uma linha que o novo recusa -- e ninguem
-- tem como criar essa linha, porque o Joi desta versao nao oferece mais os dois
-- campos.
--
-- O piso que estiver em `config.js` e o da migracao 1.43.0 (a poda do orcamento,
-- que REMOVE coluna que o codigo lia), e esta aqui nao mexe nele.
--
-- IDEMPOTENTE. Os dois DROP COLUMN sao `IF EXISTS`; o DELETE nao acha nada na
-- segunda rodada (o servidor nao deixa criar lancamento em item calculado),
-- entao nenhum evento novo e escrito; o CHECK e recriado por DROP + ADD.
--
-- FORA DO BANCO, na mesma versao: as duas colunas sairam de
-- `server/src/pit/pit_schema.js` (e com ele do contrato vivo que os CLIs leem),
-- da CTE `celula`, da grade, do `listarDaMeta`, do merge de `salvar` e de
-- `server/src/auditoria/mapa/plataforma.js`. Os eventos ANTIGOS que citam as
-- duas continuam em `auditoria.evento` -- aquele schema nao tem DELETE -- e
-- passam a ser exibidos pelo proprio nome de coluna, sem apelido.

BEGIN;

-- 2 -------------------------------------------------------------------------
-- Primeiro o DADO, depois o SCHEMA: o rastro precisa da linha inteira.

DO $$
DECLARE
  v_mortas INTEGER;
BEGIN
  -- `origem_id <> 1` e "tudo o que nao e Manual" em `dominio.origem_meta`
  -- (1 Manual, 2 Capacitacao, 3 Producao, 4 Impressao). Escrito pela NEGATIVA
  -- de proposito: a origem calculada que entrar depois desta migracao ja nasce
  -- coberta, e a lista positiva (2, 3, 4) envelheceria em silencio.
  SELECT count(*) INTO v_mortas
    FROM pit.execucao AS e
    INNER JOIN pit.meta_item AS mi ON mi.id = e.meta_id
   WHERE mi.origem_id <> 1;

  RAISE NOTICE 'Lançamentos manuais em item de origem calculada: %', v_mortas;

  -- O rastro ANTES do DELETE. `entidade = 'meta'` e `entidade_id = meta_id`
  -- porque o lancamento mensal nao e agregado proprio: ele e da meta, e e na
  -- ficha dela que se le (ver server/src/auditoria/mapa/plataforma.js).
  INSERT INTO auditoria.evento
    (modulo, entidade, entidade_id, tabela, registro_id, operacao,
     dados_antes, usuario_uuid, origem, motivo)
  SELECT 'plataforma', 'meta', e.meta_id::text, 'pit.execucao', e.id::text, 'D',
         to_jsonb(e), NULL, 'migracao',
         'Poda 1.44.0: lançamento manual em item de origem calculada, que a ' ||
         'grade não lê e que reapareceria se o item voltasse a ser Manual.'
    FROM pit.execucao AS e
    INNER JOIN pit.meta_item AS mi ON mi.id = e.meta_id
   WHERE mi.origem_id <> 1;

  DELETE FROM pit.execucao AS e
   USING pit.meta_item AS mi
   WHERE mi.id = e.meta_id AND mi.origem_id <> 1;
END $$;

-- 1 -------------------------------------------------------------------------
-- As duas colunas que nunca guardaram nada, e o CHECK que encolhe com elas.
--
-- O CHECK cai por dependencia junto com a primeira coluna do DROP, entao ele e
-- recriado depois em vez de alterado antes.

ALTER TABLE pit.execucao DROP COLUMN IF EXISTS data_conclusao;
ALTER TABLE pit.execucao DROP COLUMN IF EXISTS observacao;

ALTER TABLE pit.execucao DROP CONSTRAINT IF EXISTS execucao_diz_alguma_coisa;
ALTER TABLE pit.execucao ADD CONSTRAINT execucao_diz_alguma_coisa CHECK (
  quantidade_planejada IS NOT NULL
  OR quantidade IS NOT NULL
);

COMMENT ON TABLE pit.execucao IS
    'O mês de um item do PIT: o que ele planejou entregar e o que entregou. Uma linha por (item, mês); o ano vem da meta do item.';

UPDATE public.versao SET nome = '1.44.0' WHERE code = 1;

COMMIT;

-- Para desfazer. As colunas voltam VAZIAS, e e o que elas sempre foram: 0 de
-- 109 linhas em producao. Os 19 lancamentos voltam do proprio rastro, que e
-- append-only e por isso continua la depois desta migracao:
--   ALTER TABLE pit.execucao ADD COLUMN data_conclusao DATE;
--   ALTER TABLE pit.execucao ADD COLUMN observacao TEXT;
--   ALTER TABLE pit.execucao DROP CONSTRAINT execucao_diz_alguma_coisa;
--   ALTER TABLE pit.execucao ADD CONSTRAINT execucao_diz_alguma_coisa CHECK (
--     quantidade_planejada IS NOT NULL OR quantidade IS NOT NULL
--     OR data_conclusao IS NOT NULL OR observacao IS NOT NULL);
--   INSERT INTO pit.execucao
--     (id, meta_id, mes, quantidade_planejada, quantidade, data_conclusao,
--      observacao, data_cadastramento, usuario_cadastramento_uuid,
--      data_modificacao, usuario_modificacao_uuid)
--   SELECT (dados_antes->>'id')::bigint, (dados_antes->>'meta_id')::bigint,
--          (dados_antes->>'mes')::smallint,
--          (dados_antes->>'quantidade_planejada')::int,
--          (dados_antes->>'quantidade')::int,
--          (dados_antes->>'data_conclusao')::date,
--          dados_antes->>'observacao',
--          (dados_antes->>'data_cadastramento')::timestamptz,
--          (dados_antes->>'usuario_cadastramento_uuid')::uuid,
--          (dados_antes->>'data_modificacao')::timestamptz,
--          (dados_antes->>'usuario_modificacao_uuid')::uuid
--     FROM auditoria.evento
--    WHERE tabela = 'pit.execucao' AND operacao = 'D' AND origem = 'migracao'
--      AND motivo LIKE 'Poda 1.44.0:%';
--   SELECT setval('pit.execucao_id_seq', (SELECT max(id) FROM pit.execucao));
--   UPDATE public.versao SET nome = '1.43.0' WHERE code = 1;
