-- O PEDIDO IMPRESSO E NAO DESPACHADO GANHA SITUACAO PROPRIA.
--
-- POR QUE. Entre imprimir e remeter existe um estagio real: o material esta
-- pronto, embalado, e ainda nao saiu. Ele nao tinha nome no dominio, entao
-- ficava dentro de 'Em andamento' (3) e produzia dois efeitos ruins ao mesmo
-- tempo. A fila de impressao (GET /mapoteca/pedido/em_aberto, que o plugin do
-- QGIS le) continuava oferecendo para imprimir o que ja estava impresso. E a
-- tela publica de acompanhamento dizia ao solicitante que o pedido dele estava
-- 'Em andamento' no dia em que ele ja estava pronto na prateleira.
--
-- NAO E O 7 (Aguardando producao), E A DISTINCAO E O PONTO. O 7 espera CARTA
-- QUE AINDA NAO EXISTE, e por isso fica fora das duas filas: fila que mostra o
-- impossivel deixa de ser fila. O 8 espera so o DESPACHO do que ja esta pronto,
-- e por isso entra na fila de ATENDIMENTO. Sao esperas opostas: uma depende da
-- producao, a outra depende de nos.
--
-- ONDE ELE APARECE (chefe, 2026-08-24):
--   fila de IMPRESSAO (2, 3)                 -- NAO. Reimprimir e o erro que
--                                               essa lista existe para evitar.
--   fila de ATENDIMENTO (2, 3, 8, 4)         -- SIM. Ainda falta fecha-lo.
-- As duas listas vivem em server/src/mapoteca/query_fragments.js.
--
-- ADITIVA E SO. Nenhum pedido gravado muda de situacao: quem estiver em 'Em
-- andamento' continua la, e passa para 8 quando alguem o marcar. Migracao nao
-- adivinha qual dos pedidos em andamento ja foi impresso.
--
-- O CODE E 8 PORQUE 8 E O PROXIMO LIVRE. Ele nao se encaixa entre o 3 e o 4
-- para "ficar na ordem do fluxo": code de dominio nao se renumera, e a ordem do
-- fluxo nunca foi a ordem do code (o 7 ja e anterior ao 4 no tempo).

-- ON CONFLICT porque migracao aqui e IDEMPOTENTE por contrato, e o ensaio
-- (`ensaiar_migracao.cjs`) a aplica DUAS vezes de proposito.

BEGIN;

INSERT INTO mapoteca.situacao_pedido (code, nome) VALUES
(8, 'Aguardando envio')
ON CONFLICT (code) DO NOTHING;

UPDATE public.versao SET nome = '3.9.0' WHERE code = 1;

COMMIT;

-- COMO DESFAZER
--
-- So desfaz enquanto NENHUM pedido usar o code 8: a chave estrangeira de
-- `mapoteca.pedido.situacao_pedido_id` recusa o DELETE, e e o comportamento
-- desejado. Havendo pedido, mova-o antes para 3 ou 4, a mao, e saiba que a
-- trilha de `auditoria.evento` guarda o 8 para sempre.
--
--   BEGIN;
--   DELETE FROM mapoteca.situacao_pedido WHERE code = 8;
--   UPDATE public.versao SET nome = '3.8.0' WHERE code = 1;
--   COMMIT;
