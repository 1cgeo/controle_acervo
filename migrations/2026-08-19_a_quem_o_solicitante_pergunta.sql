-- O PEDIDO PASSA A DIZER COM QUEM O SOLICITANTE FALA.
--
-- POR QUE. A tela publica de acompanhamento (`#/consultar-pedido/<localizador>`)
-- mostra a situacao, o prazo, o que foi pedido e agora a imagem de cada folha.
-- O que ela nunca teve foi o caminho de VOLTA: quem abre a tela e fica com
-- duvida nao tem a quem perguntar. O DIEx de resposta traz o contato, mas ele
-- fica na caixa de quem recebeu o documento, e nao com quem consulta meses
-- depois.
--
-- NAO E O `ponto_contato`, QUE JA EXISTE. Aquele e o contato DELES, o oficial
-- da OM que pediu, e serve a nos: e por ele que a mapoteca liga para destravar
-- uma entrega. Este e o NOSSO, e serve a eles. Sao os dois lados da mesma
-- conversa, e guardar os dois na mesma coluna perderia justamente a distincao
-- que importa quando alguem precisa ligar.
--
-- POR QUE POR PEDIDO, E NAO EM `dgeo.instituicao`. A instituicao tem linha
-- unica, tela de admin pronta e seria menos codigo. O chefe decidiu por pedido
-- (2026-08-19), e a razao se sustenta: quem atende MUDA. O militar sai de ferias,
-- troca de funcao, e um pedido de junho respondido em setembro tem de continuar
-- apontando para quem o atendeu, e nao para quem senta na cadeira hoje. Campo
-- por pedido guarda o contato do ATENDIMENTO daquele pedido; campo global
-- reescreveria a historia de todos a cada troca.
--
-- TEXTO LIVRE de proposito. O contato e posto mais nome de guerra mais telefone
-- mais RITEx, em combinacoes que mudam, e nenhuma delas cabe num formato fixo
-- sem obrigar quem cadastra a preencher o que nao tem.
--
-- E PUBLICO, e isso e o ponto. Ele sai na consulta por localizador, sem login.
-- Nao escreva ali nada que nao possa ser lido pela OM: anotacao interna continua
-- em `observacao_interna`, que a rota publica nao devolve.
--
-- ANULAVEL, e nulo e o estado normal do que ja esta cadastrado: 47 pedidos
-- abertos nascem sem ele, e a tela simplesmente nao mostra a linha.

-- IF NOT EXISTS porque migracao aqui e IDEMPOTENTE por contrato, e o ensaio
-- (`ensaiar_migracao.cjs`) a aplica DUAS vezes de proposito.

BEGIN;

ALTER TABLE mapoteca.pedido
  ADD COLUMN IF NOT EXISTS contato_mapoteca VARCHAR(255);

COMMENT ON COLUMN mapoteca.pedido.contato_mapoteca IS
  'Contato do 1o CGEO para o solicitante tirar duvidas sobre este pedido. '
  'E PUBLICO: sai na consulta por localizador, sem login. Nao confundir com '
  'ponto_contato, que e o contato da OM que pediu.';

UPDATE public.versao SET nome = '3.7.0' WHERE code = 1;

COMMIT;

-- COMO DESFAZER
--
--   BEGIN;
--   ALTER TABLE mapoteca.pedido DROP COLUMN contato_mapoteca;
--   UPDATE public.versao SET nome = '3.6.0' WHERE code = 1;
--   COMMIT;
