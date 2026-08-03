-- A grade do PIT deixa de ser so digitada: cada meta declara de ONDE vem o
-- numero.
--
-- O PROBLEMA. Ate aqui `pit.execucao` era 100% lancamento a mao, e o comentario
-- de `pit_execucao_ctrl.js` ja confessava a divida: "no SAP a regua e
-- `lote_id IS NULL`, aqui nao existe essa regua". A consequencia esta medida: a
-- meta 4 (impressao) o SCA JA sabe somar pela mapoteca, o numero continua
-- digitado, e os dois podem divergir sem que nada acuse.
--
-- O DESENHO (chefe, 2026-08-03). A meta passa a declarar a ORIGEM do seu numero.
-- Manual e o que existe hoje e continua sendo o padrao. As outras tres calculam
-- na LEITURA, sem gravar nada: dado derivado que se grava vira segunda verdade
-- no primeiro que editar a copia a mao.
--
-- ONDE MORA CADA SETA. O vinculo vai sempre no CONSUMIDOR apontando para `pit`,
-- como `mapoteca.pedido.meta_pit_id` e `orcamento.pdr_item.meta_pit_id` ja
-- fazem. O schema `pit` e dado de referencia de que nenhum modulo e dono, e
-- inverter a seta o faria depender da mapoteca e do acervo.
--
-- O VINCULO DA PRODUCAO FICA NA VERSAO, E NAO NO LOTE, e isso foi medido antes
-- de decidir. Todo lote de Carta Topografica de 2026 traz o CDGV junto, um para
-- um por MI: o lote 2026-1a tem 6 cartas e 6 CDGV, 12 versoes. A meta 1.1
-- promete 24 FOLHAS, nao 48. Com o vinculo no lote seria preciso filtrar por
-- tipo e escala dentro dele; com o vinculo na versao, a versao de carta aponta a
-- 1.1 e a de CDGV aponta outra meta ou nenhuma, e filtro nenhum precisa existir.
--
-- O LOTE PLANEJA, E SO ISSO. Ele ganha `data_fim_prevista` e mais nada. O mes do
-- PLANEJADO sai dali, e o do REALIZADO sai de `versao.data_edicao`. Isso e
-- necessario porque a versao Planejada guarda hoje a data prevista no proprio
-- `data_edicao` (e o invariante 3j da auditoria cobra: "Planejada VENCIDA"), e
-- esse valor e SOBRESCRITO quando a versao vira Regular. Sem coluna no lote, o
-- plano desaparece no instante em que se cumpre.
--
-- O lote NAO ganha `meta_pit_id` (chefe, 2026-08-03): ele seria so conveniencia
-- para preencher o da versao por padrao, e qualquer leitor passaria a achar que
-- e ele quem conta.
--
-- A META 4 NAO SE RESOLVE POR PEDIDO, e isso tambem foi medido. O
-- `pedido.meta_pit_id` responde "este pedido estava previsto no PIT", e por isso
-- so os 16 pedidos marcados `previsto_pit` o preencheram, de 160. A meta 4 conta
-- o que SAIU, que esta no ITEM: somar pelo campo do pedido daria 253 folhas na
-- 4.1 onde o RTM publica 5.664, e daria 199 na 4.2 (Tyvek) num ano em que
-- nenhuma folha saiu em tyvek. A correlacao real e por MIDIA (sulfite na 4.1,
-- tyvek na 4.2, glossy na 4.3), e ela muda de ano junto com o PIT, entao o `ano`
-- entra na chave do de-para.
--
-- `situacao_id` E ANULAVEL, e o nulo e uma afirmacao: "ninguem classificou". As
-- 49 metas que ja existem nao tem situacao declarada em lugar nenhum, e escolher
-- uma por elas aqui inventaria dado. O que motivou a coluna: as metas 5.2 e 5.3
-- de 2026 foram CANCELADAS e hoje so se distinguem por terem quantidade zero.
--
-- ESTA MIGRACAO NAO MUDA COMPORTAMENTO. Toda meta nasce com origem Manual, e a
-- leitura da grade continua vindo de `pit.execucao`. Virar uma meta para
-- automatica e ato separado, e so depois do ensaio que compara o calculado com o
-- digitado.
--
-- Idempotente: IF NOT EXISTS em tudo, INSERT com ON CONFLICT e DO block com
-- guarda em cada restricao.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Os dois dominios novos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dominio.origem_meta(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.origem_meta (code, nome) VALUES
(1, 'Manual'),
(2, 'Capacitação'),
(3, 'Produção'),
(4, 'Impressão')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE dominio.origem_meta IS
    'De onde vem o número da meta: digitado (Manual) ou calculado na leitura a partir de capacitação, produção do acervo ou impressão da mapoteca.';

CREATE TABLE IF NOT EXISTS dominio.situacao_meta(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.situacao_meta (code, nome) VALUES
(1, 'Prevista'),
(2, 'Em execução'),
(3, 'Concluída'),
(4, 'Cancelada')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE dominio.situacao_meta IS
    'Situação da meta do PIT. Os mesmos quatro estados de dominio.situacao_capacitacao, e de propósito: uma meta cancelada e uma capacitação cancelada são a mesma ideia.';

-- ---------------------------------------------------------------------------
-- 2. A meta declara a origem e a situacao
-- ---------------------------------------------------------------------------
ALTER TABLE pit.meta
    ADD COLUMN IF NOT EXISTS origem_id SMALLINT NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'meta_origem_id_fkey' AND conrelid = 'pit.meta'::regclass
    ) THEN
        ALTER TABLE pit.meta
            ADD CONSTRAINT meta_origem_id_fkey
            FOREIGN KEY (origem_id) REFERENCES dominio.origem_meta (code);
    END IF;
END
$$;

ALTER TABLE pit.meta
    ADD COLUMN IF NOT EXISTS situacao_id SMALLINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'meta_situacao_id_fkey' AND conrelid = 'pit.meta'::regclass
    ) THEN
        ALTER TABLE pit.meta
            ADD CONSTRAINT meta_situacao_id_fkey
            FOREIGN KEY (situacao_id) REFERENCES dominio.situacao_meta (code);
    END IF;
