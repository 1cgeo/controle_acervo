// Path: utils\generate_localizador.js
'use strict'

const crypto = require('crypto')

/**
 * Gera um código aleatório no formato XXXX-YYYY-ZZZZ
 * excluindo caracteres confundíveis: O, 0, 1, I.
 * Usa crypto.randomInt (não previsível, ao contrário de Math.random).
 * @returns {string} Localizador no formato XXXX-YYYY-ZZZZ
 */
function generateLocalizador() {
  const validChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

  const bloco = () => {
    let parte = ''
    for (let i = 0; i < 4; i++) {
      parte += validChars.charAt(crypto.randomInt(validChars.length))
    }
    return parte
  }

  return `${bloco()}-${bloco()}-${bloco()}`
}

module.exports = generateLocalizador
