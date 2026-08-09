/*
    A atividade que a FILA PRIORITARIA reserva PARA ESTA PESSOA.

    E a primeira das quatro consultas em cascata de `calculaFila`, e por isso ela
    NAO olha habilitacao nenhuma: o furo de fila e um ato declarado de quem
    gerencia, e ele vale mesmo onde a habilitacao normal nao alcancaria.

    Veio de `macrocontrole/sql/calcula_fila_prioritaria.sql` do SAP 2.3.5. O que
    mudou foi o schema (`macrocontrole` -> `producao`), o nome da coluna de
    situacao (`tipo_situacao_id` -> `tipo_situacao_atividade_id`) e a chave de
    gente (`usuario_id` inteiro -> `usuario_uuid`).

    O `HAVING` e o coracao das quatro: a atividade so entra se NENHUMA etapa
    anterior da MESMA subfase sobre a MESMA unidade de trabalho estiver viva --
    ou nao existe etapa anterior (`MIN(situacao_ant) IS NULL`), ou todas elas ja
    estao Finalizadas (code 4).
*/
SELECT id
FROM (
  SELECT a.id, a.etapa_id, a.unidade_trabalho_id,
    a_ant.tipo_situacao_atividade_id AS situacao_ant, fp.prioridade AS fp_prioridade
  FROM producao.atividade AS a
  INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
  INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
  INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
  INNER JOIN producao.fila_prioritaria AS fp ON fp.atividade_id = a.id
  LEFT JOIN
  (
    SELECT a.tipo_situacao_atividade_id, a.unidade_trabalho_id, e.ordem, e.subfase_id
    FROM producao.atividade AS a
    INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
    WHERE a.tipo_situacao_atividade_id IN (1, 2, 3, 4)
  )
  AS a_ant ON a_ant.unidade_trabalho_id = a.unidade_trabalho_id AND a_ant.subfase_id = e.subfase_id
    AND e.ordem > a_ant.ordem
  WHERE ut.disponivel IS TRUE AND a.tipo_situacao_atividade_id = 1
    AND fp.usuario_uuid = $<usuarioUuid>
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
GROUP BY id, fp_prioridade
HAVING MIN(situacao_ant) IS NULL OR every(situacao_ant IN (4))
ORDER BY fp_prioridade
LIMIT 1
