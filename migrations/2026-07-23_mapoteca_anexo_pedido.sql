-- Migração: armazenamento de documentos anexos no pedido da mapoteca.
-- Guarda o DIEx/Ofício de solicitação e seus arquivos no PRÓPRIO banco
-- (conteudo BYTEA), seguindo o padrão de orcamento.arquivo do controle
-- orçamentário. Idempotente (IF NOT EXISTS). Só ADICIONA; nada existente muda.

BEGIN;

CREATE TABLE IF NOT EXISTS mapoteca.tipo_anexo_pedido(
    code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.tipo_anexo_pedido (code, nome) VALUES
(1, 'Documento de solicitação (DIEx/Ofício)'),
(2, 'Anexo do documento de solicitação'),
(3, 'Comprovante de entrega/remessa'),
(4, 'Outros')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS mapoteca.anexo_pedido(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    pedido_id BIGINT NOT NULL REFERENCES mapoteca.pedido (id) ON DELETE CASCADE,
    tipo_anexo_id SMALLINT NOT NULL DEFAULT 4 REFERENCES mapoteca.tipo_anexo_pedido (code),
    nome_original VARCHAR(255) NOT NULL,
    extensao VARCHAR(20) NOT NULL,
    mimetype VARCHAR(150),
    tamanho_bytes BIGINT,
    conteudo BYTEA NOT NULL,
    descricao TEXT,
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

CREATE INDEX IF NOT EXISTS idx_anexo_pedido_pedido ON mapoteca.anexo_pedido(pedido_id);

COMMIT;
