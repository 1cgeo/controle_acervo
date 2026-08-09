/*
    A atividade que ESTA PESSOA deixou PAUSADA (code 3 de
    dominio.tipo_situacao_atividade).

    Terceira da cascata, e ela vem antes da fila normal de proposito: quem parou
    no meio de uma folha volta para a MESMA folha, e nao para outra. Pausada nao
    e "nao finalizada" (code 5): aquela foi interrompida por fora e nao volta
    para mao nenhuma.

    Ela tambem nao olha habilitacao: a atividade ja e da pessoa, e rebaixar a
    habilitacao dela nao deve deixar trabalho pela metade sem dono.

    Veio de `macrocontrole/sql/calcula_fila_pausada.sql` do SAP 2.3.5.
*/
SELECT id
FROM (
  SELECT a.id, a.etapa_id, a.unidade_trabalho_id,
    e_ant.tipo_situacao_atividade_id AS situacao_ant,
    b.prioridade AS b_prioridade, ut.prioridade AS ut_prioridade
  FROM producao.atividade AS a
  INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
  INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
  INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
  LEFT JOIN
  (
    SELECT a.tipo_situacao_atividade_id, a.unidade_trabalho_id, e.ordem, e.subfase_id
    FROM producao.atividade AS a
    INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
    WHERE a.tipo_situacao_atividade_id IN (1, 2, 3, 4)
  )
  AS e_ant ON e_ant.unidade_trabalho_id = a.unidade_trabalho_id AND e_ant.subfase_id = e.subfase_id
    AND e.ordem > e_ant.ordem
  WHERE ut.disponivel IS TRUE AND a.usuario_uuid = $<usuarioUuid>
    AND a.tipo_situacao_atividade_id = 3
    AND a.id NOT IN
    (
      SELECT a.id FROM producao.atividade AS a
      INNER JOIN producao.relacionamento_ut AS ut_sr ON ut_sr.ut_id = a.unidade_trabalho_id
      INNER JOIN producao.atividade AS a_re ON a_re.unidade_trabalho_id = ut_sr.ut_re_id
      WHERE
      ((a_re.tipo_situacao_atividade_id IN (1, 2, 3) AND ut_sr.tipo_pre_requisito_id = 1) OR
       (a_re.tipo_situacao_atividade_id IN (2) AND ut_sr.tipo_pre_requisito_id = 2))
    )
) AS sit
GROUP BY id, b_prioridade, ut_prioridade
HAVING MIN(situacao_ant) IS NULL OR every(situacao_ant IN (4))
ORDER BY b_prioridade, ut_prioridade
LIMIT 1
