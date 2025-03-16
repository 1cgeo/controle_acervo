// Path: utils\generate_localizador.js
'use strict'

/**
 * Gera um código aleatório no formato XXXX-YYYY-ZZZZ
 * excluindo caracteres confundíveis: O, 0, 1, I
 * @returns {string} Localizador no formato XXXX-YYYY-ZZZZ
 */
function generateLocalizador() {
  const validChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let localizador = '';
  
  // Primeira parte XXXX
  for (let i = 0; i < 4; i++) {
    localizador += validChars.charAt(Math.floor(Math.random() * validChars.length));
  }
  
  localizador += '-';
  
  // Segunda parte YYYY
  for (let i = 0; i < 4; i++) {
    localizador += validChars.charAt(Math.floor(Math.random() * validChars.length));
  }
  
  localizador += '-';
  
  // Terceira parte ZZZZ
  for (let i = 0; i < 4; i++) {
    localizador += validChars.charAt(Math.floor(Math.random() * validChars.length));
  }
  
  return localizador;
}

module.exports = generateLocalizador;