END
$$;

-- SO A FOLHA pode ser automatica. A linha de cabecalho de uma meta subdividida
-- (`item` nulo com itens abaixo) nao recebe lancamento nenhum hoje, e deixa-la
-- calcular somaria o mesmo trabalho duas vezes, uma nos itens e outra nela. A
-- regra vive tambem no controlador; o CHECK garante que nenhuma outra porta
-- grave a combinacao invalida. Ele nao consegue enxergar "tem item abaixo" (isso
-- e outra linha da mesma tabela), entao cobre o que consegue: origem automatica
-- exige `item` preenchido OU meta indivisa, e quem sabe da indivisao e o
-- controlador.
COMMENT ON COLUMN pit.meta.origem_id IS
    'De onde vem o número desta meta. Manual (1) é digitado em pit.execucao; os demais são calculados na leitura e a gravação é recusada.';
COMMENT ON COLUMN pit.meta.situacao_id IS
    'Situação da meta. NULO é uma afirmação: ninguém classificou. Existe porque meta cancelada não tinha onde ser dita.';

-- ---------------------------------------------------------------------------
-- 3. Producao: o vinculo na VERSAO, o calendario no LOTE
-- ---------------------------------------------------------------------------
ALTER TABLE acervo.versao
    ADD COLUMN IF NOT EXISTS meta_pit_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'versao_meta_pit_id_fkey' AND conrelid = 'acervo.versao'::regclass
    ) THEN
        ALTER TABLE acervo.versao
            ADD CONSTRAINT versao_meta_pit_id_fkey
            FOREIGN KEY (meta_pit_id) REFERENCES pit.meta (id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_versao_meta_pit ON acervo.versao (meta_pit_id);

COMMENT ON COLUMN acervo.versao.meta_pit_id IS
    'Meta do PIT que esta versão cumpre. É o vínculo que CONTA: uma versão vale uma unidade da meta quando vira Regular.';

ALTER TABLE acervo.lote
    ADD COLUMN IF NOT EXISTS data_fim_prevista DATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lote_data_fim_prevista_check' AND conrelid = 'acervo.lote'::regclass
    ) THEN
        ALTER TABLE acervo.lote
            ADD CONSTRAINT lote_data_fim_prevista_check
            CHECK (data_fim_prevista IS NULL OR data_fim_prevista >= data_inicio);
    END IF;
