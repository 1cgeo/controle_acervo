-- A forma de entrega e a data de entrega sobem do ITEM para o PEDIDO.
--
-- POR QUE. Medido na producao em 2026-07-30: de 91 pedidos com item, so 1 tem
-- mais de uma forma de entrega e NENHUM tem mais de uma data. Os relatorios ja
-- tratavam os dois como nivel pedido, por COALESCE. O dado por item cobrava o
-- preco de dois campos em toda tela de item, e nao pagava nada em troca.
--
-- A DATA NAO GANHA COLUNA NOVA. O pedido ja tem data_atendimento, que o schema
-- documenta como o dia em que o material saiu daqui, e o mesmo schema recusa de
-- proposito uma coluna data_envio (ver 2026-07-29_pedido_observacao_interna).
-- A data de entrega do pedido ja existia, com outro nome.
--
-- DIVERGENCIA, decisao do chefe:
--  - Data: a data_atendimento do pedido MANDA e NAO se reescreve. Onde os itens
--    registram data diferente, a data antiga vai para observacao_interna. E
--    conferencia da equipe, e nao sai na consulta publica do cliente. Razao: a
--    data do pedido e a que o cliente ja ve, e 51 de 52 pedidos concluidos a
--    confirmam.
--  - Forma: vale a MAIORIA por contagem de itens; as outras vao para
--    observacao_envio, que SAI para o cliente e lhe e util. Na producao e um
--    caso so (26 itens em maos e 8 nos Correios).
--
-- SEM id de pedido no SQL, de proposito: maioria por contagem e divergencia por
-- comparacao. Id fixo quebraria em qualquer outra instalacao.
--
-- Idempotente: a coluna nova entra com IF NOT EXISTS, e os dois blocos de
-- backfill so rodam enquanto a coluna do item ainda existe. Reaplicar nao faz
-- nada.

BEGIN;

-- a) A coluna nova, no pedido.
ALTER TABLE mapoteca.pedido
    ADD COLUMN IF NOT EXISTS forma_entrega_id SMALLINT
        REFERENCES mapoteca.forma_entrega (code);

COMMENT ON COLUMN mapoteca.pedido.forma_entrega_id IS
    'Como o material do pedido saiu (Correios, em mãos, retirado). É do PEDIDO desde 2026-07-30: item com forma própria era exceção de 1 pedido em 91. Item entregue por outra forma se anota em observacao_envio.';

-- b) e c) A forma: maioria por contagem, divergencia para observacao_envio.
--
-- O bloco so roda enquanto produto_pedido.forma_entrega_id existir. Sem esta
-- guarda, reaplicar a migracao pararia no primeiro SELECT daquela coluna, que
-- o passo (f) ja apagou.
DO $forma$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca'
          AND table_name = 'produto_pedido'
          AND column_name = 'forma_entrega_id'
    ) THEN
        EXECUTE $sql$
            WITH contagem AS (
                SELECT pedido_id, forma_entrega_id, COUNT(*)::int AS itens
                FROM mapoteca.produto_pedido
                WHERE forma_entrega_id IS NOT NULL
                GROUP BY pedido_id, forma_entrega_id
            ),
            -- Empate se resolve pelo MENOR code, e nao por acaso: sem o segundo
            -- criterio de ordem o resultado dependeria do plano do Postgres, e
            -- duas instalacoes com o mesmo dado terminariam diferentes.
            maioria AS (
                SELECT DISTINCT ON (pedido_id) pedido_id, forma_entrega_id
                FROM contagem
                ORDER BY pedido_id, itens DESC, forma_entrega_id
            )
            UPDATE mapoteca.pedido p
               SET forma_entrega_id = m.forma_entrega_id
              FROM maioria m
             WHERE m.pedido_id = p.id
               -- Nao sobrescreve forma ja gravada no pedido: numa reaplicacao
               -- parcial ou numa instalacao que ja preencheu o campo, o valor
               -- do pedido manda.
               AND p.forma_entrega_id IS NULL
        $sql$;

        EXECUTE $sql$
            WITH contagem AS (
                SELECT pedido_id, forma_entrega_id, COUNT(*)::int AS itens
                FROM mapoteca.produto_pedido
                WHERE forma_entrega_id IS NOT NULL
                GROUP BY pedido_id, forma_entrega_id
            ),
            maioria AS (
                SELECT DISTINCT ON (pedido_id) pedido_id, forma_entrega_id
                FROM contagem
                ORDER BY pedido_id, itens DESC, forma_entrega_id
            ),
            outras AS (
                SELECT c.pedido_id,
                       string_agg(
                           fe.nome || ': ' || c.itens ||
                           CASE WHEN c.itens = 1 THEN ' item' ELSE ' itens' END,
                           '; ' ORDER BY c.itens DESC, fe.nome
                       ) AS texto
                FROM contagem c
                JOIN maioria m ON m.pedido_id = c.pedido_id
                JOIN mapoteca.forma_entrega fe ON fe.code = c.forma_entrega_id
                WHERE c.forma_entrega_id <> m.forma_entrega_id
                GROUP BY c.pedido_id
            )
            UPDATE mapoteca.pedido p
               SET observacao_envio =
                       COALESCE(NULLIF(p.observacao_envio, '') || E'\n', '') ||
                       'Parte dos itens saiu por outra forma de entrega (' ||
                       o.texto || ').'
              FROM outras o
             WHERE o.pedido_id = p.id
        $sql$;
    END IF;
