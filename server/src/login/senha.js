'use strict'

const bcrypt = require('bcryptjs')

/**
 * O unico lugar do SCA que sabe transformar senha em hash e conferir hash.
 *
 * Mora em `login/` porque e a feature dona da autenticacao, e nao em `utils/`:
 * o custo do bcrypt e uma decisao de seguranca, nao um detalhe de formatacao.
 * `usuario/` importa daqui em vez de chamar bcrypt direto -- dois lugares
 * escolhendo o custo por conta propria divergiriam no primeiro ajuste, e o
 * hash mais fraco seria justamente o que ninguem estaria olhando.
 */

// O mesmo custo do Auth Server, para que o hash COPIADO de la em
// `scripts/copiar_usuarios_auth.js` continue valendo aqui sem rehash. O bcrypt
// carrega o custo dentro do proprio hash, entao subir este numero nao invalida
// senha nenhuma: ele so vale para o que for gravado daqui para a frente.
const CUSTO = 10

/**
 * @param {string} senha
 * @returns {Promise<string>} hash bcrypt
 */
const gerarHash = senha => bcrypt.hash(senha, CUSTO)

/**
 * @param {string} senha - o que a pessoa digitou
 * @param {string|null} hash - o que esta em dgeo.usuario.senha
 * @returns {Promise<boolean>}
 */
const conferir = async (senha, hash) => {
  // Hash nulo e o estado de quem foi importado do Auth Server e ainda nao teve
  // a senha copiada. `bcrypt.compare` com null lanca, e um 500 aqui esconderia
  // um caso que tem resposta propria (ver login_ctrl).
  if (!hash) return false
  return bcrypt.compare(senha, hash)
}

module.exports = { gerarHash, conferir, CUSTO }