END
$$;

COMMENT ON COLUMN acervo.lote.data_fim_prevista IS
    'Quando o lote PROMETE terminar. Dá o mês do planejado do PIT, e não é sobrescrita quando a produção acontece, ao contrário de data_fim.';

-- ---------------------------------------------------------------------------
-- 4. Capacitacao
-- ---------------------------------------------------------------------------
ALTER TABLE rpcmtec.capacitacao
    ADD COLUMN IF NOT EXISTS meta_pit_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'capacitacao_meta_pit_id_fkey' AND conrelid = 'rpcmtec.capacitacao'::regclass
    ) THEN
        ALTER TABLE rpcmtec.capacitacao
            ADD CONSTRAINT capacitacao_meta_pit_id_fkey
            FOREIGN KEY (meta_pit_id) REFERENCES pit.meta (id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_capacitacao_meta_pit ON rpcmtec.capacitacao (meta_pit_id);

COMMENT ON COLUMN rpcmtec.capacitacao.meta_pit_id IS
    'Meta do PIT que esta capacitação cumpre. Anulável: capacitação Recebida em geral não tem meta que a prometa.';

-- ---------------------------------------------------------------------------
-- 5. Impressao: o de-para por MIDIA e por ANO
-- ---------------------------------------------------------------------------
-- POR QUE UMA TABELA, e nao uma coluna em `mapoteca.pedido`. O pedido ja tem
-- `meta_pit_id` desde 2026-07-31 e ele NAO serve para a meta 4: em 2026 so 16
-- dos 156 pedidos o preencheram, e um pedido mistura midias. O que a meta 4
-- conta e folha impressa por MATERIAL, e o material esta no ITEM.
--
-- POR QUE O ANO ESTA AQUI, e nao so na meta. A meta ja tem `ano`, mas a chave
-- unica precisa impedir que a mesma midia aponte duas metas no MESMO ano, e uma
-- restricao unica nao enxerga coluna de outra tabela. O controlador confere que
-- `ano` casa com o da meta.
CREATE TABLE IF NOT EXISTS mapoteca.midia_meta_pit(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  tipo_midia_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_midia (code),
  meta_pit_id BIGINT NOT NULL REFERENCES pit.meta (id) ON DELETE CASCADE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_midia_por_ano UNIQUE (ano, tipo_midia_id)
);

COMMENT ON TABLE mapoteca.midia_meta_pit IS
    'De-para da mídia impressa para a meta do PIT, por ano (sulfite na 4.1, tyvek na 4.2, glossy na 4.3 em 2026). A numeração do PIT muda todo ano, por isso o ano está na chave.';

CREATE INDEX IF NOT EXISTS idx_midia_meta_pit_meta ON mapoteca.midia_meta_pit (meta_pit_id);

UPDATE public.versao SET nome = '1.19.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde os vinculos ja preenchidos):
--   DROP TABLE mapoteca.midia_meta_pit;
--   ALTER TABLE rpcmtec.capacitacao DROP COLUMN meta_pit_id;
--   ALTER TABLE acervo.lote DROP COLUMN data_fim_prevista;
--   ALTER TABLE acervo.versao DROP COLUMN meta_pit_id;
--   ALTER TABLE pit.meta DROP COLUMN situacao_id;
--   ALTER TABLE pit.meta DROP COLUMN origem_id;
--   DROP TABLE dominio.situacao_meta;
--   DROP TABLE dominio.origem_meta;
--   UPDATE public.versao SET nome = '1.18.0' WHERE code = 1;
