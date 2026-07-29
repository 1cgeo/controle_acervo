-- Coluna nova em mapoteca.pedido: observacao_interna.
--
-- POR QUE. As colunas observacao e observacao_envio SAO PUBLICAS: as duas saem
-- em GET /api/mapoteca/pedido/localizador/:localizador, a rota sem autenticacao
-- que o cliente usa para acompanhar o pedido. Nao havia onde escrever o que e
-- so nosso: quem levou o pacote aos Correios, com quem esta o cartao de envio,
-- qual folha reimprimir. Quem anotasse isso na observacao mostraria ao cliente.
--
-- A separacao e de CONSULTA, nao de permissao: quem tem perfil na mapoteca le a
-- coluna normalmente na tela de detalhe. O que ela promete e nao vazar para a
-- rota sem autenticacao, e quem faz isso cumprir e a lista explicita de colunas
-- de controller.getPedidoByLocalizador mais o teste de rota que barra o campo.
--
-- NAO entra coluna de "data do envio". Ela foi escrita e descartada em
-- 2026-07-29, depois de medir a producao: data_atendimento ja carrega o dia em
-- que o material saiu (51 de 52 pedidos concluidos com item datado tem
-- data_atendimento igual a maior data_entrega dos itens), e nenhum pedido usa a
-- situacao 4 (Remetido). Duas colunas com a mesma data se contradizem com o
-- tempo. Decisao do chefe: a consulta publica passa a MOSTRAR data_atendimento
-- como "data de envio/entrega". Se um dia o fluxo separar postagem de
-- fechamento (fechar o pedido quando o AR voltar), a coluna nasce ai.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS. Reaplicar nao faz nada. Nenhuma linha
-- existente muda de valor (a coluna nasce NULL) e nenhum CHECK passa a reprovar
-- linha gravada.

BEGIN;

ALTER TABLE mapoteca.pedido
    ADD COLUMN IF NOT EXISTS observacao_interna TEXT;

COMMENT ON COLUMN mapoteca.pedido.observacao_interna IS
    'Anotação da equipe. NUNCA sai na consulta pública por localizador; ao contrário de observacao e observacao_envio, que saem.';

COMMIT;

-- Para desfazer:
--   ALTER TABLE mapoteca.pedido DROP COLUMN IF EXISTS observacao_interna;
