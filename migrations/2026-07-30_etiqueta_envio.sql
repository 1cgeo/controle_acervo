-- Tabela nova: mapoteca.etiqueta_envio.
--
-- POR QUE. Ate hoje a etiqueta de envio por Correios era descartavel. O dialogo
-- do cliente montava o endereco a partir do pedido, imprimia e esquecia a
-- correcao que a pessoa digitou. Quem imprimia a segunda via redigitava o mesmo
-- conserto, e nada provava o que foi colado no pacote.
--
-- POR QUE UMA SO POR PEDIDO. A etiqueta e o endereco corrigido daquele envio,
-- nao um historico de tentativas. Por isso o UNIQUE em pedido_id, que tambem
-- sustenta o ON CONFLICT do upsert em PUT /mapoteca/pedido/:id/etiqueta. Quem
-- mudou o que, e quando, sai de mapoteca.pedido_auditoria com
-- tabela = 'etiqueta_envio'.
--
-- POR QUE NAO SOBRESCREVE O PEDIDO. O pedido guarda o endereco que veio no
-- DIEx; a etiqueta guarda o que foi para o pacote. Copiar um sobre o outro
-- apagaria a prova do que o cliente pediu.
--
-- O DDL e identico ao do er/mapoteca.sql, nome da constraint inclusive, senao
-- instalacao nova divergiria da migrada e o ensaiar_migracao.cjs reprovaria.
--
-- Idempotente (IF NOT EXISTS). So ADICIONA; nada existente muda.

BEGIN;

CREATE TABLE IF NOT EXISTS mapoteca.etiqueta_envio(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    pedido_id BIGINT NOT NULL REFERENCES mapoteca.pedido (id) ON DELETE CASCADE,
    destinatario VARCHAR(255) NOT NULL,
    aos_cuidados VARCHAR(255),
    endereco TEXT,
    cep VARCHAR(9),
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
    -- Nome explicito, e nao o que o Postgres geraria: o ON CONFLICT do upsert o
    -- cita pelo nome.
    CONSTRAINT unique_etiqueta_por_pedido UNIQUE (pedido_id)
);

COMMIT;

-- Para desfazer:
--   DROP TABLE IF EXISTS mapoteca.etiqueta_envio;
