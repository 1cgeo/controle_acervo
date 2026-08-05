-- Tabela nova mapoteca.produto_avulso, e o item do pedido passa a aceitar dois
-- destinos: uma versao do acervo OU um produto avulso.
--
-- POR QUE. Ate aqui todo item apontava, obrigatoriamente, uma versao do acervo
-- (RN08). A mapoteca, porem, imprime coisas que nao sao nossas e nunca serao:
--
--   * papel quadriculado. O DIEx 845-S-3/29o GAC AP, de 14/05/2026, pediu 100
--     folhas de 80 x 68 cm com quadricula de 4 x 4 cm, para adestramento de
--     Central de Tiro. O DIEx 1530-C Art/Div Ens/CPOR/PA, de 01/07/2026, pediu
--     outras 100 e escreveu escala "-". Nao e carta: nao tem MI, nao tem escala,
--     nao tem versao, e catalogar isso no acervo seria mentira.
--   * carta de OUTRO CGEO. A mapoteca distribui produto de todo o SGEx, e a
--     folha de outra area nao entra no nosso acervo so porque passou pela nossa
--     impressora.
--
-- Em 2026 isso deixou 842 copias sem como serem registradas: 200 de papel
-- quadriculado, 52 de outros especiais e 493 de folha SCN nao catalogada.
--
-- O CORTE E DE POSSE, NAO DE FORMATO: o acervo guarda o que E NOSSO, com versao
-- e arquivo; o avulso guarda O QUE SO PASSOU PELA IMPRESSORA. Por isso o avulso
-- ACEITA MI (a carta de outro CGEO tem MI legitimo) e aceita nao ter nenhum (o
-- papel quadriculado). Nao existe CHECK proibindo MI aqui: proibir bloquearia
-- justamente o caso da carta de outra area. O que impede o avulso de virar
-- deposito e o fluxo (a tela procura no acervo primeiro) mais o relatorio de
-- reconciliacao, que lista avulso cujo MI ja existe no acervo.
--
-- POR QUE NAO DUAS TABELAS DE ITEM. Trinta pontos de consulta contam, somam ou
-- listam item hoje (15 no dashboard_ctrl, 12 no mapoteca_ctrl, 5 nos demais), e
-- impressao_item.produto_pedido_id e NOT NULL. Duas tabelas irmas obrigariam a
-- UNION em cada um deles, e esquecer um da numero silenciosamente menor. Alem
-- disso o padrao "um dos dois" reapareceria na impressao, duplicado.
--
-- tipo_produto e tipo_escala sao OPCIONAIS de proposito: o dominio tipo_produto
-- tem Carta Topografica, Ortoimagem, CDGV e tematica, e papel quadriculado nao e
-- nenhum dos quatro. Forcar um deles mentiria no relatorio.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS e um DO que
-- so cria a constraint quando falta. Reaplicar nao faz nada. Nenhuma linha
-- existente muda: em 2026-07-30 os 1759 itens tinham uuid_versao preenchido, e
-- todos passam no CHECK novo.

BEGIN;

CREATE TABLE IF NOT EXISTS mapoteca.produto_avulso (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    -- MI quando existir (carta de outro CGEO); NULL no que nao e carta.
    mi VARCHAR(255),
    -- Onde cabe o que nenhum campo estruturado guarda: "80 x 68 cm, quadricula
    -- de 4 x 4 cm", acabamento, origem do arquivo que o solicitante mandou.
    descricao TEXT,
    tipo_produto_id SMALLINT REFERENCES dominio.tipo_produto (code),
    tipo_escala_id SMALLINT REFERENCES dominio.tipo_escala (code),
    denominador_escala_especial INTEGER
        CHECK (denominador_escala_especial IS NULL OR denominador_escala_especial > 0),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE mapoteca.produto_avulso IS
    'O que a mapoteca imprime sem ser produto do acervo: papel quadriculado, carta de outro CGEO, impresso de ocasião. O corte é de POSSE, não de formato.';
COMMENT ON COLUMN mapoteca.produto_avulso.mi IS
    'MI quando o impresso é carta (tipicamente de outro CGEO). NULL no que não é carta. Avulso com MI que passe a existir no acervo aparece no relatório de reconciliação.';

ALTER TABLE mapoteca.produto_pedido
    ADD COLUMN IF NOT EXISTS produto_avulso_id INTEGER REFERENCES mapoteca.produto_avulso (id);

ALTER TABLE mapoteca.produto_pedido
    ALTER COLUMN uuid_versao DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'produto_pedido_um_destino'
          AND conrelid = 'mapoteca.produto_pedido'::regclass
    ) THEN
        -- A RN08 nao morre: ela deixa de dizer "todo item aponta o acervo" e passa
        -- a dizer "todo item aponta EXATAMENTE UM produto identificado". O XOR e o
        -- que impede item sem destino e item com os dois.
        ALTER TABLE mapoteca.produto_pedido
            ADD CONSTRAINT produto_pedido_um_destino
            CHECK ((uuid_versao IS NOT NULL) <> (produto_avulso_id IS NOT NULL));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS produto_pedido_produto_avulso_id_idx
    ON mapoteca.produto_pedido (produto_avulso_id);

COMMIT;

-- Para desfazer (so vale enquanto nenhum item usar o avulso):
--   ALTER TABLE mapoteca.produto_pedido DROP CONSTRAINT IF EXISTS produto_pedido_um_destino;
--   DROP INDEX IF EXISTS mapoteca.produto_pedido_produto_avulso_id_idx;
--   ALTER TABLE mapoteca.produto_pedido DROP COLUMN IF EXISTS produto_avulso_id;
--   UPDATE mapoteca.produto_pedido SET uuid_versao = uuid_versao;  -- confirmar que nao ha nulo
--   ALTER TABLE mapoteca.produto_pedido ALTER COLUMN uuid_versao SET NOT NULL;
--   DROP TABLE IF EXISTS mapoteca.produto_avulso;
