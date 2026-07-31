-- Volume que guarda a entrega NO LAYOUT DO FORNECEDOR.
--
-- O PROBLEMA. O nome fisico do acervo e derivado (acervo.nome_arquivo_padrao) e
-- o diretorio e plano: <volume>/<nome_arquivo>.<extensao>. Isso vale para o que
-- a DGEO produz, porque quem produz controla o nome. Nao vale para a entrega de
-- convenio, por dois motivos que nao se resolvem renomeando:
--
--   1. Formato com sidecar por NOME. Um .img do ERDAS guarda dentro de si o nome
--      do .ige (onde estao TODOS os pixels: o .img tem 34 KB e o .ige tem 8 GB) e
--      os nomes das 30 entradas do .rrd. Renomear o conjunto quebra a referencia
--      interna e o produto para de abrir. Nenhuma auditoria pega isso depois.
--   2. Volume que ja contem a entrega. Renomear para o padrao significa achatar a
--      arvore do fornecedor (LOTE_1..LOTE_5) na raiz do volume, ou duplicar 1,9 TB.
--
-- A SAIDA. O volume declara que guarda o layout de origem. Nele, o nome fisico e
-- o caminho relativo do fornecedor, gravado em acervo.arquivo.nome_arquivo, e o
-- padrao derivado nao se aplica. Duas coisas passam a respeitar a marca:
--
--   - invariante 7a (nome fisico divergente do padrao): ignora o volume marcado.
--     Sem isso o auditor acusaria ~1.000 DEFECT permanentes, e DEFECT que nunca
--     zera apaga o valor de sinal do auditor inteiro.
--   - POST /api/arquivo/renomear-padrao: nao toca no volume marcado. Sem isso uma
--     chamada sem arquivo_ids moveria 1,9 TB para a raiz e quebraria os pares
--     .img/.ige de forma irreversivel.
--
-- O que a marca NAO afeta: a unicidade fisica (volume, nome_arquivo, extensao)
-- continua valendo, o confirm-upload continua conferindo sha256 do byte no
-- volume, e os invariantes 7b e 7c continuam medindo o que mediam.
--
-- A marca e do VOLUME, nao do produto nem do arquivo. Layout e propriedade de
-- onde o dado mora: um volume guarda o padrao do acervo ou o layout de quem
-- entregou, nunca os dois. Marca por arquivo viraria escape para nome improvisado.
--
-- Aprovada pelo chefe em 2026-07-31, para o volume das entregas do Convenio RS
-- (MDS, MDT e Ortoimagem, tipos de produto 4, 5 e 6, primeiros do acervo).

BEGIN;

ALTER TABLE acervo.volume_armazenamento
  ADD COLUMN IF NOT EXISTS layout_origem BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN acervo.volume_armazenamento.layout_origem IS
  'true = o volume guarda a entrega no layout do fornecedor. O nome fisico e o caminho relativo de origem, o padrao derivado (acervo.nome_arquivo_padrao) nao se aplica, e o invariante 7a e o renomear-padrao ignoram o volume.';

COMMIT;
