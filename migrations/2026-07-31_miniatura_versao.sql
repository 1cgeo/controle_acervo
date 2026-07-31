-- Miniatura da versao: a imagem que a ficha do produto mostra.
--
-- O PROBLEMA. A ficha do produto identifica a carta por texto: MI, INOM, escala
-- e a lista de arquivos. Quem procura uma folha no acervo reconhece a carta
-- OLHANDO, e a ficha nao dava nada para olhar. A miniatura resolve isso com o
-- que ja existe no volume: a pagina inteira do PDF, ou o TIF quando nao ha PDF.
--
-- POR QUE TABELA PROPRIA, E NAO COLUNA EM acervo.versao.
--   1. `SELECT v.*` aparece em varias consultas do acervo (a ficha detalhada, a
--      busca, o plugin). Uma coluna BYTEA em `versao` passaria a ser arrastada
--      por todas elas, para nada.
--   2. A miniatura tem PROCEDENCIA, e a versao nao tem onde guardar: de qual
--      arquivo saiu, com que checksum, quando. Sem isso nao da para saber se a
--      miniatura envelheceu em relacao ao arquivo que a gerou.
-- O precedente de BYTEA no banco ja existe (`orcamento.arquivo`,
-- `mapoteca.anexo_pedido`).
--
-- POR QUE A FALHA VIRA LINHA. Sao 4.379 versoes com PDF ou TIF, e parte delas
-- vai falhar (arquivo ausente no volume, PDF corrompido, TIF que a leitura nao
-- abre). Sem registrar a falha, toda reexecucao da carga tentaria de novo os
-- mesmos arquivos quebrados, para sempre. A linha existe entao em dois estados,
-- garantidos pelo CHECK: ou tem `conteudo`, ou tem `erro`. Nunca os dois, nunca
-- nenhum. A rota que serve a imagem responde 404 quando so ha `erro`.
--
-- POR QUE OS DOIS ON DELETE CASCADE. Miniatura e dado DERIVADO, nunca registro
-- a preservar. Sem CASCADE, a chave estrangeira faria o caminho de exclusao que
-- ja existe (apagar versao, apagar arquivo) passar a falhar por violacao de
-- restricao, quebrando codigo que hoje funciona. Com CASCADE, a miniatura morre
-- junto com a fonte, que e o comportamento certo: fonte que sumiu deixa a
-- miniatura mentindo. A carga seguinte regenera a partir do que sobrou.
--
-- Produto so vetorial (zip/sqlite) NAO entra: sao 2.247 versoes sem raster
-- nenhum para renderizar. Elas simplesmente nao tem linha aqui. Decisao do
-- chefe em 2026-07-31.

BEGIN;

CREATE TABLE IF NOT EXISTS acervo.miniatura_versao(
    -- PK na versao: uma miniatura por versao. Regerar e UPSERT, nunca acumular.
    versao_id BIGINT NOT NULL PRIMARY KEY REFERENCES acervo.versao (id) ON DELETE CASCADE,
    -- De qual arquivo a imagem saiu. Junto com o checksum, e o que permite a
    -- carga pular o que nao mudou e refazer o que mudou.
    arquivo_id BIGINT REFERENCES acervo.arquivo (id) ON DELETE CASCADE,
    checksum_origem VARCHAR(64),
    formato VARCHAR(10),
    -- Largura e altura viajam com a imagem para a tela reservar o espaco antes
    -- de decodificar. Sem elas a ficha pula quando a miniatura chega.
    largura INTEGER,
    altura INTEGER,
    conteudo BYTEA,
    erro TEXT,
    data_geracao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT miniatura_conteudo_ou_erro CHECK (
        (conteudo IS NOT NULL AND erro IS NULL
         AND formato IS NOT NULL AND largura IS NOT NULL AND altura IS NOT NULL)
        OR
        (conteudo IS NULL AND erro IS NOT NULL)
    )
);

COMMENT ON TABLE acervo.miniatura_versao IS
  'Miniatura derivada do PDF (ou do TIF) da versao, servida pela ficha do produto. Linha com erro registra a falha para a carga nao repetir o arquivo quebrado.';

-- A carga pergunta "que versoes ainda nao tem miniatura" por anti-join na PK, e
-- "quais tem erro para eu reprocessar" por este indice parcial, que so indexa a
-- minoria com falha.
CREATE INDEX IF NOT EXISTS idx_miniatura_versao_erro
  ON acervo.miniatura_versao (versao_id) WHERE erro IS NOT NULL;

-- O GRANT do `er/permissao_readonly.sql` usa ON ALL TABLES, que e um retrato do
-- momento da instalacao e nao alcanca tabela criada depois por migracao. Sem
-- esta linha, a instalacao nova e o banco migrado teriam permissoes diferentes.
-- O papel somente leitura serve as URIs de camada do QGIS; a miniatura nao lhe
-- serve para nada, mas divergir dos dois caminhos custa mais do que conceder
-- SELECT numa imagem derivada, sem dado pessoal.
-- A regra e "quem le a versao passa a ler a miniatura dela", e nao uma lista de
-- nomes: o nome do papel vem do `config.env` (DB_USER_READONLY) e este arquivo
-- e versionado num repositorio publico.
DO $$
DECLARE
  papel TEXT;
BEGIN
  FOR papel IN
    SELECT DISTINCT grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = 'acervo'
      AND table_name = 'versao'
      AND privilege_type = 'SELECT'
      AND grantee <> 'PUBLIC'
  LOOP
    EXECUTE format('GRANT SELECT ON acervo.miniatura_versao TO %I', papel);
  END LOOP;
END $$;

UPDATE public.versao SET nome = '1.10.0' WHERE code = 1;

COMMIT;
