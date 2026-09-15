-- A CAPACITACAO TAMBEM TEM FOTO E VIDEO, como a atividade de campo ja tinha.
--
-- O PEDIDO E DO CHEFE, 2026-09-15: nas duas telas de capacitacao (MINISTRADA, a
-- 2.6 do RPCMTec, e RECEBIDA, a 6.2) poder anexar foto e video do jeito que o
-- campo ja faz. Ate aqui o registro visual da instrucao que a Divisao deu, e do
-- curso que o militar fez, nao tinha onde morar: ficava no celular de quem foi,
-- ou no e-mail de quem pediu o relatorio.
--
-- ESPELHA `campo.imagem` COLUNA A COLUNA, e e a decisao que sustenta o resto. A
-- galeria da tela (tela cheia, envio em lote, edicao da descricao) e UMA so,
-- e ela le a mesma forma de linha nos dois lugares: `descricao`, `data_imagem`,
-- `tipo`, `mime_type` e o tamanho em bytes. Uma tabela com outro desenho
-- obrigaria a uma segunda galeria, e a que ficasse de fora da correcao seguinte
-- seria a que todo mundo ve.
--
-- UMA TABELA PARA OS DOIS TIPOS, porque `rpcmtec.capacitacao` tambem e uma so. O
-- recorte por tipo -- a rota da recebida nao alcanca a imagem de uma ministrada
-- -- e do CONTROLADOR, e nao da chave: e a mesma guarda que ja vale para a
-- capacitacao em si, pelo mesmo motivo (a permissao e por tipo, e a guarda da
-- rota nao enxerga o dado). Ver `rpcmtec_capacitacao_ctrl.js`.
--
-- OS BYTES FICAM NO BANCO, como `campo.imagem`, `rpcmtec.anexo_edicao`,
-- `pit.anexo_revisao` e `mapoteca.anexo_pedido` ja fazem. O teto por arquivo e o
-- do `express.json` (60mb), e o schema Joi o cobra antes: 58.720.256 caracteres
-- de base64, que sao ~42 MiB de binario. O mesmo numero do campo, lido do mesmo
-- lugar (`server/src/utils/midia.js`), para os dois nao divergirem.
--
-- NAO HA DADO A CONVERTER: a tabela nasce vazia. A tela e a unica porta de
-- entrada, e nao existe dump de origem como havia na travessia do campo.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS e um DO
-- block que confere o dono do schema antes de conceder.

BEGIN;

CREATE TABLE IF NOT EXISTS rpcmtec.capacitacao_imagem(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  capacitacao_id BIGINT NOT NULL REFERENCES rpcmtec.capacitacao (id) ON DELETE CASCADE,
  descricao TEXT,
  data_imagem DATE,
  -- Dois valores, e um CHECK em vez de tabela de dominio: 'foto' e 'video' nao
  -- sao um catalogo que cresce. O CHECK e o mesmo de `campo.imagem`, e os dois
  -- tem de dizer o mesmo.
  tipo VARCHAR(10) NOT NULL DEFAULT 'foto' CHECK (tipo IN ('foto', 'video')),
  mime_type VARCHAR(100),
  conteudo BYTEA NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE rpcmtec.capacitacao_imagem IS
    'Foto ou vídeo da capacitação, ministrada ou recebida. Os bytes ficam aqui, como todo anexo do SAP, e nunca saem numa listagem.';

CREATE INDEX IF NOT EXISTS idx_capacitacao_imagem_capacitacao
    ON rpcmtec.capacitacao_imagem (capacitacao_id);

-- ---------------------------------------------------------------------------
-- Acesso a tabela nova
-- ---------------------------------------------------------------------------
-- O mesmo bloco da migracao que criou `rpcmtec.capacitacao_militar`: sem o
-- GRANT, o usuario da aplicacao ve a tabela e nao escreve nela, e a primeira
-- foto enviada morre com "permission denied" num 500 sem explicacao.
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
    'GRANT SELECT, INSERT, UPDATE, DELETE ON rpcmtec.capacitacao_imagem TO %I',
    app_user);
  EXECUTE format(
    'GRANT USAGE, SELECT ON SEQUENCE rpcmtec.capacitacao_imagem_id_seq TO %I',
    app_user);
END $$;

UPDATE public.versao SET nome = '3.15.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde as fotos e os videos, que so existem aqui):
--   DROP TABLE IF EXISTS rpcmtec.capacitacao_imagem;
--   UPDATE public.versao SET nome = '3.14.0' WHERE code = 1;
