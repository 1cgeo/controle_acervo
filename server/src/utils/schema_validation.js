'use strict'

const AppError = require('./app_error')
const httpCode = require('./http_code')
const logger = require('./logger')

const ehObjetoSimples = valor =>
  valor !== null &&
  typeof valor === 'object' &&
  !Array.isArray(valor) &&
  !(valor instanceof Date)

/**
 * Compara o corpo ORIGINAL com o corpo já validado e devolve os caminhos das
 * chaves que o Joi descartou (stripUnknown).
 *
 * O PORQUÊ: uma chave com nome errado hoje some sem erro nenhum. Quem escreveu
 * "subtipo_produto" em vez de "subtipo_produto_id" recebe 200 e acredita ter
 * gravado. Esta função é o que permite avisar em vez de calar.
 *
 * Anda em profundidade (objetos aninhados e itens de array) porque a maioria dos
 * corpos do SCA é aninhada (produtos[].versoes[].arquivos[]).
 *
 * @param {*} original - Corpo como chegou na requisição
 * @param {*} validado - Corpo devolvido pelo Joi
 * @param {string} [prefixo] - Caminho acumulado, para a mensagem
 * @returns {string[]} Caminhos descartados (ex.: 'produtos[0].escala')
 */
const chavesDescartadas = (original, validado, prefixo = '') => {
  if (Array.isArray(original) && Array.isArray(validado)) {
    const achados = []
    const limite = Math.min(original.length, validado.length)
    for (let i = 0; i < limite; i++) {
      achados.push(...chavesDescartadas(original[i], validado[i], `${prefixo}[${i}]`))
    }
    return achados
  }

  if (!ehObjetoSimples(original) || !ehObjetoSimples(validado)) {
    return []
  }

  const achados = []
  for (const chave of Object.keys(original)) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave
    if (!(chave in validado)) {
      achados.push(caminho)
      continue
    }
    achados.push(...chavesDescartadas(original[chave], validado[chave], caminho))
  }
  return achados
}

/**
 * Retorna objeto de erro da validação realizada pelo middleware do Joi
 *
 * @param {object} error - Objeto de erro retornado pelo Joi
 * @param {string} context - Em qual tipo de entrada foi realizada a validação
 * @returns {AppError} Objeto de erro da validação
 */
const validationError = (error, context) => {
  const { details } = error
  const message = details.map(i => i.message).join(',')

  return new AppError(
    `Erro de validação dos ${context}. Mensagem de erro: ${message}`,
    httpCode.BadRequest,
    message
  )
}

/**
 *
 *
 * @param {object} schema - Objeto com schemas de body, query e params
 * @param {object} [schema.body] - Schema do Joi para validação do body
 * @param {object} [schema.query] - Schema do Joi para validação da query
 * @param {object} [schema.params] - Schema do Joi para validação dos params
 * @returns {RequestHandler} Middleware de validação utilizando Joi
 */
// NOME PRÓPRIO, e não `middleware`. O irmão `schema_validation_estrito.js` tem
// contrato OPOSTO no corpo (recusa a chave desconhecida com 400, em vez de
// descartá-la), e os dois eram exportados como uma função anônima chamada
// `middleware`: no rastro de pilha e no `fn.name` eles se liam iguais, e trocar
// um pelo outro num `require` não deixava marca nenhuma.
const schemaValidationTolerante = ({
  body: bodySchema,
  query: querySchema,
  params: paramsSchema
}) => {
  return (req, res, next) => {
    if (querySchema) {
      const { error, value } = querySchema.validate(req.query, {
        abortEarly: false
      })
      if (error) {
        return next(validationError(error, 'Query'))
      }
      // Express 5: req.query is a getter-only property, override with defineProperty
      Object.defineProperty(req, 'query', { value, configurable: true })
    }
    if (paramsSchema) {
      const { error, value } = paramsSchema.validate(req.params, {
        abortEarly: false
      })
      if (error) {
        return next(validationError(error, 'Parâmetros'))
      }
      // Express 5: req.params is a getter-only property, override with defineProperty
      Object.defineProperty(req, 'params', { value, configurable: true })
    }
    if (bodySchema) {
      // CORPO AUSENTE E `{}`, pelo mesmo motivo do irmao estrito: sob Express 5
      // `req.body` fica indefinido quando nao ha corpo, e `Joi.object()` aceita
      // `undefined` sem cobrar chave obrigatoria nenhuma. A recusa vinha depois,
      // como `TypeError`, e chegava ao cliente como 500 em vez de 400.
      const corpoOriginal = req.body === undefined ? {} : req.body

      const { error, value } = bodySchema.validate(corpoOriginal, {
        stripUnknown: true,
        abortEarly: false
      })
      if (error) {
        return next(validationError(error, 'Dados'))
      }

      // Chave desconhecida some pelo stripUnknown. Manter o strip (recusar
      // quebraria os carregadores em massa da carga, que não são versionados
      // neste repo e fazem PUT em lote), mas NUNCA em silêncio: o descarte vai
      // para o log do servidor e volta em "avisos" no envelope da resposta,
      // para o cliente saber que o campo que ele mandou não foi gravado.
      const descartados = chavesDescartadas(corpoOriginal, value)
      if (descartados.length > 0) {
        req.camposDescartados = descartados
        logger.warn('Campos desconhecidos descartados do corpo da requisição', {
          url: req.originalUrl,
          metodo: req.method,
          campos: descartados
        })
      }

      req.body = value
    }

    return next()
  }
}

module.exports = schemaValidationTolerante
