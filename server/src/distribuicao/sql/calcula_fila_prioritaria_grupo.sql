/*
    O MESMO furo de fila da consulta anterior, mas declarado para uma
    HABILITACAO inteira em vez de para uma pessoa.

    Ela e a segunda da cascata, e ao contrario da fila prioritaria individual ela
    JA cobra o bloco: o furo vale para o grupo, e dentro do grupo so recebe quem
    trabalha naquele bloco (`producao.habilitacao_bloco`).

    Veio de `macrocontrole/sql/calcula_fila_prioritaria_grupo.sql` do SAP 2.3.5.
    As tabelas de distribuicao mudaram de nome na travessia, porque no SCA
    "perfil" ja quer dizer AUTORIZACAO (`dominio.tipo_perfil`, lido pelo
    verifyPerfil):

      perfil_producao_operador -> producao.habilitacao_usuario
      perfil_bloco_operador    -> producao.habilitacao_bloco
      fila_prioritaria_grupo.perfil_producao_id -> .habilitacao_id

    O `WHERE fpg.perfil_producao_id = ppo.perfil_producao_id` do SAP NAO veio: em
    letra e a mesma condicao do `INNER JOIN ... ON` logo acima, e repetida no
    WHERE ela so dava a impressao de ser uma segunda regra.
*/
SELECT id
FROM (
  SELECT a.id, a.etapa_id, a.unidade_trabalho_id,
    a_ant.tipo_situacao_atividade_id AS situacao_ant, fpg.prioridade AS fpg_prioridade
  FROM producao.atividade AS a
  INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
  INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
  INNER JOIN producao.fila_prioritaria_grupo AS fpg ON fpg.atividade_id = a.id
  INNER JOIN producao.habilitacao_usuario AS hu ON hu.habilitacao_id = fpg.habilitacao_id
  INNER JOIN producao.habilitacao_bloco AS hb
    ON hb.bloco_id = ut.bloco_id AND hb.usuario_uuid = hu.usuario_uuid
  LEFT JOIN
  (
    SELECT a.tipo_situacao_atividade_id, a.unidade_trabalho_id, e.ordem, e.subfase_id
    FROM producao.atividade AS a
    INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
    WHERE a.tipo_situacao_atividade_id IN (1, 2, 3, 4)
  )
  AS a_ant ON a_ant.unidade_trabalho_id = a.unidade_trabalho_id AND a_ant.subfase_id = e.subfase_id
    AND e.ordem > a_ant.ordem
  WHERE ut.disponivel IS TRUE AND hu.usuario_uuid = $<usuarioUuid>
    AND a.tipo_situacao_atividade_id = 1
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
GROUP BY id, fpg_prioridade
HAVING MIN(situacao_ant) IS NULL OR every(situacao_ant IN (4))
ORDER BY fpg_prioridade
LIMIT 1
