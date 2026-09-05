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
//
// A ORIGEM E A PORTA, E NAO O NOME DO CLIENTE. Sao quatro portas de escrita (a
// interface web, o plugin do QGIS, os CLIs e o proprio sistema), e e por elas
// que a pergunta "de onde isto entrou" se responde. Por isso os DOIS plugins do
// QGIS caem no mesmo 'qgis': qual dos dois foi e uma pergunta menor, e a coluna
// nao e o lugar dela.
//
// OS NOMES NOVOS ENTRARAM AQUI EM 2026-09-05, e a falta deles era defeito. O Joi
// aceita 'sap_web', 'sap_fp' e 'sap_fg' desde a renomeacao de 2026-08-09, e sem
// linha no mapa o fallback abaixo gravava o nome CRU: o plugin SAP Operador
// entrava no rastro como 'sap_fp' e o plugin antigo como 'qgis', para o mesmo
// trabalho pela mesma porta. O combo da tela sai de um `SELECT DISTINCT origem`,
// entao ela passaria a oferecer duas entradas para a mesma coisa, e filtrar por
// uma esconderia metade dos eventos -- sem erro nenhum.
//
// `sca_cli` NAO E ENVIADO POR NINGUEM hoje (os CLIs entram como 'sca_web', ver
// `CLIENTE_PADRAO` de `acervo_cli/lib/config.js`) e fica como estava: ele nao
// custa nada e o dia em que um CLI se anunciar ja o encontra aqui.
const ORIGEM_POR_CLIENTE = {
  sca_web: 'web',
  sap_web: 'web',
  sca_qgis: 'qgis',
  sap_fp: 'qgis',
  sap_fg: 'qgis',
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
