-- Unicidade do NOME FISICO do arquivo, no banco.
--
-- Por que: o servidor monta o download como <volume>/<nome_arquivo>.<extensao>
-- (server/src/acervo/acervo_ctrl.js:337 e :471). Logo o trio
-- (volume_armazenamento_id, nome_arquivo, extensao) e a chave fisica, e dois
-- registros com o mesmo trio apontam para o MESMO byte no disco: um sobrescreve
-- o outro em silencio.
--
-- Ate hoje a trava era so de APLICACAO (assertNomeFisicoLivre em
-- server/src/arquivo/arquivo_ctrl.js:51-80). Ela protege o caminho de upload e
-- nao protege UPDATE direto, carga por script, nem correcao manual. Auditado em
-- 2026-07-29: acervo.arquivo tinha UNIQUE so em (uuid_arquivo) e
-- (checksum, versao_id). O nome fisico estava desprotegido.
--
-- Tileserver (tipo_arquivo_id = 9) fica de fora: ali nome_arquivo e uma URL e
-- volume_armazenamento_id e NULL, por arquivo_check1. O indice parcial exclui.
--
-- Verificado antes de escrever: zero trio repetido no acervo de producao.
--   SELECT volume_armazenamento_id, nome_arquivo, extensao
--   FROM acervo.arquivo GROUP BY 1,2,3 HAVING count(*) > 1;   -> 0 linhas

-- SAO DOIS indices, e o segundo nao e redundancia.
-- O Postgres distingue caixa; o SMB do volume NAO. Sem o indice em lower(),
-- "CT_s02_2834-1_ed1.tif" e "ct_s02_2834-1_ed1.TIF" passam como duas linhas e
-- disputam UM arquivo no disco. Auditado em 2026-07-29: zero par assim hoje.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS unique_nome_fisico_por_volume
  ON acervo.arquivo (volume_armazenamento_id, nome_arquivo, extensao)
  WHERE tipo_arquivo_id <> 9;

CREATE UNIQUE INDEX IF NOT EXISTS unique_nome_fisico_por_volume_ci
  ON acervo.arquivo (volume_armazenamento_id, lower(nome_arquivo), lower(extensao))
  WHERE tipo_arquivo_id <> 9;

COMMIT;

-- Para desfazer:
--   DROP INDEX IF EXISTS acervo.unique_nome_fisico_por_volume;
--   DROP INDEX IF EXISTS acervo.unique_nome_fisico_por_volume_ci;
--
-- NAO cobre acervo.arquivo_deletado, que tambem guarda nome fisico (161 linhas
-- em 2026-07-29, das quais 106 ja repetem o nome de um arquivo VIVO). Como nada
-- no servidor apaga o byte, uma lapide pode apontar para arquivo que existe. E
-- defeito anterior a esta migracao e fica registrado aqui para nao se perder.
