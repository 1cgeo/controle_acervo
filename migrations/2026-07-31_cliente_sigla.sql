-- Sigla da Organizacao Militar no cliente da mapoteca.
--
-- POR QUE. O RPCMTec lista o solicitante de cada pedido, e o nome por extenso
-- nao cabe: "10o Batalhao Logistico" ocupa uma coluna inteira onde "10o B Log"
-- diz o mesmo para quem le. O relatorio vai a DSG, e quem le e militar: a sigla
-- E o nome corrente da unidade, nao uma abreviacao de conveniencia.
--
-- POR QUE NULAVEL. Nem todo cliente e OM. O acervo atende orgao publico
-- (UFRGS, COPEL, prefeitura), a Brigada Militar e o cidadao anonimo da LAI.
-- Nenhum deles tem sigla de OM, e inventar uma seria pior que nao ter.
-- Quem le a coluna cai no nome quando ela e nula.
--
-- FONTE DA CARGA. A planilha "Controle de Pedidos Mapoteca", aba Militares:
-- 190 OM com nome por extenso e sigla, mantida pela secao. Casamento por nome
-- normalizado (sem acento, sem pontuacao, caixa baixa) cobriu 172 dos 180
-- clientes cadastrados. Os 8 restantes ficaram NULOS de proposito: 5 nao sao OM,
-- e 3 sao OM que a planilha nao lista. Sigla que a fonte nao traz e decisao
-- humana, nunca deducao a partir do padrao das outras.
--
-- 50 caracteres com folga: a maior sigla da planilha tem 16 ("11a Bia AAAe Ap").

BEGIN;

ALTER TABLE mapoteca.cliente
  ADD COLUMN IF NOT EXISTS sigla VARCHAR(50);

COMMENT ON COLUMN mapoteca.cliente.sigla IS
  'Sigla da OM (ex.: 10o B Log). NULL para quem nao e OM (orgao publico, cidadao LAI). Quem exibe cai no nome quando e NULL.';

COMMIT;
