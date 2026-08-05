'use strict'

// Validacao ESTRITA: chave desconhecida no corpo vira 400, com sugestao do nome
// declarado mais parecido. O irmao schema_validation.js DESCARTA a chave e so
// avisa no envelope.
//
// Mora aqui, e nao no orcamento, porque nada nele e do orcamento: as rotas do
// modulo o recebem reexportado por src/orcamento/utils/index.js.

const AppError = require('./app_error')
const httpCode = require('./http_code')
const logger = require('./logger')

// Distância de edição (Levenshtein) entre duas strings, usada só para sugerir
// a chave mais parecida quando o corpo traz um campo desconhecido. Roda apenas
// no caminho de erro, então não pesa na requisição bem-sucedida.
const distanciaEdicao = (a, b) => {
  const linha = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = linha[0]
    linha[0] = i
    for (let j = 1; j <= b.length; j++) {
      const anterior = linha[j]
      linha[j] = Math.min(
        linha[j] + 1,
        linha[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      diagonal = anterior
    }
  }
  return linha[b.length]
}

// Sugere a chave declarada mais parecida com a desconhecida. Só sugere se a
// distância for pequena em relação ao tamanho da chave: para um nome
// completamente diferente a "sugestão" atrapalharia mais do que ajudaria.
const chaveMaisParecida = (chave, candidatas) => {
  const alvo = String(chave).toLowerCase()
  let melhor = null
  let menorDistancia = Infinity

  for (const candidata of candidatas) {
    const distancia = distanciaEdicao(alvo, candidata.toLowerCase())
    if (distancia < menorDistancia) {
      menorDistancia = distancia
      melhor = candidata
    }
  }

  const limite = Math.max(1, Math.floor(alvo.length / 3))
  return menorDistancia <= limite ? melhor : null
}

// Percorre a descrição do schema Joi até o nível do pai da chave desconhecida
// para listar as chaves válidas ali. Índice numérico no caminho significa
// elemento de array, cujo schema fica em `items[0]`.
const chavesValidasEm = (descricao, caminhoDoPai) => {
  let atual = descricao

  for (const parte of caminhoDoPai) {
    if (!atual) return []
    atual =
      typeof parte === 'number'
        ? atual.items && atual.items[0]
        : atual.keys && atual.keys[parte]
  }

  return atual && atual.keys ? Object.keys(atual.keys) : []
}

// 'itens', 0, 'id' -> 'itens[0].id'
const formatarCaminho = caminho =>
  caminho.reduce(
    (acc, parte) =>
      typeof parte === 'number' ? `${acc}[${parte}]` : acc ? `${acc}.${parte}` : `${parte}`,
    ''
  )

// Troca a mensagem padrão do Joi para chave desconhecida ('"x" is not allowed')
// por uma mensagem em português que diz QUAL chave sobrou e, quando o nome se
// parece com um campo declarado, qual provavelmente era a intenção.
const mensagemDoDetalhe = (detalhe, descricaoDoSchema) => {
  if (detalhe.type !== 'object.unknown') {
    return detalhe.message
  }

  const caminho = formatarCaminho(detalhe.path)
  const chave = detalhe.path[detalhe.path.length - 1]
  const candidatas = chavesValidasEm(descricaoDoSchema, detalhe.path.slice(0, -1))
  const parecida = chaveMaisParecida(chave, candidatas)

  return parecida
    ? `campo desconhecido "${caminho}". Você quis dizer "${parecida}"?`
    : `campo desconhecido "${caminho}"`
}

const validationError = (error, context, schema) => {
  const { details } = error
  // describe() só é chamado quando já houve erro e só se houver chave
  // desconhecida entre os detalhes, para não custar nada no caminho feliz.
  const descricaoDoSchema =
    schema && details.some(d => d.type === 'object.unknown')
      ? schema.describe()
      : null

  const message = details.map(d => mensagemDoDetalhe(d, descricaoDoSchema)).join(',')

  return new AppError(
    `Erro de validação dos ${context}. Mensagem de erro: ${message}`,
    httpCode.BadRequest,
    message
  )
}

const ehObjetoSimples = valor =>
  valor !== null &&
  typeof valor === 'object' &&
  !Array.isArray(valor) &&
  Object.getPrototypeOf(valor) === Object.prototype

// Lista os caminhos das chaves que a validação removeu do corpo (Joi `.strip()`).
// O corpo agora RECUSA chave desconhecida, então o único descarte que sobra é o
// explicitamente tolerado no schema por causa do client web. Mesmo tolerado, o
// descarte não pode ser invisível: é registrado no log com a rota, para a dívida
// do client ficar rastreável e um dia ser removida.
const chavesDescartadas = (original, validado, prefixo = '') => {
  if (Array.isArray(original)) {
    if (!Array.isArray(validado)) return []
    return original.flatMap((item, i) =>
      chavesDescartadas(item, validado[i], `${prefixo}[${i}]`)
    )
  }

  if (!ehObjetoSimples(original) || !ehObjetoSimples(validado)) return []

  const encontradas = []
  for (const chave of Object.keys(original)) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave
    if (chave in validado) {
      encontradas.push(...chavesDescartadas(original[chave], validado[chave], caminho))
    } else {
      encontradas.push(caminho)
    }
  }
  return encontradas
}

// NOME PRÓPRIO, e não `middleware`: ver a nota gêmea em `schema_validation.js`.
const schemaValidationEstrito = ({
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
        return next(validationError(error, 'Query', querySchema))
      }
      // Express 5: req.query is a getter-only property, override with defineProperty
      Object.defineProperty(req, 'query', { value, configurable: true })
    }
    if (paramsSchema) {
      const { error, value } = paramsSchema.validate(req.params, {
        abortEarly: false
      })
      if (error) {
        return next(validationError(error, 'Parâmetros', paramsSchema))
      }
      // Express 5: req.params is a getter-only property, override with defineProperty
      Object.defineProperty(req, 'params', { value, configurable: true })
    }
    if (bodySchema) {
      const corpoOriginal = req.body
      // Sem `stripUnknown`: chave desconhecida no corpo vira 400 em vez de ser
      // descartada em silêncio. Descartar calado fazia um campo com nome errado
      // simplesmente não gravar, e quem chamou achava que tinha gravado. Onde o
      // client web legado precisa mandar campo a mais, a chave é declarada com
      // `.strip()` no próprio schema (uma a uma, documentada), e não pela porta
      // aberta de aceitar qualquer nome.
      const { error, value } = bodySchema.validate(corpoOriginal, {
        abortEarly: false
      })
      if (error) {
        return next(validationError(error, 'Dados', bodySchema))
      }

      const descartadas = chavesDescartadas(corpoOriginal, value)
      if (descartadas.length > 0) {
        logger.warn('Campos descartados do corpo da requisição', {
          rota: `${req.method} ${req.baseUrl}${req.path}`,
          chaves: descartadas
        })
      }

      req.body = value
    }

    return next()
  }
}

module.exports = schemaValidationEstrito
