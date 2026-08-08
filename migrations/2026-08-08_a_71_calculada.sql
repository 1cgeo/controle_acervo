-- A 7.1 DO RPCMTec DEIXA DE SER DIGITADA, e o que ja foi digitado nela sai do
-- banco -- com rastro.
--
-- ESTA MIGRACAO NAO MUDA SCHEMA NENHUM. Ela apaga DADO que virou orfao, e mais
-- nada. Quem virou a subsecao foi o codigo: em `rpcmtec_estrutura.js` a 7.1
-- passou a `origem: ORIGEM.CALCULADA` e a `modulo: 'equipamento'`, e
-- `rpcmtec_ctrl.js` ganhou `montarEquipamentoIndisponivel`, que le
-- `equipamento.indisponibilidade` (criada na 1.46.0).
--
-- ---------------------------------------------------------------------------
-- 1. POR QUE APAGAR, E NAO DEIXAR
-- ---------------------------------------------------------------------------
--
-- Porque o gravado deixa de ser lido, mas NAO deixa de existir, e a diferenca
-- entre as duas coisas custa caro em tres tempos:
--
--   EDICAO ABERTA. `rpcmtec_edicao_ctrl.montar` toma o ramo CALCULADA e NUNCA
--   consulta a linha gravada. As 12 linhas de julho/2026 ficam la, invisiveis,
--   dizendo uma coisa enquanto a tela mostra outra.
--
--   NO FECHAMENTO. O `INSERT ... ON CONFLICT (edicao_id, numero) DO UPDATE` de
--   `fechar` sobrescreve a linha inteira -- `linhas`, `origem_id`,
--   `sem_ocorrencia` -- SEM RASTRO PROPRIO, porque o fechamento nao audita por
--   subsecao: ele grava um evento da EDICAO. O que o gestor digitou some sem
--   uma linha em `auditoria.evento` dizendo que sumiu.
--
--   NA REABERTURA. O `DELETE FROM rpcmtec.subsecao WHERE origem_id <> DIGITADA`
--   de `reabrir` apaga de vez o que o fechamento tinha acabado de reescrever
--   como calculado.
--
-- NAO E HIPOTESE: e o que esta acontecendo com as celulas da 2.2 e da 2.4 desde
-- 2026-08-05, quando aquelas duas viraram calculadas e o digitado delas ficou
-- para tras. Elas saem no mesmo passo, pelo mesmo mecanismo e com o mesmo
-- evento, porque e o mesmo defeito com tres dias a mais.
--
-- ---------------------------------------------------------------------------
-- 2. O QUE SAI, E O QUE FICA
-- ---------------------------------------------------------------------------
--
-- SAI: linha de `rpcmtec.subsecao` com `origem_id = 2` (Digitada) nas subsecoes
-- '2.2', '2.4' e '7.1', em edicao ABERTA.
--
-- Medido na producao restaurada em 2026-08-08:
--
--   7.1  julho/2026            12 linhas de tabela, numa linha de subsecao
--   7.1  janeiro a junho/2026  6 marcacoes `sem_ocorrencia`, uma por mes
--   2.2                        8 celulas orfas
--   2.4                        195 celulas orfas
--   ------------------------------------------------------------------
--        2.2 + 2.4             203 celulas, orfas desde 2026-08-05
--
-- FICA, E ISSO E O PONTO: a edicao FECHADA. O filtro tem DUAS condicoes, e as
-- duas guardam a mesma coisa por caminhos diferentes:
--
--   `e.data_fechamento IS NULL`  a edicao assinada nao se toca. Ela e o que o
--                                chefe assinou, e o congelado tem de dizer o
--                                que o PDF diz.
--   `s.origem_id = 2`            so o que foi DIGITADO. A linha congelada de uma
--                                subsecao calculada tem `origem_id = 1`, gravado
--                                pelo fechamento, e nunca casa com este filtro.
--
-- E POR ISSO QUE `origem_id` E COLUNA DA LINHA, e nao consulta a
-- `rpcmtec_estrutura.js` na hora de ler: uma subsecao pode GRADUAR de digitada
-- para calculada, e a edicao fechada antes continua sendo o que foi. O schema
-- previu esta migracao; ela so exerce o que ele ja permitia.
--
-- ---------------------------------------------------------------------------
-- 3. O RASTRO
-- ---------------------------------------------------------------------------
--
-- Cada linha apagada vira um evento 'D' em `auditoria.evento`, com `dados_antes`
-- INTEIRO (`to_jsonb` da linha), `origem = 'migracao'` e `usuario_uuid` nulo,
-- que e como o schema descreve o evento de migracao. Desfazer e ler o JSON de
-- volta (o SQL esta no fim deste arquivo).
--
-- O PRECEDENTE E A PODA DA GRADE DO PIT (1.44.0), e a regra e a mesma: DELETE de
-- migracao e o unico passo que escreve em `auditoria.evento`. Sem isso, dado de
-- producao sumiria sem deixar onde procura-lo.
--
-- `modulo = 'plataforma'` e `entidade = 'edicao'` com `entidade_id = edicao_id`,
-- porque e assim que `server/src/auditoria/mapa/plataforma.js` mapeia
-- `rpcmtec.subsecao`: o evento e do BLOCO, e a ficha em que ele se le e a da
-- EDICAO.
--
-- ---------------------------------------------------------------------------
-- 4. VERSAO E PISO
-- ---------------------------------------------------------------------------
--
-- VERSAO: 1.47.0, sobre a 1.46.0 (o modulo `equipamento`).
--
-- ESTA MIGRACAO NAO SOBE O PISO (`MIN_DATABASE_VERSION`, em
-- `server/src/config.js`). Pela regra do README o piso so sobe quando a migracao
-- ACRESCENTA schema, tabela ou coluna que o codigo passa a LER, ou quando ela
-- REMOVE o que o codigo ainda le. Aqui nada nasce, e o que sai o codigo desta
-- versao ja nao le. O piso desta versao e 1.46.0, e quem o carimba e a migracao
-- que criou `equipamento.indisponibilidade` -- e ELA que a 7.1 calculada precisa
-- ter no banco para nao quebrar.
--
-- ---------------------------------------------------------------------------
-- 5. IDEMPOTENTE E SEGURA
-- ---------------------------------------------------------------------------
--
-- Ela CONTA antes de apagar e AVISA quanto achou, por subsecao, e NAO FALHA se
-- nao achar nada: outro ambiente pode nunca ter tido estas linhas. Na segunda
-- rodada o SELECT nao acha nada, nenhum evento novo e escrito e nenhum DELETE
-- toca linha nenhuma.
--
-- Ela tambem nao pode ressuscitar o problema: o servidor desta versao recusa com
-- 400 gravar em subsecao calculada (`rpcmtec_subsecao_ctrl.conferirAlvo`), entao
-- linha nova com `origem_id = 2` nesses tres numeros nao tem por onde nascer.
--
-- ---------------------------------------------------------------------------
-- 6. O QUE MUDA NO RELATORIO, E E O COMPORTAMENTO CERTO
-- ---------------------------------------------------------------------------
--
-- De janeiro a junho de 2026 a 7.1 deixa de sair "sem ocorrencia" e passa a
-- listar de dez a doze equipamentos. As 6 marcacoes de `sem_ocorrencia`
-- afirmavam que nao havia equipamento parado naqueles meses, e havia: as
-- indisponibilidades da planilha do DMT comecam em 2019 e nenhuma delas tinha
-- data de fim. O relatorio dizia "nao houve" onde o certo era "ninguem
-- transcreveu".
--
-- O RECORTE DA CONSULTA E O ULTIMO DIA DO MES, e ele DIVERGE do da 6.1, que
-- recorta por qualquer dia. A divergencia e deliberada e esta registrada em
-- `docs/decisoes.md` e no comentario da consulta em `rpcmtec_ctrl.js`.

