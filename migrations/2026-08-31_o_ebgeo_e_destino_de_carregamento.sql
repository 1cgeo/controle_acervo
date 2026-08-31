-- O EBGEO PASSA A SER UM DESTINO DE CARREGAMENTO.
--
-- POR QUE. A subsecao 2.4 do RPCMTec se chama "Entregas detalhada de produtos
-- finais (BDGEx, IGW, EBGeo) no mes", e o filtro dela e `situacao_carregamento
-- <> 1` em algum arquivo da versao. O dominio tinha cinco valores e nenhum
-- nomeava o EBGeo: 1 Nao carregado, 2 e 3 BDGEx, 4 IGW, 5 GEDW (que e o portal
-- da Airbus do TREx, e nada tem a ver). Modelo 3D e Panoramica 360 sao servidos
-- pelo EBGeo, entao nao havia como declarar a entrega deles, e a 2.4 nunca
-- listaria um: os 42 produtos de 2026 estavam todos "Nao carregado" em todos os
-- arquivos, o unico valor que a tabela permitia dizer com honestidade.
--
-- Medido em 2026-08-31: a 2.4 de agosto saia com ZERO linhas, com tres produtos
-- finalizados no mes. Decisao do chefe no mesmo dia.
--
-- SO ACRESCENTA LINHA DE DOMINIO. Nao ha coluna nova, nem view, nem funcao: o
-- codigo compara `<> NAO_CARREGADO` e nunca enumera os destinos, entao um banco
-- na 3.11.0 roda o servico atual sem faltar nada e o MIN_DATABASE_VERSION nao
-- sobe. O que muda e o vocabulario disponivel a quem marca.
--
-- MARCAR CONTINUA SENDO ATO HUMANO. O SAP nao conversa com o EBGeo: ninguem
-- sonda, ninguem confere. Esta migracao abre o valor; ela nao marca arquivo
-- nenhum, e de proposito, porque inferir "esta no EBGeo" de "e um Modelo 3D"
-- gravaria entrega que ninguem verificou.
--
-- IDEMPOTENTE pelo ON CONFLICT: reaplicar nao duplica nem falha.

BEGIN;

INSERT INTO dominio.situacao_carregamento (code, nome) VALUES
(6, 'Carregado EBGeo')
ON CONFLICT (code) DO NOTHING;

UPDATE public.versao SET nome = '3.12.0' WHERE code = 1;

COMMIT;

-- COMO DESFAZER
--
-- So e reversivel enquanto nenhum arquivo usar o code 6. O DELETE falha pela FK
-- se ja houver, e falhar e o certo.
--
--   BEGIN;
--   DELETE FROM dominio.situacao_carregamento WHERE code = 6;
--   UPDATE public.versao SET nome = '3.11.0' WHERE code = 1;
--   COMMIT;
