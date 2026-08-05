'use strict'

// Assercoes de schema que provam o MOTIVO da recusa, e nao so que houve recusa.
//
// POR QUE ISTO EXISTE. `expect(error).toBeDefined()` nao guarda a regra que o
// titulo anuncia. Contra o schema de arquivo:
//
//   caso do teste  -> tileserver (tipo 9) com volume preenchido
//   motivo REAL    -> "volume_armazenamento_id" must be [null]      (a regra)
//   mesmo caso com o `nome` tambem quebrado
//   motivo         -> "nome" must be a string                       (outra coisa)
//
// As duas situacoes dao `error` definido, entao o caso passa nas duas. Removida
// a regra do tileserver, o teste segue verde desde que a fixtura falhe por
// qualquer outro motivo.
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
  // Sem o `return`, a linha seguinte estoura em `undefined.details` e esconde a
  // mensagem util: o schema ACEITOU o que o caso diz que ele recusa.
  if (!error) {
    expect('schema aceitou, e o caso exige recusa').toBe(`recusa em ${campo}`)
    return
  }

  const detalhe = error.details[0]
  const caminho = detalhe.path.join('.')
  const esperado = Array.isArray(campo) ? campo.join('.') : campo

  // IGUALDADE, e nao `toContain`. A mensagem do Joi cita o nome do campo, e
  // costuma citar os campos VIZINHOS, entao a busca por substring aceitava a
  // recusa errada: pedir 'id' passava com o erro em `tipo_cliente_id`, que e o
  // acidente que este helper existe para pegar. A mensagem vai junto no rotulo
  // para a falha dizer o que o schema achou.
  expect(`${caminho} (${detalhe.type}): ${detalhe.message}`)
    .toBe(`${esperado} (${detalhe.type}): ${detalhe.message}`)

  if (tipo) expect(detalhe.type).toBe(tipo)
}

/**
 * Exige que o schema recuse por uma regra do OBJETO (`xor`, `with`, `missing`,
 * `nand`, `and`), e nao de um campo.
 *
 * Estas regras vem com `path` VAZIO, porque o erro e da relacao entre chaves.
 * Pedir o campo pelo `recusaPor` sempre falharia, e pedi-lo por substring
 * passava com qualquer regra de objeto que citasse o mesmo nome na mensagem.
 * Aqui se prende a regra E as chaves que ela relaciona.
 *
 * @param {{error: Object}} resultado
 * @param {string} tipo - 'object.xor', 'object.with', 'object.missing', ...
 * @param {Array<string>} chaves - as chaves envolvidas, na ordem do schema
 */
const recusaRegraDeObjeto = (resultado, tipo, chaves) => {
  const { error } = resultado
  if (!error) {
    expect('schema aceitou, e o caso exige recusa').toBe(`recusa por ${tipo}`)
    return
  }

  const detalhe = error.details[0]
  expect(`${detalhe.path.join('.')} (${detalhe.type}): ${detalhe.message}`)
    .toBe(` (${tipo}): ${detalhe.message}`)

  // `xor` e `missing` listam `peers`; `with` separa a chave principal do par.
  const envolvidas = detalhe.context.peers ||
    [detalhe.context.main, detalhe.context.peer]
  expect(envolvidas).toEqual(chaves)
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

module.exports = { recusaPor, recusaRegraDeObjeto, aceita }
