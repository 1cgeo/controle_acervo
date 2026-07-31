-- A meta do PIT sai do orcamento e vira dado de REFERENCIA do sistema inteiro.
--
-- O PROBLEMA. A tabela nasceu em `orcamento` porque o primeiro consumidor foi o
-- PDR. Mas o PIT nao e um artefato orcamentario: e o plano anual da Divisao, e
-- todo modulo tem trabalho que atende uma meta dele. A mapoteca ja precisava
-- dela e nao podia usa-la: em 2026-07-30 o pedido ganhou `meta_pit VARCHAR(10)`,
-- texto livre, justamente porque a tabela morava no vizinho. Duas verdades sobre
-- a mesma coisa, uma sem cobranca nenhuma do banco.
--
-- A SAIDA. Schema proprio `pit`, pelo mesmo criterio do schema `limites`
-- (2026-07-29): dado que varios consomem e nenhum e dono nao mora dentro de um
-- consumidor. O nome da tabela perde o sufixo redundante (`pit.meta`, nao
-- `pit.meta_pit`). Decisao do chefe, 2026-07-31.
--
-- O QUE MUDA DE PERMISSAO. Ler passa a ser de qualquer pessoa logada, porque
-- todo modulo precisa oferecer a lista. Escrever passa a ser do administrador
-- global: o PIT muda uma vez por ano e errar nele contamina tres modulos. Antes
-- era consulta/operador/gerente DO ORCAMENTO, que deixava a mapoteca de fora.
--
-- AS FKs SEGUEM SOZINHAS. No PostgreSQL o ALTER TABLE ... SET SCHEMA carrega as
-- chaves estrangeiras que apontam para a tabela: orcamento.pdr_item e
-- orcamento.nota_credito continuam validas sem uma linha de DDL a mais.
--
-- OS SUB-ITENS DE 2026. As 7 metas de 2026 estao cadastradas no nivel da meta
-- (item NULO). Os codigos 4.1, 4.2 e 4.3, que a mapoteca usa desde sempre na
-- coluna "Meta" da planilha, nunca existiram como registro. Esta migracao os
-- cria, porque sem eles os 9 pedidos que hoje trazem '4.1'/'4.2' (medidos na
-- producao em 2026-07-31) nao teriam para onde apontar e o CHECK novo os
-- reprovaria. A descricao e a do documento
-- assinado (PIT 2026 do 1o CGEO, 1a revisao, 11 de maio de 2026), nao uma
-- deducao a partir do material.
--
-- O PIT 2026 tem 37 sub-itens ao todo (1.1 a 7.13). Esta migracao cadastra APENAS
-- os tres que a conversao exige. Carregar o PIT inteiro e cadastro de dado do
-- ano, e nao mudanca de estrutura: entra pela tela ou pelo CLI, com o documento
-- assinado a mao.
--
-- Idempotente: IF NOT EXISTS, ON CONFLICT DO NOTHING e DO blocks que conferem
-- antes de agir. Reaplicar nao faz nada.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Schema proprio e mudanca de casa
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS pit;

COMMENT ON SCHEMA pit IS
    'Plano Interno de Trabalho: o plano anual da Divisão. Dado de referência que orçamento, mapoteca e acervo consomem, e do qual nenhum é dono.';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'orcamento' AND tablename = 'meta_pit'
    ) THEN
        ALTER TABLE orcamento.meta_pit SET SCHEMA pit;
        ALTER TABLE pit.meta_pit RENAME TO meta;
    END IF;
END
$$;

