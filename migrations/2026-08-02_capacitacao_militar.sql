-- Quem participou da capacitacao deixa de ser TEXTO e passa a ser o CADASTRO.
--
-- O PROBLEMA. `rpcmtec.capacitacao.militares` era um TEXT com os nomes digitados
-- a mao. Texto livre nao casa com pessoa: "Cap Fulano" e "Fulano" sao a mesma
-- pessoa e duas strings, e nenhuma das duas responde "de quais capacitacoes o
-- Fulano participou". Era o mesmo defeito do `atividades` do efetivo, que saiu
-- horas antes por intervalo.
--
-- A SAIDA: `rpcmtec.capacitacao_militar`, ligando a
-- capacitacao a `dgeo.usuario`. Vale para os DOIS tipos, e o PAPEL vem do
-- `tipo_id` da capacitacao em vez de ser coluna:
--
--   MINISTRADA  quem esta ligado e INSTRUTOR ou monitor (nos ensinamos)
--   RECEBIDA    quem esta ligado foi CAPACITADO (nos aprendemos)
--
-- Uma coluna de papel seria a mesma informacao gravada duas vezes, e nada
-- impediria as duas de divergirem.
--
-- `efetivo_capacitado` NAO sai e nao se confunde com a tabela nova: la e a
-- contagem de gente DE FORA que nos treinamos, e aqui e gente NOSSA. Numa
-- ministrada as duas coisas coexistem, e o relatorio pede as duas.
--
-- A COLUNA ANTIGA E APAGADA, e nao convertida. Converter exigiria adivinhar qual
-- pessoa do cadastro cada nome digitado quer dizer, e adivinhar errado aqui poe
-- a capacitacao de alguem na ficha de outra pessoa. A guarda abaixo aborta a
-- migracao se houver texto gravado, para ninguem perder dado em silencio: quem
-- tiver, anota antes e refaz o vinculo pela tela.
--
-- Idempotente: IF NOT EXISTS e DO blocks que conferem antes de agir.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Guarda: nao apagar nome de ninguem em silencio
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    linhas INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'rpcmtec' AND table_name = 'capacitacao'
          AND column_name = 'militares'
    ) THEN
        EXECUTE $q$
            SELECT COUNT(*) FROM rpcmtec.capacitacao
            WHERE militares IS NOT NULL AND btrim(militares) <> ''
        $q$ INTO linhas;

        IF linhas > 0 THEN
            RAISE EXCEPTION
                'Migracao abortada: % capacitacao(oes) com militares em texto. A conversao para vinculo exigiria adivinhar quem e quem no cadastro. Anote os nomes, limpe a coluna e reaplique.',
                linhas;
        END IF;
    END IF;
END
$$;

ALTER TABLE rpcmtec.capacitacao DROP COLUMN IF EXISTS militares;

-- ---------------------------------------------------------------------------
-- 2. O vinculo
-- ---------------------------------------------------------------------------
-- ON DELETE CASCADE no `capacitacao_id`: vinculo sem capacitacao nao e historico
-- de nada. Mesma razao do `dgeo.usuario_perfil`. No `usuario_uuid` NAO ha
-- cascade, e isso e deliberado: quem ja participou de uma capacitacao nao se
-- apaga, se DESATIVA, e a FK e mais uma razao para a exclusao falhar.
CREATE TABLE IF NOT EXISTS rpcmtec.capacitacao_militar(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  capacitacao_id BIGINT NOT NULL REFERENCES rpcmtec.capacitacao (id) ON DELETE CASCADE,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  UNIQUE (capacitacao_id, usuario_uuid)
);

COMMENT ON TABLE rpcmtec.capacitacao_militar IS
    'Quem da Divisão participou da capacitação. O papel vem do tipo dela: instrutor na ministrada, capacitado na recebida.';

CREATE INDEX IF NOT EXISTS idx_capacitacao_militar_usuario
    ON rpcmtec.capacitacao_militar (usuario_uuid);

-- ---------------------------------------------------------------------------
-- 3. Acesso a tabela nova
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  app_user TEXT;
BEGIN
  SELECT nspowner::regrole::text INTO app_user
  FROM pg_namespace WHERE nspname = 'dgeo';

  IF app_user IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON rpcmtec.capacitacao_militar TO %I',
    app_user);
  EXECUTE format(
    'GRANT USAGE, SELECT ON SEQUENCE rpcmtec.capacitacao_militar_id_seq TO %I',
    app_user);
END $$;

UPDATE public.versao SET nome = '1.17.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde os vinculos):
--   DROP TABLE IF EXISTS rpcmtec.capacitacao_militar;
--   ALTER TABLE rpcmtec.capacitacao ADD COLUMN militares TEXT;
--   UPDATE public.versao SET nome = '1.16.0' WHERE code = 1;
