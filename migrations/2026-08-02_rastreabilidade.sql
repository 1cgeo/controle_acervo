-- Schema novo: auditoria, com a tabela auditoria.evento.
--
-- POR QUE. Ate hoje o sistema so guardava historico do PEDIDO da mapoteca
-- (mapoteca.pedido_auditoria, 2026-07-30). Todo o resto -- produto, versao e
-- arquivo do acervo, nota de credito, nota de empenho e liquidacao do orcamento,
-- cliente, plotter e material da mapoteca, e o cadastro de USUARIO e a concessao
-- de PERFIL -- guardava no maximo o ULTIMO que mexeu, numa coluna de
-- escrituracao que a alteracao seguinte sobrescreve. Promover alguem a
-- administrador global nao deixava rastro nenhum.
--
-- POR QUE NAO E GATILHO. Decisao do chefe, 2026-07-30, repetida em 2026-08-02.
-- O gatilho nao conhece o usuario da sessao HTTP: o Postgres ve a conexao do
-- pool. O detalhe do desenho esta no cabecalho de er/auditoria.sql e na secao
-- "Rastreabilidade das alteracoes" do CLAUDE.md.
--
-- O DDL e IDENTICO ao do er/auditoria.sql, senao instalacao nova divergiria da
-- migrada e o migrations/ensaiar_migracao.cjs reprovaria. Os nomes de indice
-- tambem.
--
-- Idempotente (IF NOT EXISTS). So ADICIONA; nada existente muda. A migracao dos
-- dados de mapoteca.pedido_auditoria e a proxima
-- (2026-08-02_rastreabilidade_pedido.sql), separada de proposito: esta aqui e
-- reversivel por um DROP SCHEMA, aquela mexe em dado que ja existe.
--
-- Ensaio (a CADEIA das duas, e nao uma de cada vez):
--   node migrations/ensaiar_migracao.cjs
--     --migracao migrations/2026-08-02_rastreabilidade.sql,migrations/2026-08-02_rastreabilidade_pedido.sql
--     --novos er/auditoria.sql
--     --versao-anterior 1.12.0 --versao-esperada 1.14.0
--     --schemas auditoria,mapoteca --er-de HEAD
--
-- POR QUE AS DUAS JUNTAS. A primeira sozinha para em 1.13.0 e o er/ ja esta em
-- 1.14.0, entao o ensaio dela reprovaria na versao; e a segunda sozinha nao
-- provaria a SEQUENCIA, que e o que roda em producao. O ensaiar_migracao.cjs
-- passou a aceitar cadeia separada por virgula por causa deste par.
--
-- O `--er-de HEAD` e obrigatorio porque a segunda REMOVE do er/ uma tabela que o
-- banco anterior tinha: sem ele o "banco de ontem" nasce sem ela, a migracao de
-- dados nao acha nada para migrar e vira um no-op disfarcado de sucesso.
--
-- Ensaiado em 2026-08-02: 148 colunas, 69 restricoes e 42 indices conferidos, o
-- banco MIGRADO e o NOVO com o mesmo schema, e a cadeia passou duas vezes.

BEGIN;

CREATE SCHEMA IF NOT EXISTS auditoria;

CREATE TABLE IF NOT EXISTS auditoria.evento(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    modulo VARCHAR(20) NOT NULL,
    entidade VARCHAR(50) NOT NULL,
    entidade_id VARCHAR(64) NOT NULL,
    tabela VARCHAR(80) NOT NULL,
    registro_id VARCHAR(64),
    operacao CHAR(1) NOT NULL CHECK (operacao IN ('I','U','D')),
    dados_antes JSONB,
    dados_depois JSONB,
    campos_alterados TEXT[],
    -- SEM chave estrangeira para dgeo.usuario, de proposito: o rastro do que a
    -- pessoa fez nao pode cair junto com a pessoa apagada.
    usuario_uuid UUID,
    data_evento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    origem VARCHAR(20) NOT NULL DEFAULT 'web',
    rota VARCHAR(160),
    lote_id UUID,
    motivo TEXT
);

CREATE INDEX IF NOT EXISTS idx_evento_entidade
    ON auditoria.evento(modulo, entidade, entidade_id, data_evento DESC);

CREATE INDEX IF NOT EXISTS idx_evento_usuario
    ON auditoria.evento(usuario_uuid, data_evento DESC);

CREATE INDEX IF NOT EXISTS idx_evento_data
    ON auditoria.evento(data_evento DESC);

CREATE INDEX IF NOT EXISTS idx_evento_lote
    ON auditoria.evento(lote_id) WHERE lote_id IS NOT NULL;

-- O GRANT do er/permissao.sql vale para o que existia NA HORA em que ele rodou:
-- `ALL TABLES IN SCHEMA` nao alcanca schema nem tabela criados depois. Sem isto,
-- a primeira escrita apos a migracao falha com "permission denied" -- e como a
-- auditoria roda DENTRO da transacao da mudanca, ela derrubaria a operacao
-- inteira, que e o comportamento desejado e um jeito pessimo de descobrir isto.
--
-- SELECT e INSERT apenas, como no er/permissao.sql: sem UPDATE e sem DELETE.
-- Uma trilha que a propria aplicacao pode reescrever nao prova nada.
--
-- O usuario da aplicacao e identificado como o dono do schema `dgeo`, que e o
-- mesmo criterio da migracao de 2026-08-02_autenticacao_local.sql.
DO $$
DECLARE
  app_user TEXT;
BEGIN
  SELECT nspowner::regrole::text INTO app_user
  FROM pg_namespace WHERE nspname = 'dgeo';

  IF app_user IS NOT NULL THEN
    EXECUTE format('GRANT USAGE ON SCHEMA auditoria TO %I', app_user);
    EXECUTE format('GRANT SELECT, INSERT ON auditoria.evento TO %I', app_user);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE auditoria.evento_id_seq TO %I', app_user);
  END IF;
END $$;

UPDATE public.versao SET nome = '1.13.0' WHERE code = 1;

COMMIT;

-- Para desfazer:
--   DROP SCHEMA IF EXISTS auditoria CASCADE;
--   UPDATE public.versao SET nome = '1.12.0' WHERE code = 1;
