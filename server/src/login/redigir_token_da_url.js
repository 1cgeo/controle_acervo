'use strict'

/**
 * TIRA O VALOR DO `?token=` DE UMA URL ANTES QUE ELA VÁ PARA O LOG.
 *
 * O QUE ELA CONSERTA. O middleware de log do `server/app.js` grava
 * `req.originalUrl`, e `originalUrl` inclui a query string. A única rota do
 * sistema que carrega credencial na query é a da tile MVT (ver
 * `verify_login_tile.js`), e por isso toda requisição de tile deixava o token
 * escrito em `logs/combined.log` -- que a rota `/logs` publica, sem guarda
 * nenhuma, com os últimos três dias.
 *
 * ELA NÃO É A CORREÇÃO PRINCIPAL, e é importante não a confundir com uma. O que
 * tira a credencial de circulação é o ESCOPO: a tile passou a andar com um token
 * de audiência `tile` e vida de minutos, que não abre mais nada
 * (`validate_token.js`). Esta função é a segunda linha, e existe porque o log
 * DESTE serviço é publicado por uma rota aberta: mesmo um token curto e de
 * escopo estreito não precisa ficar legível ali.
 *
 * E ELA NÃO ALCANÇA TUDO, o que é mais uma razão para o escopo curto: o log de
 * acesso do servidor web, o histórico do navegador, o `Referer` e qualquer proxy
 * do caminho continuam vendo a URL inteira, e nada aqui muda isso.
 *
 * MORA EM `login/`, e não em `utils/`, porque o assunto dela é credencial: quem
 * mexer em como o token viaja na URL passa por este diretório de qualquer jeito.
 */

/**
 * Casa `?token=`, `&token=`, e também as formas em que o Express entrega um
 * ARRANJO (`token[]=`, `token%5B%5D=`).
 *
 * A FORMA DE ARRANJO ENTRA DE PROPÓSITO, ainda que ela já não seja credencial
 * válida (o `validateToken` responde 401 a ela desde 2026-08-09): quem a mandou
 * pode ter posto um token de verdade lá dentro, e o log não é lugar de descobrir
 * isso. O valor vai até o próximo `&` ou `#`, que é onde o parâmetro acaba.
 *
 * `i` porque nome de parâmetro não é palavra reservada de ninguém, e `g` porque
 * uma URL malformada pode repetir o parâmetro.
 */
const PARAMETRO_TOKEN = /([?&]token(?:\[[^&#=]*\]|%5B[^&#=]*%5D)?=)[^&#]*/gi

/** O que fica no lugar do valor. É uma marca para quem lê o log, não um valor. */
const MARCA = '[REDIGIDO]'

/**
 * @param {string} url - a URL como ela seria logada
 * @returns {string} a mesma URL, com o valor de `token` trocado pela marca
 */
const redigirTokenDaUrl = url => {
  // URL sem query nenhuma não casa e volta idêntica; o que não for string volta
  // como veio, porque logar é melhor que derrubar a requisição por causa do log.
  if (typeof url !== 'string') return url

  return url.replace(PARAMETRO_TOKEN, `$1${MARCA}`)
}

module.exports = redigirTokenDaUrl
module.exports.MARCA = MARCA