-- O RENAME TO da TABELA nao renomeia nada que penda dela: a sequencia do
-- BIGSERIAL, a chave primaria, a unica, as NOT NULL e as duas estrangeiras
-- ficariam todas com o nome antigo. O banco funcionaria igual, mas o caminho de
-- ATUALIZACAO deixaria de convergir com o de INSTALACAO NOVA, e a proxima
-- migracao que citasse uma restricao pelo nome quebraria em um dos dois.
-- Medido pelo ensaiar_migracao.cjs, que acusou 24 divergencias sem este bloco.
DO $$
DECLARE
    nome TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'pit' AND indexname = 'idx_meta_pit_ano'
    ) THEN
        ALTER INDEX pit.idx_meta_pit_ano RENAME TO idx_meta_ano;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_class AS c
        INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'pit' AND c.relname = 'meta_pit_id_seq' AND c.relkind = 'S'
    ) THEN
        ALTER SEQUENCE pit.meta_pit_id_seq RENAME TO meta_id_seq;
    END IF;

    -- Renomear a restricao renomeia junto o indice que a sustenta (PK e UNIQUE).
    FOR nome IN
        SELECT c.conname
        FROM pg_constraint AS c
        WHERE c.conrelid = 'pit.meta'::regclass
          AND c.conname LIKE 'meta\_pit\_%'
    LOOP
        EXECUTE format(
            'ALTER TABLE pit.meta RENAME CONSTRAINT %I TO %I',
            nome, 'meta_' || substring(nome from length('meta_pit_') + 1)
        );
    END LOOP;
END
$$;

COMMENT ON TABLE pit.meta IS
    'Meta do PIT do ano. `item` guarda o sub-item quando a meta se subdivide (ex.: 4.1), e é NULO quando a meta é indivisa.';

-- ---------------------------------------------------------------------------
-- 2. Sub-itens da Meta 4 de 2026, que a mapoteca ja usava como texto
-- ---------------------------------------------------------------------------
-- O autor sai de uma meta de 2026 ja cadastrada: esta migracao nao inventa
-- pessoa. Sem nenhuma meta de 2026, nada e inserido aqui, e a guarda logo abaixo
-- reprova a migracao com a mensagem certa.
--
-- A busca do autor NAO filtra por `item`. A meta indivisa vale `item IS NULL` no
-- banco, e nao a string '-': o '-' e o que o CLI e a tela IMPRIMEM no lugar do
-- nulo. Filtrar por '-' aqui fez a primeira tentativa contra producao inserir
-- zero sub-itens, e a guarda abortou a transacao inteira, como devia.
INSERT INTO pit.meta (ano, numero_meta, item, descricao, usuario_cadastramento_uuid)
SELECT 2026, 4, sub.item, sub.descricao, m.usuario_cadastramento_uuid
FROM (VALUES
        ('4.1', 'Carta Topográfica, Carta Topográfica Especial e Carta Ortoimagem Especial (Sulfite)'),
        ('4.2', 'Carta Topográfica e Carta Ortoimagem (Tyvek)'),
        ('4.3', 'Carta Ortoimagem (Glossy)')
     ) AS sub(item, descricao)
CROSS JOIN LATERAL (
    SELECT usuario_cadastramento_uuid
    FROM pit.meta
    WHERE ano = 2026
    ORDER BY numero_meta, id
    LIMIT 1
) AS m
ON CONFLICT (ano, numero_meta, item) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. O pedido da mapoteca troca o texto livre pela chave estrangeira
-- ---------------------------------------------------------------------------
ALTER TABLE mapoteca.pedido
    ADD COLUMN IF NOT EXISTS meta_pit_id BIGINT REFERENCES pit.meta (id);

COMMENT ON COLUMN mapoteca.pedido.meta_pit_id IS
    'Meta do PIT que o pedido atende. Obrigatória quando previsto_pit é verdadeiro. Substituiu o texto livre meta_pit em 2026-07-31.';

-- Converte o que ja existe. O casamento e pelo codigo do item DENTRO do ano do
-- pedido: '4.1' de 2026 nao e '4.1' de 2027, e a numeracao do PIT muda todo ano.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca' AND table_name = 'pedido'
          AND column_name = 'meta_pit'
    ) THEN
        UPDATE mapoteca.pedido AS p
        SET meta_pit_id = m.id
        FROM pit.meta AS m
        WHERE p.meta_pit IS NOT NULL
          AND p.meta_pit_id IS NULL
          AND m.item = p.meta_pit
          AND m.ano = EXTRACT(YEAR FROM p.data_pedido)::SMALLINT;
    END IF;
