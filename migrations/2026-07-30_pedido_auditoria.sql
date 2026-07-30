-- Tabela nova: mapoteca.pedido_auditoria.
--
-- POR QUE. Ate hoje mapoteca.pedido e mapoteca.produto_pedido guardavam so o
-- ULTIMO que mexeu (usuario_atualizacao_id), sem historico. Quem mudou a
-- situacao do pedido na semana passada, quem acrescentou o item, quem baixou a
-- quantidade: nada disso sobrevivia a alteracao seguinte. E o DELETE apagava
-- tudo sem deixar rastro nenhum.
--
-- POR QUE NAO E GATILHO. Decisao do chefe, 2026-07-30. O gatilho de banco nao
-- conhece o usuario da sessao HTTP: o Postgres ve a conexao do pool, e a saida
-- seria um SET LOCAL em toda transacao do servidor. No backend o usuarioUuid ja
-- chega em cada funcao do controller. A insercao mora em
-- server/src/mapoteca/auditoria_ctrl.js, dentro da transacao que ja existe, para
-- a linha de auditoria cair junto com a mudanca ou nao cair. O preco de nao ter
-- gatilho e a rota nova que esquece de auditar; quem cobre isso e o teste de
-- varredura server/src/__tests__/routes/mapoteca_auditoria.test.js.
--
-- O DDL e identico ao do er/mapoteca.sql, senao instalacao nova divergiria da
-- migrada e o ensaiar_migracao.cjs reprovaria. O nome do indice tambem.
--
-- Idempotente (IF NOT EXISTS). So ADICIONA; nada existente muda.

BEGIN;

CREATE TABLE IF NOT EXISTS mapoteca.pedido_auditoria(
    id BIGSERIAL PRIMARY KEY,
    -- SEM chave estrangeira de proposito: a linha da auditoria tem de sobreviver
    -- ao pedido apagado, que e justamente o caso que ela existe para registrar.
    -- Com FK, o DELETE do pedido levaria junto a prova de que ele existiu.
    pedido_id BIGINT NOT NULL,
    tabela VARCHAR(50) NOT NULL,
    registro_id BIGINT,
    operacao CHAR(1) NOT NULL CHECK (operacao IN ('I','U','D')),
    dados_antes JSONB,
    dados_depois JSONB,
    campos_alterados TEXT[],
    -- Aceita nulo so para evento de migracao, onde nao ha pessoa por tras da
    -- mudanca. Todo evento vindo de rota grava o usuario do token.
    usuario_uuid UUID REFERENCES dgeo.usuario (uuid),
    data_evento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pedido_auditoria_pedido
    ON mapoteca.pedido_auditoria(pedido_id, data_evento DESC);

COMMIT;

-- Para desfazer:
--   DROP TABLE IF EXISTS mapoteca.pedido_auditoria;
