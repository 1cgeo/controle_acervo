/*
    A FILA NORMAL: a regra de negocio mais densa do sistema.

    Ela responde "qual a proxima atividade desta pessoa" quando nao ha furo de
    fila nem atividade pausada. E a quarta e ultima da cascata de `calculaFila`,
    e a unica que cobra a HABILITACAO inteira (grupo, etapa, bloco e
    dificuldade).

    Veio de `macrocontrole/sql/calcula_fila.sql` do SAP 2.3.5, e a traducao para
    o SCA e esta:

      macrocontrole.*              -> producao.*
      a.tipo_situacao_id           -> a.tipo_situacao_atividade_id
      *.usuario_id (inteiro)       -> *.usuario_uuid (UUID de dgeo.usuario)
      perfil_producao_etapa        -> habilitacao_etapa       (alias he)
      perfil_producao_operador     -> habilitacao_usuario     (alias hu)
      perfil_bloco_operador        -> habilitacao_bloco       (alias hb)
      perfil_dificuldade_operador  -> habilitacao_dificuldade (alias hd)

    O FILTRO 2 NUNCA EXISTIU, e a lacuna e do SAP: os filtros se chamam 1, 3, 4 e
    5 desde la. Renumera-los agora so faria a comparacao com a origem custar
    mais.

    O `tipo_restricao_id = 3` DO SAP NAO VEIO, e a ausencia e decidida. Ele era
    "Operadores no mesmo turno" e dependia de `dgeo.usuario.tipo_turno_id`, que
    nao atravessou (medido no dump de 2026-08-09: das 98 linhas de
    `restricao_etapa`, ZERO eram do tipo 3). Com ele sairam os quatro JOINs em
    `dgeo.usuario` que os filtros 3 e 4 faziam SO para ler o turno, e mais um
    JOIN em `unidade_trabalho` que o filtro 3 do SAP fazia sem usar.

    COMO SE LE, de cima para baixo:

      atividade_data     tudo o que a habilitacao desta pessoa alcanca hoje
      filtro1            a UT depende de outra UT que ainda nao esta pronta
      filtro3            restricao de operador com etapa de OUTRA subfase
      filtro4            restricao de operador com etapa da MESMA subfase
      filtro5            ja esta reservada em alguma fila prioritaria
      atividade_filtered o que sobrou dos quatro
      utstats            quantas UTs de cada dificuldade a pessoa ja fechou
      a_ant              a etapa anterior de cada UT, para o HAVING
      SELECT final       ordena por bloco, etapa, dificuldade e UT

    A ORDEM DO `ORDER BY` E O CONTRATO: bloco primeiro (o gerente decide por
    onde a producao anda), depois a prioridade da etapa dentro da habilitacao,
    depois a dificuldade calibrada para a pessoa e so entao a prioridade da
    propria unidade de trabalho.
*/
WITH atividade_data AS (
  SELECT a.id, a.etapa_id, e.subfase_id, e.ordem, a.tipo_situacao_atividade_id,
    a.unidade_trabalho_id, hu.usuario_uuid, ut.dificuldade, ut.tempo_estimado_minutos,
    b.prioridade AS b_prioridade, ut.prioridade AS ut_prioridade,
    he.prioridade AS he_prioridade, b.id AS bloco_id, ut.lote_id
  FROM producao.atividade AS a
  INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
  INNER JOIN producao.habilitacao_etapa AS he
    ON he.subfase_id = e.subfase_id AND he.tipo_etapa_id = e.tipo_etapa_id
  INNER JOIN producao.habilitacao_usuario AS hu ON hu.habilitacao_id = he.habilitacao_id
  INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
  INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
  INNER JOIN producao.habilitacao_bloco AS hb
    ON hb.bloco_id = b.id AND hb.usuario_uuid = hu.usuario_uuid
  WHERE hu.usuario_uuid = $<usuarioUuid>
    AND a.tipo_situacao_atividade_id = 1 AND ut.disponivel IS TRUE
), filtro1 AS (
  /* A unidade de trabalho depende espacialmente de outra que ainda nao esta
     pronta. `tipo_pre_requisito_id` 1 exige a regiao CONCLUIDA (recusa se a
     outra estiver 1, 2 ou 3); o 2 exige apenas que ela NAO ESTEJA EM EXECUCAO
     (recusa so o 2). */
  SELECT DISTINCT a.id FROM atividade_data AS a
  INNER JOIN producao.relacionamento_ut AS ut_sr ON ut_sr.ut_id = a.unidade_trabalho_id
  INNER JOIN producao.atividade AS a_re ON a_re.unidade_trabalho_id = ut_sr.ut_re_id
  WHERE
  ((a_re.tipo_situacao_atividade_id IN (1, 2, 3) AND ut_sr.tipo_pre_requisito_id = 1) OR
   (a_re.tipo_situacao_atividade_id IN (2) AND ut_sr.tipo_pre_requisito_id = 2))
), filtro3 AS (
  /* Restricao de operador entre etapas de subfases DIFERENTES da mesma linha de
     producao. Tipo 1 exige operadores distintos (quem executou nao revisa) e
     tipo 2 exige o mesmo operador (quem executou e quem corrige). */
  SELECT DISTINCT a.id FROM atividade_data AS a
  INNER JOIN producao.subfase AS sub ON sub.id = a.subfase_id
  INNER JOIN producao.fase AS fa ON fa.id = sub.fase_id
  INNER JOIN producao.restricao_etapa AS re ON re.etapa_posterior_id = a.etapa_id
  INNER JOIN producao.etapa AS et_re
    ON et_re.id = re.etapa_anterior_id AND et_re.subfase_id <> a.subfase_id
  INNER JOIN producao.subfase AS sub_re ON sub_re.id = et_re.subfase_id
  INNER JOIN producao.fase AS fa_re
    ON fa_re.id = sub_re.fase_id AND fa_re.linha_producao_id = fa.linha_producao_id
  INNER JOIN producao.atividade AS a_re ON a_re.etapa_id = et_re.id
  WHERE (
    (re.tipo_restricao_id = 1 AND a_re.usuario_uuid = $<usuarioUuid>) OR
    (re.tipo_restricao_id = 2 AND a_re.usuario_uuid <> $<usuarioUuid>)
  ) AND a_re.tipo_situacao_atividade_id IN (1, 2, 3, 4)
), filtro4 AS (
  /* A mesma restricao, agora entre etapas da MESMA subfase e da MESMA unidade de
     trabalho. E o caso comum: execucao e revisao da mesma folha. */
  SELECT DISTINCT a.id FROM atividade_data AS a
  INNER JOIN producao.restricao_etapa AS re ON re.etapa_posterior_id = a.etapa_id
  INNER JOIN producao.atividade AS a_re
    ON a_re.etapa_id = re.etapa_anterior_id AND a_re.unidade_trabalho_id = a.unidade_trabalho_id
  INNER JOIN producao.etapa AS et_re ON et_re.id = a_re.etapa_id
  WHERE et_re.subfase_id = a.subfase_id AND (
    (re.tipo_restricao_id = 1 AND a_re.usuario_uuid = $<usuarioUuid>) OR
    (re.tipo_restricao_id = 2 AND a_re.usuario_uuid <> $<usuarioUuid>)
  ) AND a_re.tipo_situacao_atividade_id IN (1, 2, 3, 4)
), filtro5 AS (
  /* Ja reservada em alguma fila prioritaria. Ela sai DAQUI porque as duas
     consultas anteriores da cascata ja a teriam entregue a quem tem direito;
     deixa-la aqui a daria a quem passasse na frente. */
  SELECT DISTINCT atividade_id AS id FROM producao.fila_prioritaria
  UNION
  SELECT DISTINCT atividade_id AS id FROM producao.fila_prioritaria_grupo
), atividade_filtered AS (
  SELECT ad.*
  FROM atividade_data AS ad
  LEFT JOIN filtro1 AS f1 ON ad.id = f1.id
  LEFT JOIN filtro3 AS f3 ON ad.id = f3.id
  LEFT JOIN filtro4 AS f4 ON ad.id = f4.id
  LEFT JOIN filtro5 AS f5 ON ad.id = f5.id
  WHERE f1.id IS NULL AND f3.id IS NULL AND f4.id IS NULL AND f5.id IS NULL
), utstats AS (
  /* Quantas unidades de trabalho de cada dificuldade esta pessoa ja FINALIZOU
     (code 4) nas subfases em que ela tem perfil de dificuldade. E o que o perfil
     BALANCEADO (tipo 3) usa para empurrar a pessoa para a dificuldade menos
     praticada. */
  SELECT ut.dificuldade, count(*) AS diff_count
  FROM producao.habilitacao_dificuldade AS hd
  JOIN producao.unidade_trabalho AS ut
    ON ut.subfase_id = hd.subfase_id AND hd.lote_id = ut.lote_id
  JOIN producao.atividade AS a
    ON a.unidade_trabalho_id = ut.id AND a.usuario_uuid = hd.usuario_uuid
  WHERE hd.usuario_uuid = $<usuarioUuid> AND a.tipo_situacao_atividade_id = 4
  GROUP BY ut.dificuldade
), a_ant AS (
  SELECT a.tipo_situacao_atividade_id, a.unidade_trabalho_id, e.ordem, e.subfase_id
  FROM producao.atividade AS a
  JOIN producao.etapa AS e ON e.id = a.etapa_id
  WHERE a.tipo_situacao_atividade_id IN (1, 2, 3, 4)
)
SELECT id
FROM (
  SELECT a.id, a.etapa_id, a.unidade_trabalho_id,
    a_ant.tipo_situacao_atividade_id AS situacao_ant,
    a.b_prioridade, a.he_prioridade, a.ut_prioridade,
    CASE
    WHEN hd.tipo_perfil_dificuldade_id IS NULL THEN 0
    WHEN hd.tipo_perfil_dificuldade_id = 1 THEN a.dificuldade
    WHEN hd.tipo_perfil_dificuldade_id = 2 THEN -a.dificuldade
    WHEN hd.tipo_perfil_dificuldade_id = 3 THEN coalesce(utstats.diff_count, 0)
    END AS dificuldade_rank
  FROM atividade_filtered AS a
  LEFT JOIN producao.habilitacao_dificuldade AS hd
    ON hd.lote_id = a.lote_id AND hd.subfase_id = a.subfase_id AND hd.usuario_uuid = a.usuario_uuid
  LEFT JOIN utstats ON utstats.dificuldade = a.dificuldade
  LEFT JOIN a_ant
    ON a_ant.unidade_trabalho_id = a.unidade_trabalho_id AND a_ant.subfase_id = a.subfase_id
    AND a.ordem > a_ant.ordem
) AS sit
GROUP BY id, b_prioridade, he_prioridade, dificuldade_rank, ut_prioridade
HAVING MIN(situacao_ant) IS NULL OR every(situacao_ant IN (4))
ORDER BY b_prioridade, he_prioridade, dificuldade_rank, ut_prioridade
LIMIT 1