BEGIN;

-- ---------------------------------------------------------------------------
-- O digitado que virou orfao: conta, audita e apaga, nesta ordem.
--
-- A ORDEM IMPORTA: o INSERT do rastro roda ANTES do DELETE, para o `to_jsonb`
-- guardar a linha COMPLETA como ela era.
--
-- `origem_id = 2` e Digitada, em `dominio.origem_subsecao` (1 Calculada,
-- 2 Digitada, 3 Fixa). Escrito pela POSITIVA, ao contrario da poda da grade do
-- PIT, e de proposito: aqui o alvo e exatamente o que foi digitado a mao, e a
-- linha congelada de uma calculada (`origem_id = 1`, gravada pelo fechamento)
-- tem de FICAR.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_numero        TEXT;
  v_registros     INTEGER;
  v_linhas_tabela INTEGER;
  v_vazias        INTEGER;
  v_total         INTEGER;
BEGIN
  FOREACH v_numero IN ARRAY ARRAY['2.2', '2.4', '7.1'] LOOP
    SELECT count(*),
           COALESCE(SUM(jsonb_array_length(COALESCE(s.linhas, '[]'::jsonb))), 0),
           count(*) FILTER (WHERE s.sem_ocorrencia)
      INTO v_registros, v_linhas_tabela, v_vazias
      FROM rpcmtec.subsecao AS s
      INNER JOIN rpcmtec.edicao AS e ON e.id = s.edicao_id
     WHERE e.data_fechamento IS NULL
       AND s.origem_id = 2
       AND s.numero = v_numero;

    RAISE NOTICE
      'Subseção % em edição aberta: % registro(s) em rpcmtec.subsecao, % linha(s) de tabela gravada(s), % marcação(ões) de sem ocorrência.',
      v_numero, v_registros, v_linhas_tabela, v_vazias;
  END LOOP;

  -- O RASTRO, ANTES DO DELETE.
  INSERT INTO auditoria.evento
    (modulo, entidade, entidade_id, tabela, registro_id, operacao,
     dados_antes, usuario_uuid, origem, motivo)
  SELECT 'plataforma', 'edicao', s.edicao_id::text, 'rpcmtec.subsecao',
         s.id::text, 'D', to_jsonb(s), NULL, 'migracao',
         'Virada 1.47.0: conteúdo digitado na subseção ' || s.numero ||
         ', que passou a ser CALCULADA. A edição aberta monta a subseção do ' ||
         'banco e nunca lê esta linha; o fechamento a sobrescreveria sem ' ||
         'rastro próprio, e a reabertura a apagaria de vez.'
    FROM rpcmtec.subsecao AS s
    INNER JOIN rpcmtec.edicao AS e ON e.id = s.edicao_id
   WHERE e.data_fechamento IS NULL
     AND s.origem_id = 2
     AND s.numero IN ('2.2', '2.4', '7.1');

  DELETE FROM rpcmtec.subsecao AS s
   USING rpcmtec.edicao AS e
   WHERE e.id = s.edicao_id
     AND e.data_fechamento IS NULL
     AND s.origem_id = 2
     AND s.numero IN ('2.2', '2.4', '7.1');

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RAISE NOTICE 'Apagadas % linha(s) de rpcmtec.subsecao, todas com evento D em auditoria.evento.', v_total;
END $$;

