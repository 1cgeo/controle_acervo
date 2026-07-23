-- Migração: campos para PEDIDO DE CIVIL (LAI, órgãos, empresas, pessoas).
-- O pedido de civil já é um mapoteca.pedido cujo cliente tem tipo_cliente NÃO
-- militar (o relatório Civ já separa por isso). Aqui só ADICIONAMOS campos
-- opcionais úteis ao civil: canal de recebimento, município/área e nº de
-- imagens entregues. Nada obrigatório; pedidos de OM ignoram. Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS mapoteca.canal_recebimento(
    code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.canal_recebimento (code, nome) VALUES
(1, 'Ouvidoria (Fala.BR) - LAI'),
(2, 'E-mail'),
(3, 'Ofício'),
(4, 'Outro')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE mapoteca.pedido
    ADD COLUMN IF NOT EXISTS canal_recebimento_id SMALLINT
        REFERENCES mapoteca.canal_recebimento (code),
    ADD COLUMN IF NOT EXISTS municipio VARCHAR(255),
    ADD COLUMN IF NOT EXISTS qtd_imagens INTEGER
        CHECK (qtd_imagens IS NULL OR qtd_imagens >= 0);

COMMENT ON COLUMN mapoteca.pedido.canal_recebimento_id IS
    'Canal por onde a demanda de civil chegou (Ouvidoria/LAI, e-mail, ofício). NULL para pedido de OM.';
COMMENT ON COLUMN mapoteca.pedido.municipio IS
    'Município/área de interesse da demanda de civil (LAI costuma ser por área, não por folha MI).';
COMMENT ON COLUMN mapoteca.pedido.qtd_imagens IS
    'Quantidade de imagens/produtos entregues numa demanda de civil (contagem, não folha MI catalogada).';

COMMIT;
