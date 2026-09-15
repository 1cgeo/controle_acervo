'use strict'

// FOTO E VIDEO: o teto do arquivo e os tipos que a aplicacao pode declarar.
//
// POR QUE ESTE ARQUIVO EXISTE. As duas constantes nasceram dentro de
// `campo/campo_schema.js`, e ate 2026-09-15 a mídia era so do campo. Nessa data
// a capacitacao (a 2.6 ministrada e a 6.2 recebida) passou a aceitar foto e
// video tambem, e a alternativa era copiar a lista de MIME para
// `rpcmtec_schema.js`. Duas listas de tipo permitido divergem na primeira que
// alguem acrescentar a uma so, e o estrago da divergencia e assimetrico: quem
// esquecer de acrescentar num lado tem um upload recusado (barulhento), e quem
// esquecer de REMOVER tem um tipo perigoso servido na origem da aplicacao
// (silencioso). Uma lista so, lida pelos dois.
//
// A LISTA VALE NA ENTRADA E NA SAIDA, e as duas conferencias sao necessarias. O
// schema fecha a porta de entrada; a rota do arquivo confere de novo na hora de
// declarar o `Content-Type`, porque nem toda linha do banco entrou por esta
// porta (as 143 do dump do SAP entraram pela carga, que adivinha o tipo pelo
// numero magico).

/**
 * O maior corpo em base64 que uma rota de mídia aceita.
 *
 * SAO 56 MB DE TEXTO, que sao ~42 MiB de binario, e o numero veio MEDIDO: o
 * maior video do dump do SAP tem 37 MB. Base64 cresce o arquivo em um terco,
 * entao o teto do texto tem de ser maior que o teto que se quer do arquivo.
 *
 * ELE TEM DE CABER NO `express.json`, que e UM SO, global, em `server/app.js`
 * (60mb desde 2026-08-08). Com o teto do Express menor, o corpo grande morre num
 * 413 do body parser ANTES de chegar ao Joi, e a mensagem que sobra nao diz qual
 * campo excedeu. Mexer num dos dois sem o outro reabre esse buraco.
 *
 * O CLIENTE ESPELHA ESTE NUMERO em bytes crus
 * (`components/midia/galeria-midia.js`, `MAX_BYTES_ARQUIVO`), para nomear o
 * arquivo que reprovou antes de gastar a subida.
 */
const MAX_BASE64 = 58720256

/**
 * OS TIPOS QUE A ROTA DE ARQUIVO PODE DECLARAR.
 *
 * A razao de a lista existir: `mime_type` vem do CORPO do pedido (`file.type` do
 * navegador), e ate 2026-09-05 ele era texto livre. Um operador podia gravar
 * `mime_type: 'text/html'` com bytes de uma pagina, e a rota do arquivo os
 * devolvia com esse `Content-Type` na ORIGEM da propria aplicacao. O CSP esta
 * desligado por decisao (`server/app.js`, "aplicacao de intranet") e o `nosniff`
 * do helmet nao ajuda: ele impede ADIVINHAR o tipo, nao impede honrar o que foi
 * declarado.
 *
 * FOTO E VIDEO, e nada mais. SVG fica de FORA de proposito, porque ele executa
 * script; `image/gif` entra porque a carga do SAP o adivinha pelo numero magico
 * (`scripts/carregar_campo_sap.py`) e as linhas dele sao antigas e legitimas.
 */
const MIME_MIDIA_PERMITIDOS = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'video/webm'
]

/**
 * O `Content-Type` com que a rota pode servir estes bytes.
 *
 * O TIPO GENERICO COBRE DOIS CASOS: `mime_type` nulo (133 das 143 imagens do
 * dump do SAP estao sem ele) e tipo FORA da lista.
 * 'application/octet-stream' faz o navegador baixar em vez de tentar desenhar --
 * ou EXECUTAR -- algo que nao sabe o que e.
 *
 * @param {string|null} mimeType - o que esta gravado na linha
 * @returns {string} o tipo a declarar
 */
const tipoParaServir = mimeType =>
  (MIME_MIDIA_PERMITIDOS.includes(mimeType) ? mimeType : 'application/octet-stream')

module.exports = { MAX_BASE64, MIME_MIDIA_PERMITIDOS, tipoParaServir }