-- A MARCA DE CONFERENCIA NAO SAI JUNTO, e nao e esquecimento.
-- `rpcmtec.subsecao_revisao` vale para as TRES origens e sobrevive a virada: a
-- 7.1 continua sendo um bloco conferivel, e apagar a marca faria a edicao voltar
-- a dizer "ninguem olhou" sobre um bloco que alguem olhou. A `impressao` guardada
-- passa a divergir do conteudo de hoje, e a tela ja sabe dizer isso: "revisada,
-- MAS mudou depois" -- que e exatamente o que aconteceu.

UPDATE public.versao SET nome = '1.47.0' WHERE code = 1;

COMMIT;

-- Para desfazer. As linhas voltam do proprio rastro, que e append-only e por
-- isso continua la depois desta migracao. `id` volta com o valor original, e por
-- isso a sequencia e reposicionada no fim:
--
--   INSERT INTO rpcmtec.subsecao
--     (id, edicao_id, numero, ordem, secao_titulo, titulo, origem_id,
--      cabecalhos, linhas, texto, sem_ocorrencia, data_cadastramento,
--      usuario_cadastramento_uuid, data_modificacao, usuario_modificacao_uuid)
--   SELECT (dados_antes->>'id')::bigint,
--          (dados_antes->>'edicao_id')::bigint,
--          dados_antes->>'numero',
--          (dados_antes->>'ordem')::smallint,
--          dados_antes->>'secao_titulo',
--          dados_antes->>'titulo',
--          (dados_antes->>'origem_id')::smallint,
--          dados_antes->'cabecalhos',
--          dados_antes->'linhas',
--          dados_antes->>'texto',
--          (dados_antes->>'sem_ocorrencia')::boolean,
--          (dados_antes->>'data_cadastramento')::timestamptz,
--          (dados_antes->>'usuario_cadastramento_uuid')::uuid,
--          (dados_antes->>'data_modificacao')::timestamptz,
--          (dados_antes->>'usuario_modificacao_uuid')::uuid
--     FROM auditoria.evento
--    WHERE tabela = 'rpcmtec.subsecao' AND operacao = 'D' AND origem = 'migracao'
--      AND motivo LIKE 'Virada 1.47.0:%';
--   SELECT setval('rpcmtec.subsecao_id_seq', (SELECT max(id) FROM rpcmtec.subsecao));
--   UPDATE public.versao SET nome = '1.46.0' WHERE code = 1;
--
-- E o codigo volta junto, senao as linhas nascem orfas de novo: em
-- `rpcmtec_estrutura.js` a 7.1 volta a `origem: ORIGEM.DIGITADA` e a
-- `modulo: null`, e `montarEquipamentoIndisponivel` sai de `rpcmtec_ctrl.js`.
