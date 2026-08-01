-- O RPCMTec sai de dentro do modulo orcamento.
--
-- O PROBLEMA. Ate 2026-08-01 o relatorio era gerado em DOIS lugares que nao se
-- conheciam: `server/src/relatorio/` (acervo e mapoteca) e
-- `server/src/orcamento/relatorio/` (o PDR). Cada um tinha a propria numeracao
-- de secao, o proprio DOCX e a propria tela, e quem montava a edicao mensal
-- juntava os dois arquivos a mao, no Word, todo mes. A tabela da edicao morava
-- em `orcamento.relatorio_rpcmtec`, entao quem so tinha perfil na mapoteca nao
-- alcancava a edicao do relatorio que ele mesmo alimenta.
--
-- O RPCMTec e o relatorio mensal da DIVISAO: a mesma edicao fala das tres
-- coisas e o chefe assina uma so. Mesmo criterio que tirou `pit.meta` do
-- orcamento em 2026-07-31 e `limites` do acervo em 2026-07-29 -- dado de que
-- nenhum modulo e dono mora fora deles.
--
-- O QUE MUDA. `orcamento.relatorio_rpcmtec` vira `rpcmtec.edicao`. A tabela e a
-- MESMA (SET SCHEMA move os dados, as sequences e as chaves estrangeiras), entao
-- nao ha copia nem janela em que as duas existam com conteudos diferentes.
--
-- Aditiva e idempotente, como toda migracao daqui: rodar duas vezes nao quebra.
--
-- Para desfazer: ALTER TABLE rpcmtec.edicao RENAME TO relatorio_rpcmtec;
--                ALTER TABLE rpcmtec.relatorio_rpcmtec SET SCHEMA orcamento;
--                DROP SCHEMA rpcmtec;

BEGIN;

CREATE SCHEMA IF NOT EXISTS rpcmtec;

COMMENT ON SCHEMA rpcmtec IS
    'Relatório de Prestação de Contas Mensal Técnico: a edição mensal da Divisão. Cruza acervo, mapoteca e orçamento, e nenhum dos três é dono.';

DO $$
BEGIN
  -- Move a tabela, se ela ainda estiver no orcamento. O IF cobre o banco que ja
  -- migrou e o banco recem-instalado por er/rpcmtec.sql, que nunca teve a
  -- tabela no orcamento.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'orcamento' AND table_name = 'relatorio_rpcmtec'
  ) THEN
    ALTER TABLE orcamento.relatorio_rpcmtec SET SCHEMA rpcmtec;
    ALTER TABLE rpcmtec.relatorio_rpcmtec RENAME TO edicao;
  END IF;
END $$;

-- Instalacao que nunca teve a tabela (banco novo criado antes de er/rpcmtec.sql
-- entrar na ordem do create_config.js): cria do zero, igual ao er/.
CREATE TABLE IF NOT EXISTS rpcmtec.edicao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  assinante VARCHAR(255),
  data_assinatura DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_edicao_ano_mes UNIQUE (ano, mes)
);

COMMENT ON TABLE rpcmtec.edicao IS
    'Metadado da edição mensal do RPCMTec (quem assina, quando). As tabelas do relatório são consultas recortadas por ano e mês, nunca gravadas.';

-- ACERTO DE NOMES DE RESTRICAO. O `SET SCHEMA` move a tabela com as restricoes
-- que ela tinha, e os nomes delas foram gerados pelo Postgres a partir do nome
-- ANTIGO: `relatorio_rpcmtec_pkey`, `relatorio_rpcmtec_ano_mes_key`,
-- `relatorio_rpcmtec_usuario_*_fkey`. Uma instalacao nova pelo er/rpcmtec.sql
-- gera `edicao_pkey`, `unique_edicao_ano_mes` e `edicao_usuario_*_fkey`.
--
-- Sem este bloco, banco MIGRADO e banco NOVO ficam com nomes diferentes para as
-- mesmas restricoes, e o `ensaiar_migracao.cjs` reprova -- com razao: e assim
-- que um `ON CONFLICT ON CONSTRAINT` ou um `DROP CONSTRAINT` passa a funcionar
-- num banco e falhar no outro. Medido em 2026-08-01, com os dois caminhos.
DO $$
DECLARE
  par RECORD;
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      ('relatorio_rpcmtec_pkey', 'edicao_pkey'),
      ('relatorio_rpcmtec_ano_mes_key', 'unique_edicao_ano_mes'),
      ('relatorio_rpcmtec_usuario_cadastramento_uuid_fkey', 'edicao_usuario_cadastramento_uuid_fkey'),
      ('relatorio_rpcmtec_usuario_modificacao_uuid_fkey', 'edicao_usuario_modificacao_uuid_fkey')
    ) AS t(antigo, novo)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = par.antigo AND conrelid = 'rpcmtec.edicao'::regclass
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = par.novo AND conrelid = 'rpcmtec.edicao'::regclass
    ) THEN
      EXECUTE format('ALTER TABLE rpcmtec.edicao RENAME CONSTRAINT %I TO %I', par.antigo, par.novo);
    END IF;
  END LOOP;
END $$;

-- O indice da PK acompanha o nome da restricao no rename acima. O idx_edicao_ano
-- e criado logo adiante; o indice herdado do nome antigo, se houver, sai aqui.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_relatorio_rpcmtec_ano')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_edicao_ano') THEN
    ALTER INDEX rpcmtec.idx_relatorio_rpcmtec_ano RENAME TO idx_edicao_ano;
  END IF;
END $$;

-- O CHECK do mes nao existia na tabela antiga. Adicionado por NOT VALID e
-- validado em seguida: se algum registro historico tiver mes fora de 1..12, a
-- validacao falha e a migracao para, que e o certo -- dado invalido tem de
-- aparecer, nao de ser aceito calado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edicao_mes_check') THEN
    ALTER TABLE rpcmtec.edicao ADD CONSTRAINT edicao_mes_check CHECK (mes BETWEEN 1 AND 12) NOT VALID;
    ALTER TABLE rpcmtec.edicao VALIDATE CONSTRAINT edicao_mes_check;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_edicao_ano ON rpcmtec.edicao (ano);

-- O usuario da aplicacao precisa do schema novo. Sem isto o backend sobe e
-- quebra no primeiro acesso a edicao, com "permission denied for schema".
DO $$
DECLARE
  app_user TEXT;
BEGIN
  -- O dono do schema orcamento e o usuario da aplicacao: e ele que recebeu os
  -- grants do er/permissao.sql na instalacao.
  SELECT nspowner::regrole::text INTO app_user
  FROM pg_namespace WHERE nspname = 'orcamento';

  IF app_user IS NOT NULL THEN
    EXECUTE format('GRANT USAGE ON SCHEMA rpcmtec TO %I', app_user);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rpcmtec TO %I', app_user);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA rpcmtec TO %I', app_user);
  END IF;
END $$;

UPDATE public.versao SET nome = '1.11.0' WHERE code = 1;

COMMIT;
