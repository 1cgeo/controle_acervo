-- A meta que revisao NENHUMA publicou ainda NAO ESTA no PIT.
--
-- O PROBLEMA, visto em producao em 2026-08-05. `pit.meta_vigente` traz a
-- declaracao por LEFT JOIN LATERAL, entao a meta sem nenhuma declaracao
-- PUBLICADA saia da view assim mesmo, com descricao, quantidade, prazo e
-- revisao todos nulos. Uma linha em branco no plano do ano.
--
-- COMO ELE APARECEU. Os itens 1.9, 1.10 e 1.11 de 2026 estavam gravados como
-- declarados pela R0, e nem o R0 nem o R1 assinados os tem: a R0 vai da 1.1 a
-- 1.8. A DSG comunicou a inclusao e o documento ainda nao chegou, entao eles
-- foram movidos para a R2, que e RASCUNHO. O rascunho existe exatamente para
-- isso ("cadastrada, o arquivo anexado, e ela ainda nao rege nada"), mas a view
-- continuava mostrando as tres, agora vazias, o que e pior do que antes: antes
-- mentiam um numero, agora nao dizem nada e ocupam a linha.
--
-- POR QUE INNER, E POR QUE ISSO E CORRETO. A meta so promete alguma coisa
-- depois que uma revisao PUBLICADA a declara. Sem declaracao publicada ela nao
-- e uma meta com valores desconhecidos, ela e uma meta que ainda nao existe no
-- plano. Sair da view e a leitura fiel.
--
-- E ISSO TAMBEM MATA UM REMENDO. O comentario da rota de remover declaracao
-- registra que "a meta 6.9 teve de entrar no R0 marcada `cancelada` por nao
-- haver como deixa-la AUSENTE". Com o INNER, deixa-la ausente passa a ser o
-- caminho normal, e o remendo deixa de ser necessario para as proximas.
--
-- ONDE ELA CONTINUA VISIVEL. Na faixa de revisoes da tela do PIT: escolher a R2
-- mostra o que a R2 declara, que e de onde ela sai. Some do CONSOLIDADO, que e o
-- que o plano em vigor promete, e some do RPCMTec, que reporta contra o plano em
-- vigor. Os dois estao certos.
--
-- A MESMA REGRA EM `pit.meta_em(data)`. A meta declarada so pela R2 nao disse
-- nada em marco, entao o relatorio de marco nao pode reporta-la. O comentario
-- antigo da funcao dizia o contrario ("sai com quantidade nula") e estava
-- errado pela mesma razao.
--
-- Idempotente: CREATE OR REPLACE VIEW e CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE OR REPLACE VIEW pit.meta_vigente AS
SELECT m.id, m.ano, m.numero_meta, m.item, m.unidade_id, m.origem_id,
       u.nome AS unidade,
       mr.descricao, mr.quantidade_prevista, mr.prazo, mr.demandante,
       mr.cancelada, mr.revisao_id, r.codigo AS revisao,
       m.data_cadastramento, m.usuario_cadastramento_uuid,
       m.data_modificacao, m.usuario_modificacao_uuid
FROM pit.meta m
LEFT JOIN dominio.unidade_meta u ON u.code = m.unidade_id
-- INNER, e nao LEFT: meta sem declaracao publicada nao esta no plano.
INNER JOIN LATERAL (
  SELECT x.* FROM pit.meta_revisao x
  INNER JOIN pit.revisao rr ON rr.id = x.revisao_id
  WHERE x.meta_id = m.id AND rr.data_vigencia IS NOT NULL
  ORDER BY rr.data_vigencia DESC, rr.id DESC
  LIMIT 1
) mr ON TRUE
LEFT JOIN pit.revisao r ON r.id = mr.revisao_id;

COMMENT ON VIEW pit.meta_vigente IS
    'A meta com a promessa da revisão em vigor hoje. Rascunho não entra, e meta que revisão publicada nenhuma declarou também não: ela ainda não está no plano.';

CREATE OR REPLACE FUNCTION pit.meta_em(data_ref DATE)
RETURNS TABLE (
  id BIGINT, ano SMALLINT, numero_meta SMALLINT, item VARCHAR,
  unidade_id SMALLINT, origem_id SMALLINT, unidade VARCHAR,
  descricao TEXT, quantidade_prevista INTEGER, prazo DATE,
  demandante VARCHAR, cancelada BOOLEAN, revisao_id BIGINT, revisao VARCHAR
) AS $$
  SELECT m.id, m.ano, m.numero_meta, m.item, m.unidade_id, m.origem_id,
         u.nome, mr.descricao, mr.quantidade_prevista, mr.prazo, mr.demandante,
         mr.cancelada, mr.revisao_id, r.codigo
  FROM pit.meta m
  LEFT JOIN dominio.unidade_meta u ON u.code = m.unidade_id
  -- INNER pela mesma razao da view: a meta que nao havia sido declarada NAQUELA
  -- data nao disse nada, e o relatorio daquele mes nao pode reporta-la.
  INNER JOIN LATERAL (
    SELECT x.* FROM pit.meta_revisao x
    INNER JOIN pit.revisao rr ON rr.id = x.revisao_id
    WHERE x.meta_id = m.id
      AND rr.data_vigencia IS NOT NULL
      AND rr.data_vigencia <= data_ref
    ORDER BY rr.data_vigencia DESC, rr.id DESC
    LIMIT 1
  ) mr ON TRUE
  LEFT JOIN pit.revisao r ON r.id = mr.revisao_id;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION pit.meta_em(DATE) IS
    'A meta com a promessa que vigia na data pedida. A meta ainda não declarada por revisão publicada naquela data NÃO sai: ela não estava no plano.';

UPDATE public.versao SET nome = '1.28.0' WHERE code = 1;

COMMIT;

-- Para desfazer (a meta sem declaracao publicada volta a sair em branco):
--   reaplique as definicoes de er/pit.sql anteriores a esta migracao, trocando
--   INNER JOIN LATERAL por LEFT JOIN LATERAL nas duas.
--   UPDATE public.versao SET nome = '1.27.0' WHERE code = 1;
