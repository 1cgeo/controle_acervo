'use strict'

const crypto = require('crypto')

/**
 * O CONTEXTO da requisicao, que a rastreabilidade grava junto do evento.
 *
 * Tres coisas que o controller nao tem como saber sozinho:
 *
 *   origem  De onde a mudanca entrou. O SCA tem quatro portas de escrita (a
 *           interface web, o plugin do QGIS, os CLIs e o que o proprio sistema
 *           faz), e "quem mudou" muda de resposta conforme a porta: uma carga
 *           em lote do plugin e trabalho de tela se leem igual sem isto.
 *   rota    'PUT /api/produtos/versao'. Diz por QUAL caminho a mudanca entrou,
 *           que e o que se procura quando duas rotas escrevem a mesma tabela.
 *   loteId  Um por REQUISICAO. E o que agrupa a operacao em massa: o renome
 *           padrao toca ate 5.000 arquivos e o evento e por arquivo, entao sem
 *           ele a tela viraria 5.000 linhas iguais.
 *
 * POR QUE AQUI, e nao num middleware proprio montado no `app`: os tres guardas
 * (verifyPerfil, verifyLogin, verifyAdmin) ja decodificam o token, e um quarto
 * lugar que o decodifica de novo e a divergencia esperando acontecer. Esta
 * funcao e chamada pelos tres, com o token JA decodificado.
 */

// A lista fechada de clientes vive no Joi de `login/login_schema.js`, e a rota
// so grava o que ela mesma aceitou. Aqui ela vira o rotulo de origem.
const ORIGEM_POR_CLIENTE = {
  sca_web: 'web',
  sca_qgis: 'qgis',
  sca_cli: 'cli'
}

/**
 * Monta `req.contexto` a partir do token ja decodificado.
 *
 * @param {object} req
 * @param {object} decoded - o payload do JWT
 */
const montarContexto = (req, decoded) => {
  // Token sem o campo `cliente` vira 'desconhecido', e não um palpite por
  // User-Agent: valor plausível e errado estraga o rastro.
  const cliente = decoded && decoded.cliente
  const origem = cliente ? (ORIGEM_POR_CLIENTE[cliente] || cliente) : 'desconhecido'

  // `req.route` so existe depois que o Express casou a rota; nos guardas ele ja
  // esta preenchido, porque eles rodam como middleware DA rota. `originalUrl`
  // seria o caminho com os ids dentro, e o que se quer aqui e o PADRAO.
  const caminho = req.route && req.route.path ? req.route.path : req.path
  const base = req.baseUrl || ''

  req.contexto = {
    origem,
    rota: `${req.method} ${base}${caminho}`.slice(0, 160),
    loteId: crypto.randomUUID()
  }
}

module.exports = { montarContexto, ORIGEM_POR_CLIENTE }
