-- O ITEM do pedido passa a poder declarar a meta do PIT que ele cumpre,
-- sobrepondo a do pedido.
--
-- O QUE FORCOU. A conciliacao da Meta 4 de 2026, fechada em 2026-08-06 contra o
-- documento do PIT de impressao (arquivo PIT_IMP_1_CGEO_2026.ods), mostrou que a
-- meta se divide por MATERIAL:
--
--     sulfite  327 folhas em 89 linhas  ->  4.1
--     tyvek    247 folhas em 28 linhas  ->  4.2
--     glossy    36 folhas em  3 linhas  ->  4.3
--
-- E o material e `tipo_midia_id`, que vive no ITEM. Prender a meta ao PEDIDO
-- obriga o pedido inteiro a cumprir uma meta so, e a realidade nao obedece: dos
-- 16 pedidos ligados a Meta 4, DOIS sao mistos.
--
--     pedido 140 | 10 itens |  8 folhas em tyvek + 32 em sulfite
--     pedido 154 |  4 itens |  4 folhas em tyvek + 20 em sulfite
--
-- As 12 folhas de tyvek desses dois pedidos estavam contadas na 4.1, porque o
-- pedido delas aponta a 4.1. Com elas fora do lugar a 4.2 registrava 235 contra
-- 247 prometidas, e a 4.1 registrava 333 contra 327.
--
-- POR QUE NAO SE RESOLVE RELIGANDO O PEDIDO. Os dois sao mistos: mudar a meta do
-- pedido 140 levaria junto as 32 folhas de sulfite, que estao certas onde estao.
-- E QUEBRAR O PEDIDO EM DOIS SERIA PIOR: o pedido e o documento de uma
-- solicitacao real de uma OM, e inventar um segundo pedido para caber num
-- modelo de dados falsifica o registro do que a OM pediu.
--
-- POR QUE SOBREPOR, E NAO MOVER A COLUNA. O caso comum e o pedido inteiro
-- cumprir uma meta so (14 dos 16), e nele a declaracao no pedido diz a verdade
-- uma vez em vez de repetida item a item. A coluna nova e a EXCECAO declarada:
--
--     NULL          -> o item cumpre a meta do pedido;
--     preenchida    -> o item cumpre esta, e nao a do pedido.
--
-- Quem le usa COALESCE(pp.meta_pit_id, p.meta_pit_id). O NULL nunca e ambiguo,
-- porque quem diz se o pedido e do PIT continua sendo `pedido.previsto_pit`:
-- item de pedido fora do PIT nao cumpre meta nenhuma, com ou sem esta coluna.
--
-- ISTO NAO DERIVA A META DO MATERIAL, e a distincao importa. O de-para de midia
-- para meta existiu e foi removido em 2026-08-05 por medicao: ele contava o TIPO
-- DE PAPEL e nao a meta, e jogava na 4.1 todo sulfite do ano, inclusive o de
-- pedido sem nenhuma relacao com o PIT. A correlacao entre midia e meta valeu em
-- 2026 e o PIT e reescrito todo ano. Aqui o vinculo continua DECLARADO, por
-- chave estrangeira para `pit.meta_item`, e o material apenas explica por que a
-- declaracao precisa caber no item.
--
-- SEM CHECK entre as duas tabelas: o Postgres nao tem CHECK que atravesse
-- tabela. A regra "so pedido previsto no PIT tem item com meta propria" vive no
-- controller e no Joi, e devolve 400 limpo. O que o banco garante e a chave
-- estrangeira: a meta apontada existe.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS e CREATE INDEX IF NOT EXISTS.

BEGIN;

ALTER TABLE mapoteca.produto_pedido
    ADD COLUMN IF NOT EXISTS meta_pit_id BIGINT REFERENCES pit.meta_item (id);

COMMENT ON COLUMN mapoteca.produto_pedido.meta_pit_id IS
    'Item do PIT que ESTE item cumpre, quando difere do declarado no pedido (pit.meta_item). NULL significa "o mesmo do pedido", e não "fora do PIT": quem diz isso é pedido.previsto_pit. Existe porque a Meta 4 se divide por material e o material é do item: o pedido 140 tem 8 folhas em tyvek (4.2) e 32 em sulfite (4.1).';

-- A leitura da execucao do PIT filtra por esta coluna em toda consulta da
-- impressao (planejado, realizado e diagnostico do cadastro).
CREATE INDEX IF NOT EXISTS idx_produto_pedido_meta_pit
    ON mapoteca.produto_pedido(meta_pit_id);

-- NENHUM DADO SE MOVE AQUI. A coluna nasce toda NULL, e com ela em NULL o
-- COALESCE devolve exatamente a meta do pedido: a leitura continua dando os
-- mesmos numeros de antes da migracao. Mover as 12 folhas de tyvek das 6 linhas
-- dos pedidos 140 e 154 e ato de CADASTRO, feito pela API para deixar rastro na
-- auditoria (que e de aplicacao, e nao de gatilho: UPDATE cru aqui nao
-- registraria nada).

UPDATE public.versao SET nome = '1.37.0' WHERE code = 1;

COMMIT;

-- Para desfazer (as declaracoes por item se perdem, e cada item volta a valer a
-- meta do pedido dele):
--   DROP INDEX IF EXISTS mapoteca.idx_produto_pedido_meta_pit;
--   ALTER TABLE mapoteca.produto_pedido DROP COLUMN IF EXISTS meta_pit_id;
--   UPDATE public.versao SET nome = '1.36.0' WHERE code = 1;
