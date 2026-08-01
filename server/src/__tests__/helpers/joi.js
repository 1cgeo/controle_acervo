'use strict'

// Assercoes de schema que provam o MOTIVO da recusa, e nao so que houve recusa.
//
// POR QUE ISTO EXISTE. Ate 2026-08-01 os testes de schema afirmavam apenas
// `expect(error).toBeDefined()`. Medido contra o proprio schema de arquivo:
//
//   caso do teste  -> tileserver (tipo 9) com volume preenchido
//   motivo REAL    -> "volume_armazenamento_id" must be [null]      (a regra)
//   mesmo caso com o `nome` tambem quebrado
//   motivo         -> "nome" must be a string                       (outra coisa)
//
// As duas situacoes davam `error` definido, entao o caso passava nas duas. Se a
// regra do tileserver fosse removida, o teste continuaria verde desde que o
// fixture falhasse por qualquer outro motivo. Ele nao guardava a regra que o
// titulo anuncia.
//
// O Joi valida com `abortEarly` ligado por padrao, entao `details[0]` e o
// PRIMEIRO erro encontrado. Conferir o campo dele e exatamente o que separa
// "recusou pela regra" de "recusou por acidente".

/**
 * Exige que o schema recuse, e que a recusa seja NAQUELE campo.
 *
 * @param {{error: Object}} resultado - a saida de schema.validate(...)
 * @param {string|Array<string|number>} campo - caminho do campo ('nome' ou
 *   ['arquivos', 0, 'checksum'])
 * @param {string} [tipo] - a regra do Joi ('any.required', 'array.min',
 *   'string.guid', 'array.unique', ...). Quando informado, prende tambem o
 *   motivo, e nao so o campo.
 */
const recusaPor = (resultado, campo, tipo) => {
  const { error } = resultado
  expect(error).toBeDefined()

  const detalhe = error.details[0]
  const caminho = detalhe.path.join('.')
  const esperado = Array.isArray(campo) ? campo.join('.') : campo

  // A mensagem entra no expect para a falha dizer o que o schema achou, em vez
  // de so "esperava X, veio Y".
  expect(`${caminho} (${detalhe.type}): ${detalhe.message}`).toContain(esperado)

  if (tipo) expect(detalhe.type).toBe(tipo)
}

/**
 * Exige que o schema ACEITE. O erro do Joi entra na mensagem de falha, senao
 * um `toBeUndefined()` quebrado obriga a rodar de novo no depurador para saber
 * qual campo reprovou.
 *
 * @param {{error: Object, value: Object}} resultado
 * @returns {Object} o `value` ja validado, para encadear assercao de default
 */
const aceita = (resultado) => {
  const { error, value } = resultado
  if (error) expect(`schema recusou: ${error.message}`).toBeUndefined()
  return value
}

module.exports = { recusaPor, aceita }
