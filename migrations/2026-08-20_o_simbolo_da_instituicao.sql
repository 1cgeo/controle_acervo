-- A INSTITUICAO PASSA A TER SIMBOLO, E ELE E CONFIGURADO, NAO EMBUTIDO.
--
-- POR QUE. A tela publica de acompanhamento (`#/consultar-pedido/<localizador>`)
-- e a unica do sistema que uma pessoa de FORA abre. Ate aqui ela nao dizia de
-- quem era: nem simbolo, nem nome. Quem recebe o link por DIEx chega numa
-- pagina sem assinatura visual, e o primeiro julgamento de uma tela oficial e
-- justamente esse.
--
-- POR QUE NO BANCO, E NAO UM ARQUIVO NO REPOSITORIO. O simbolo do 1o CGEO nao e
-- do SISTEMA, e da INSTALACAO. `dgeo.instituicao` existe desde 2026-08-09
-- exatamente para tirar "1o CGEO" de dentro do codigo, e nome e sigla ja moram
-- la. Um PNG versionado no repositorio seria o mesmo erro na forma de imagem: a
-- instalacao de outro Centro teria de trocar o arquivo e reconstruir a imagem
-- para mudar a propria cara.
--
-- BYTEA, e nao caminho de arquivo. E o padrao que este banco ja usa para imagem
-- derivada (`acervo.miniatura_versao.conteudo`) e para anexo
-- (`mapoteca.anexo_pedido.conteudo`): o byte viaja no backup junto com a linha,
-- e nao ha caminho de volume para apodrecer. A imagem e pequena e lida com
-- cache do navegador.
--
-- O MIMETYPE E COLUNA, e nao deduzido do nome: quem serve a imagem precisa dele
-- no cabecalho, e adivinhar por extensao erra em SVG servido como XML.
--
-- ANULAVEL. Instalacao sem simbolo e estado normal, e a tela simplesmente nao
-- mostra a imagem. Nada aqui e obrigatorio para o servico subir.

BEGIN;

ALTER TABLE dgeo.instituicao
  ADD COLUMN IF NOT EXISTS simbolo BYTEA,
  ADD COLUMN IF NOT EXISTS simbolo_mimetype VARCHAR(100),
  ADD COLUMN IF NOT EXISTS simbolo_nome_original VARCHAR(255),
  ADD COLUMN IF NOT EXISTS simbolo_data_envio TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN dgeo.instituicao.simbolo IS
  'Brasao/distintivo da instituicao, em bytes. E PUBLICO: sai na tela de '
  'acompanhamento de pedido, que nao tem login.';

UPDATE public.versao SET nome = '3.8.0' WHERE code = 1;

COMMIT;

-- COMO DESFAZER
--
--   BEGIN;
--   ALTER TABLE dgeo.instituicao
--     DROP COLUMN simbolo,
--     DROP COLUMN simbolo_mimetype,
--     DROP COLUMN simbolo_nome_original,
--     DROP COLUMN simbolo_data_envio;
--   UPDATE public.versao SET nome = '3.7.0' WHERE code = 1;
--   COMMIT;
