-- O Extra-PIT deixa de ser numero digitado e passa a apontar a producao que o
-- cumpriu.
--
-- O PROBLEMA. A 3.3 do RPCMTec ja saia de `pit.demanda_extra` desde 2026-08-02,
-- mas a linha nao provava nada: `quantidade` era digitada e `situacao_id` virava
-- 'Concluido' por decisao de quem editava. A producao que atendeu a excecao
-- estava no acervo, ao lado, sem nenhuma seta ligando as duas.
--
-- O DESENHO: "Entrega nao faz sentido, se fosse so entrega
-- entraria na mapoteca, o extra pit e a PRODUCAO". A demanda so fecha quando
-- materializa, e materializar quer dizer versao registrada no acervo.
--
-- O VINCULO FICA NA VERSAO, E NAO NO LOTE, e isso foi MEDIDO. O lote
-- `2026_1a_CT_Faxinal_Soturno_25k` tem seis cartas topograficas: quatro cumprem
-- a meta 1.1 e duas (2966-1-NE Dona Francisca, 2966-1-SE Agudo-O) sao as
-- demandas 11 e 12, produzidas para o CMS na Op. Arandu. Saiu tudo na mesma
-- corrida, no mesmo lote, na mesma data de edicao. A producao Extra-PIT mora
-- DENTRO de um lote do PIT, e por isso o lote nao pode ser o vinculo.
--
-- A EXCLUSAO E O QUE IMPEDE A CONTAGEM DUPLA. Uma folha cumpre a meta OU e a
-- excecao, nunca as duas. No SAP essa regra vivia em `extra_pit.lote_id`, para a
-- 2.1 nao contar duas vezes o mesmo trabalho; aqui ela vira um CHECK na versao,
-- que e a granularidade em que o problema existe de verdade.
--
-- `origem_id` REUSA `dominio.origem_meta`, com CHECK restringindo a Manual e
-- Producao. Um dominio proprio criaria um SEGUNDO codigo chamado 'Producao',
-- diferente do da meta, e quem lesse os dois lados teria de traduzir. A pergunta
-- que a coluna responde e a mesma da meta: de onde vem a prova desta linha.
--
-- Manual e para a excecao que nao gera produto de acervo, e ela existe: a
-- 'Exposicao do Dia do Exercito' e a 'Pista de orientacao com Chefe do DCT' de
-- 2026 nunca vao ter versao nenhuma. O padrao e Manual, entao esta migracao NAO
-- MUDA COMPORTAMENTO: nenhuma demanda passa a exigir materializacao ate alguem
-- declarar a origem.
--
-- SEM FK NO PEDIDO, pela mesma regua do chefe. O pedido e entrega, e a entrega e
-- a mapoteca. Do pedido ate a autorizacao ja ha caminho: item, versao, demanda.
-- Um FK direto seria um segundo caminho para a mesma verdade, e dois caminhos
-- divergem.
--
-- Idempotente: IF NOT EXISTS em tudo, e DO block com guarda em cada restricao.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A demanda declara de onde vem a prova dela.
-- ---------------------------------------------------------------------------

ALTER TABLE pit.demanda_extra
  ADD COLUMN IF NOT EXISTS origem_id SMALLINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demanda_extra_origem_id_fkey'
      AND conrelid = 'pit.demanda_extra'::regclass
  ) THEN
    ALTER TABLE pit.demanda_extra
      ADD CONSTRAINT demanda_extra_origem_id_fkey
      FOREIGN KEY (origem_id) REFERENCES dominio.origem_meta (code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demanda_extra_origem_manual_ou_producao'
      AND conrelid = 'pit.demanda_extra'::regclass
  ) THEN
    ALTER TABLE pit.demanda_extra
      ADD CONSTRAINT demanda_extra_origem_manual_ou_producao
      CHECK (origem_id IN (1, 3));
  END IF;
END $$;

COMMENT ON COLUMN pit.demanda_extra.origem_id IS
    'De onde vem a prova da demanda: Manual (1) para a excecao sem produto de acervo, Producao (3) para a que materializa em versao. Reusa dominio.origem_meta e aceita so esses dois codigos.';

-- ---------------------------------------------------------------------------
-- 2) A versao aponta a demanda que a encomendou.
-- ---------------------------------------------------------------------------

ALTER TABLE acervo.versao
  ADD COLUMN IF NOT EXISTS demanda_extra_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'versao_demanda_extra_id_fkey'
      AND conrelid = 'acervo.versao'::regclass
  ) THEN
    ALTER TABLE acervo.versao
      ADD CONSTRAINT versao_demanda_extra_id_fkey
      FOREIGN KEY (demanda_extra_id) REFERENCES pit.demanda_extra (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'versao_plano_ou_excecao'
      AND conrelid = 'acervo.versao'::regclass
  ) THEN
    ALTER TABLE acervo.versao
      ADD CONSTRAINT versao_plano_ou_excecao
      CHECK (meta_pit_id IS NULL OR demanda_extra_id IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN acervo.versao.demanda_extra_id IS
    'Demanda Extra-PIT que esta versao materializa. Exclusiva com meta_pit_id: a folha cumpre o plano OU e a excecao autorizada, nunca as duas.';

CREATE INDEX IF NOT EXISTS idx_versao_demanda_extra
  ON acervo.versao (demanda_extra_id);

UPDATE public.versao SET nome = '1.20.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde os vinculos ja preenchidos):
--   DROP INDEX acervo.idx_versao_demanda_extra;
--   ALTER TABLE acervo.versao DROP CONSTRAINT versao_plano_ou_excecao;
--   ALTER TABLE acervo.versao DROP COLUMN demanda_extra_id;
--   ALTER TABLE pit.demanda_extra DROP CONSTRAINT demanda_extra_origem_manual_ou_producao;
--   ALTER TABLE pit.demanda_extra DROP COLUMN origem_id;
--   UPDATE public.versao SET nome = '1.19.0' WHERE code = 1;