END
$forma$;

-- d) e e) A data: preenche o que falta e anota o que diverge.
DO $data$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca'
          AND table_name = 'produto_pedido'
          AND column_name = 'data_entrega'
    ) THEN
        -- d) Pedido sem data de atendimento herda a MAIOR data dos itens: o
        -- pedido fecha quando o ultimo item sai. Sao zero linhas na producao de
        -- hoje, mas a migracao roda em qualquer instalacao.
        --
        -- O "maior >= data_pedido" respeita o CHECK da tabela. Data de item
        -- anterior ao pedido e erro de digitacao, e grava-la abortaria a
        -- migracao inteira. O passo (e) registra o caso em observacao_interna,
        -- entao o dado nao se perde calado.
        EXECUTE $sql$
            UPDATE mapoteca.pedido p
               SET data_atendimento = d.maior
              FROM (
                SELECT pedido_id, MAX(data_entrega) AS maior
                FROM mapoteca.produto_pedido
                WHERE data_entrega IS NOT NULL
                GROUP BY pedido_id
              ) d
             WHERE d.pedido_id = p.id
               AND p.data_atendimento IS NULL
               AND d.maior >= p.data_pedido
        $sql$;

        -- e) Toda data de item que ainda diverge da data do pedido vira nota
        -- INTERNA. Interna porque e conferencia da equipe: o cliente ja viu a
        -- data_atendimento, e mostrar-lhe uma segunda data so o confunde.
        -- IS DISTINCT FROM, e nao <>: pega tambem o pedido que ficou sem
        -- data_atendimento no passo (d).
        EXECUTE $sql$
            WITH datas AS (
                SELECT pp.pedido_id, pp.data_entrega, COUNT(*)::int AS itens
                FROM mapoteca.produto_pedido pp
                JOIN mapoteca.pedido p ON p.id = pp.pedido_id
                WHERE pp.data_entrega IS NOT NULL
                  AND pp.data_entrega IS DISTINCT FROM p.data_atendimento
                GROUP BY pp.pedido_id, pp.data_entrega
            ),
            nota AS (
                SELECT pedido_id,
                       string_agg(
                           to_char(data_entrega, 'DD/MM/YYYY') || ': ' || itens ||
                           CASE WHEN itens = 1 THEN ' item' ELSE ' itens' END,
                           '; ' ORDER BY data_entrega
                       ) AS texto
                FROM datas
                GROUP BY pedido_id
            )
            UPDATE mapoteca.pedido p
               SET observacao_interna =
                       COALESCE(NULLIF(p.observacao_interna, '') || E'\n', '') ||
                       'Data de entrega registrada por item até 2026-07-30, ' ||
                       'diferente da data de atendimento do pedido (' ||
                       n.texto || ').'
              FROM nota n
             WHERE n.pedido_id = p.id
        $sql$;
    END IF;
END
$data$;

-- f) As duas colunas saem do item.
DROP INDEX IF EXISTS mapoteca.idx_produto_pedido_data_entrega;

ALTER TABLE mapoteca.produto_pedido
    DROP COLUMN IF EXISTS forma_entrega_id,
    DROP COLUMN IF EXISTS data_entrega;

COMMIT;

-- Para desfazer:
--   ALTER TABLE mapoteca.produto_pedido
--       ADD COLUMN forma_entrega_id SMALLINT REFERENCES mapoteca.forma_entrega (code),
--       ADD COLUMN data_entrega DATE;
--   CREATE INDEX idx_produto_pedido_data_entrega ON mapoteca.produto_pedido(data_entrega);
--   ALTER TABLE mapoteca.pedido DROP COLUMN IF EXISTS forma_entrega_id;
--
-- ATENCAO: isso devolve as COLUNAS, e NAO o dado por item. A forma e a data que
-- cada item tinha estao PERDIDAS: o que sobra e a forma do pedido, a nota em
-- observacao_envio e a nota em observacao_interna. Quem precisar do valor
-- original tem de ir ao backup anterior a esta migracao.
