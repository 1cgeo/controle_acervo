-- O MODELO 3D INDOOR NAVEGAVEL VIRA SUBTIPO PROPRIO.
--
-- POR QUE. O tipo 9 (Modelo 3D) tinha dois subtipos, e os dois descrevem o
-- levantamento EXTERNO de uma instalacao: 25 (Modelo 3D Tiles) nomeia a
-- codificacao 3D Tiles que o EBGeo serve, e 26 (Modelo 3D) e o generico. O
-- modelo INDOOR e outra coisa: e a captura do interior de um comodo, servida
-- como cena navegavel em primeira pessoa, com colisao e marcadores de item. Ele
-- nao e 3D Tiles, nao tem geometria propria (o referencial e LOCAL, em metros
-- relativos a sala) e a geometria que o acervo guarda e a do predio que o abriga.
--
-- Sem subtipo proprio ele entraria como 26 e ficaria indistinguivel do
-- levantamento externo em toda consulta por subtipo, inclusive no despacho do
-- template de XML do metadado, que le subtipo.
--
-- O NOME DIZ O QUE DISTINGUE, e nao a codificacao. O 25 e o 31 nomeiam
-- representacao (3D Tiles, piramide de tiles) porque ali a representacao E a
-- diferenca. Aqui a diferenca e o objeto: interior, navegavel, primeira pessoa.
-- A codificacao de hoje e gaussiana com octree de colisao, e ela pode mudar sem
-- que o produto deixe de ser o que e.
--
-- SO ACRESCENTA LINHA DE DOMINIO. Nao chama `criar_views_materializadas()`, e a
-- diferenca em relacao a migracao do tipo 14 e deliberada: a view materializada
-- existe por par (tipo_produto, tipo_escala), e o tipo 9 ja tem as dele. Subtipo
-- novo nao cria par novo. O ensaio confere os indices e reprovaria se faltasse.
--
-- IDEMPOTENTE pelo ON CONFLICT: reaplicar nao duplica nem falha.

BEGIN;

INSERT INTO dominio.subtipo_produto (code, nome, tipo_id) VALUES
(32, 'Modelo 3D indoor navegável', 9)
ON CONFLICT (code) DO NOTHING;

UPDATE public.versao SET nome = '3.13.0' WHERE code = 1;

COMMIT;

-- COMO DESFAZER
--
-- So e reversivel enquanto nenhuma versao usar o subtipo 32. O DELETE falha pela
-- FK se ja houver, e falhar e o certo.
--
--   BEGIN;
--   DELETE FROM dominio.subtipo_produto WHERE code = 32;
--   UPDATE public.versao SET nome = '3.12.0' WHERE code = 1;
--   COMMIT;
