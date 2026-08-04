'use strict'

const Joi = require('joi')

/**
 * Filtro de domínio que aceita VÁRIOS códigos.
 *
 * Existe porque a tela passou a marcar mais de uma opção por filtro (chefe,
 * 2026-08-04): o combo de escolha única obrigava a refazer a busca uma vez por
 * escala para responder "o que existe em 25k e em 50k".
 *
 * Aceita as três formas em que o valor chega, e sempre devolve um ARRAY de
 * inteiros já sem repetição:
 *
 * - `?tipo_produto_id=1,3` (a tela, que junta com vírgula)
 * - `?tipo_produto_id=1&tipo_produto_id=3` (o Express monta array sozinho)
 * - `?tipo_produto_id=1` (o link antigo e o plugin, que mandam um só)
 *
 * A terceira forma é o que mantém compatível todo link já colado em documento e
 * o CLI: um valor solto continua valendo e vira lista de um elemento. Por isso
 * o controlador pode usar `IN (...)` sem tratar caso a caso.
 *
 * A validação recusa a lista inteira quando UM item é inválido, em vez de
 * descartar o item ruim em silêncio. Descartar devolveria um resultado a mais,
 * plausível e errado, para quem não teria como perceber.
 *
 * @param {{min?:number, max?:number, maxItens?:number}} [limites]
 *   `min` e `max` valem por item, como no `Joi.number().min()`. `maxItens` é o
 *   teto de códigos por filtro, que impede uma URL de montar um `IN` gigante.
 * @returns {Joi.Schema}
 */
function listaDeInteiros ({ min, max, maxItens = 200 } = {}) {
  return Joi.any().custom((valor, helpers) => {
    const bruto = Array.isArray(valor) ? valor : String(valor).split(',')
    const itens = []

    for (const parte of bruto) {
      const texto = String(parte).trim()
      // Vírgula sobrando ('1,,3' ou '1,') não é erro: é o que sobra de juntar
      // uma lista na tela, e o que ela quer dizer é claro.
      if (texto === '') continue
      if (!/^-?\d+$/.test(texto)) return helpers.error('any.invalid')

      const numero = Number(texto)
      if (!Number.isSafeInteger(numero)) return helpers.error('any.invalid')
      if (min !== undefined && numero < min) return helpers.error('any.invalid')
      if (max !== undefined && numero > max) return helpers.error('any.invalid')
      if (!itens.includes(numero)) itens.push(numero)
    }

    // Lista vazia é filtro NÃO aplicado, e não filtro que não casa com nada.
    // Devolver `undefined` faz o controlador ignorá-la, que é o mesmo que a
    // tela quer dizer ao desmarcar a última opção.
    if (itens.length === 0) return undefined
    if (itens.length > maxItens) return helpers.error('any.invalid')

    return itens
  })
}

/**
 * Verdadeiro quando o filtro tem valor a aplicar.
 *
 * Um array VAZIO é verdadeiro em JavaScript, e por isso `if (filtros.x)` deixa
 * de servir assim que o filtro vira lista: ele montaria um `IN ()` e derrubaria
 * a consulta. Toda montagem de WHERE que aceita lista passa por aqui.
 *
 * @param {*} valor
 * @returns {boolean}
 */
function temValor (valor) {
  if (valor === null || valor === undefined || valor === '') return false
  if (Array.isArray(valor)) return valor.length > 0
  return true
}

module.exports = { listaDeInteiros, temValor }
