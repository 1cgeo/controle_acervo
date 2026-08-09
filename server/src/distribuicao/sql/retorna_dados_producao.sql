/*
    A linha de cabecalho do pacote que o plugin SAP Operador recebe: quem e a
    pessoa, qual a unidade de trabalho, em que projeto, lote e bloco ela esta e
    onde o dado de producao mora.

    Veio de `macrocontrole/sql/retorna_dados_producao.sql` do SAP 2.3.5. O que
    mudou, alem do schema:

      `l.denominador_escala` NAO EXISTE, e nao tem sucessor. Ele era coluna de
      `macrocontrole.lote`; o lote agora e `acervo.lote`, e a escala mora em
      `acervo.produto.tipo_escala_id` porque e propriedade da FOLHA (o mesmo lote
      produz a carta 1:25.000 e o CDGV que a alimenta). Ver o cabecalho de
      `er/producao.sql`.

      O `tipo_produto` do SAP e o SUBTIPO daqui, e ele sai da LINHA DE PRODUCAO.
      La a consulta o buscava por `macrocontrole.produto` do lote, com um JOIN
      sem chave que multiplicava a linha e era salvo pelo LIMIT 1 -- o lote tinha
      uma linha de producao so, entao todo produto dele tinha o mesmo tipo. Aqui
      um lote do acervo ATRAVESSA linhas de producao, e quem declara o subtipo
      que se fabrica e `producao.linha_producao.subtipo_produto_id`. Puxa-lo do
      produto faria a UT da carta responder pelo CDGV que ocupa o mesmo poligono.

      `dado_producao_id` e NOT NULL em `producao.unidade_trabalho`, entao o LEFT
      JOIN do SAP virou INNER: um LEFT que nunca falha so esconde a garantia.
*/
SELECT a.unidade_trabalho_id, a.etapa_id, e.subfase_id, u.login, u.uuid AS usuario_uuid,
  u.nome_guerra, s.nome AS subfase_nome, ut.epsg,
  ST_ASEWKT(ST_Transform(ut.geom, ut.epsg::integer)) AS unidade_trabalho_geom,
  ut.lote_id, l.nome AS lote, s.fase_id, f.tipo_fase_id, lp.id AS linha_producao_id,
  ut.dificuldade, ut.tempo_estimado_minutos, dp.configuracao_producao, ut.id AS ut_id,
  dp.tipo_dado_producao_id, pj.nome AS projeto, b.nome AS bloco,
  stp.nome AS subtipo_produto, e.tipo_etapa_id, te.nome AS etapa_nome,
  a.observacao AS observacao_atividade, ut.observacao AS observacao_unidade_trabalho
FROM producao.atividade AS a
INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
INNER JOIN dominio.tipo_etapa AS te ON te.code = e.tipo_etapa_id
INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
INNER JOIN producao.fase AS f ON f.id = s.fase_id
INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
INNER JOIN dominio.subtipo_produto AS stp ON stp.code = lp.subtipo_produto_id
INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
INNER JOIN acervo.lote AS l ON l.id = ut.lote_id
INNER JOIN acervo.projeto AS pj ON pj.id = l.projeto_id
INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
INNER JOIN producao.dado_producao AS dp ON dp.id = ut.dado_producao_id
LEFT JOIN dgeo.usuario AS u ON u.uuid = a.usuario_uuid
WHERE a.id = $<atividadeId>
LIMIT 1