END
$$;

-- Nenhum pedido pode sobrar com codigo gravado e sem meta correspondente: isso
-- seria perder dado calado, que e o defeito que esta migracao existe para nao
-- repetir. Aborta a transacao inteira se acontecer.
DO $$
DECLARE
    orfaos INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca' AND table_name = 'pedido'
          AND column_name = 'meta_pit'
    ) THEN
        SELECT COUNT(*) INTO orfaos
        FROM mapoteca.pedido
        WHERE meta_pit IS NOT NULL AND meta_pit_id IS NULL;

        IF orfaos > 0 THEN
            RAISE EXCEPTION
                'Migracao abortada: % pedido(s) com meta_pit sem meta correspondente em pit.meta. Cadastre a meta do ano antes de reaplicar.',
                orfaos;
        END IF;
    END IF;
END
$$;

-- O CHECK antigo cobrava a coluna de texto. O novo cobra a chave.
ALTER TABLE mapoteca.pedido
    DROP CONSTRAINT IF EXISTS pedido_meta_pit_exige_previsto;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pedido_meta_pit_id_exige_previsto'
          AND conrelid = 'mapoteca.pedido'::regclass
    ) THEN
        ALTER TABLE mapoteca.pedido
            ADD CONSTRAINT pedido_meta_pit_id_exige_previsto
            CHECK (NOT previsto_pit OR meta_pit_id IS NOT NULL);
    END IF;
END
$$;

ALTER TABLE mapoteca.pedido
    DROP COLUMN IF EXISTS meta_pit;

CREATE INDEX IF NOT EXISTS idx_pedido_meta_pit ON mapoteca.pedido (meta_pit_id);

-- ---------------------------------------------------------------------------
-- 4. Acesso ao schema novo
-- ---------------------------------------------------------------------------
-- O SET SCHEMA leva junto os privilegios DA TABELA e da sequencia dela. O que
-- nao viaja e o USAGE do SCHEMA, que e novo. Sem esta parte, o usuario da
-- aplicacao perde a tabela na hora em que ela troca de casa.
--
-- O papel somente leitura do QGIS (er/permissao_readonly.sql) NAO entra, pela
-- mesma razao de mapoteca e dgeo: nao ha camada de mapa aqui.
DO $$
DECLARE
    papel TEXT;
BEGIN
    FOR papel IN
        SELECT r.rolname
        FROM pg_roles AS r
        WHERE r.rolcanlogin
          AND NOT r.rolsuper
          AND has_schema_privilege(r.rolname, 'orcamento', 'USAGE')
    LOOP
        EXECUTE format('GRANT USAGE ON SCHEMA pit TO %I', papel);
    END LOOP;
END
$$;

UPDATE public.versao SET nome = '1.9.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde os sub-itens 4.1/4.2/4.3 criados aqui):
--   ALTER TABLE mapoteca.pedido ADD COLUMN meta_pit VARCHAR(10);
--   UPDATE mapoteca.pedido AS p SET meta_pit = m.item
--     FROM pit.meta AS m WHERE m.id = p.meta_pit_id;
--   ALTER TABLE mapoteca.pedido DROP CONSTRAINT pedido_meta_pit_id_exige_previsto;
--   ALTER TABLE mapoteca.pedido DROP COLUMN meta_pit_id;
--   ALTER TABLE mapoteca.pedido ADD CONSTRAINT pedido_meta_pit_exige_previsto
--     CHECK (NOT previsto_pit OR meta_pit IS NOT NULL);
--   ALTER TABLE pit.meta RENAME TO meta_pit;
--   ALTER TABLE pit.meta_pit SET SCHEMA orcamento;
--   DROP SCHEMA pit;
--   UPDATE public.versao SET nome = '1.8.0' WHERE code = 1;
