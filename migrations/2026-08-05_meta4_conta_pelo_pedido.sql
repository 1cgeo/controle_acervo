-- A meta de IMPRESSAO conta pelo PEDIDO ligado a ela, e o de-para de midia sai.
--
-- O DESENHO ANTERIOR. O realizado da meta 4 saia de `mapoteca.midia_meta_pit`,
-- um de-para de tipo de midia para meta, por ano: sulfite na 4.1, tyvek na 4.2,
-- glossy na 4.3 em 2026. A ideia era que a meta 4 conta o que SAIU, e o que saiu
-- esta no item do pedido.
--
-- POR QUE ELE ESTAVA ERRADO, E ISSO FOI MEDIDO EM 2026-08-05. O de-para nao
-- conta a META, conta o TIPO DE PAPEL. Somando por ele, 2026 da:
--
--     meta   prometido   pelo de-para   pelo pedido ligado
--     4.1    327         6.493          253
--     4.2    252             0          199
--     4.3     36            36           36
--
-- A 4.1 recebe 6.493 folhas contra 327 prometidas, porque todo pedido impresso
-- em sulfite entra ali, inclusive o que nada tem a ver com o PIT. E a 4.2 recebe
-- ZERO porque nenhuma folha saiu em tyvek no ano: os pedidos planejados em tyvek
-- foram atendidos em sulfite e foram contados na 4.1. O numero nao media o que a
-- meta promete.
--
-- O DESENHO NOVO, e ele e o mesmo das outras duas origens calculadas: a ENTIDADE
-- LIGADA e a verdade. O pedido aponta a meta por `mapoteca.pedido.meta_pit_id`,
-- e os itens dele dizem quanto e em que midia. O planejado sai da soma dos itens
-- pelo mes de `data_prevista`, e o realizado pela mesma soma no mes de
-- `data_atendimento`. Uma fonte, duas datas, como na producao e na capacitacao.
--
-- A MIDIA NAO PRECISA DE LUGAR NENHUM NO PIT. O documento assinado tem a coluna
-- Material, mas ela nao roteia nada: o pedido tem itens e o item tem midia, e e
-- ali que a informacao ja vive. Uma copia no PIT seria a segunda verdade.
--
-- O QUE ISSO MUDA NO NUMERO PUBLICADO. A meta 4 passa a reportar o que estiver
-- LIGADO, e hoje sao 253, 199 e 36. Nao e perda de dado, e o buraco aparecendo:
-- quem cobra o resto e GET /metas/execucao/diagnostico, que compara o prometido
-- com o cadastrado. Ligar o pedido a meta passa a ser o gesto que faz a conta
-- fechar, e ele e o mesmo gesto das outras origens.
--
-- Idempotente: DROP TABLE IF EXISTS.

BEGIN;

DROP TABLE IF EXISTS mapoteca.midia_meta_pit;

UPDATE public.versao SET nome = '1.29.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde o de-para cadastrado; em 2026 eram 3 linhas):
--   CREATE TABLE mapoteca.midia_meta_pit( ... );  -- ver er/mapoteca.sql antes
--     desta migracao, e reinserir sulfite/4.1, tyvek/4.2 e glossy/4.3.
--   UPDATE public.versao SET nome = '1.28.0' WHERE code = 1;
