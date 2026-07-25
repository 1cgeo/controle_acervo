'use strict'

const Joi = require('joi')
const schemaValidation = require('../../../utils/schema_validation')

describe('schemaValidation', () => {
  const testSchema = Joi.object().keys({
    name: Joi.string().required(),
    age: Joi.number().integer().required()
  })

  it('should call next() when body validation passes', () => {
    const middleware = schemaValidation({ body: testSchema })
    const req = { body: { name: 'Test', age: 25 } }
    const res = {}
    const next = jest.fn()

    middleware(req, res, next)
    expect(next).toHaveBeenCalledWith()
  })

  it('should call next(AppError) when body validation fails', () => {
    const middleware = schemaValidation({ body: testSchema })
    const req = { body: { name: '' } }
    const res = {}
    const next = jest.fn()

    middleware(req, res, next)
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: expect.stringContaining('Erro de validação dos Dados')
      })
    )
  })

  it('should validate query params', () => {
    const querySchema = Joi.object().keys({ page: Joi.number().required() })
    const middleware = schemaValidation({ query: querySchema })
    const req = { query: {} }
    const next = jest.fn()

    middleware(req, {}, next)
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: expect.stringContaining('Query')
      })
    )
  })

  it('should validate route params', () => {
    const paramsSchema = Joi.object().keys({ id: Joi.number().required() })
    const middleware = schemaValidation({ params: paramsSchema })
    const req = { params: { id: 'not-a-number' } }
    const next = jest.fn()

    middleware(req, {}, next)
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: expect.stringContaining('Parâmetros')
      })
    )
  })

  it('should strip unknown keys from body', () => {
    const middleware = schemaValidation({ body: testSchema })
    const req = { body: { name: 'Test', age: 25, extra: 'field' } }
    const next = jest.fn()

    middleware(req, {}, next)
    expect(next).toHaveBeenCalledWith()
  })

  // O strip continua, mas não em silêncio: a chave descartada é registrada em
  // req.camposDescartados, de onde o sendJsonAndLog monta o aviso da resposta.
  // Sem isso, um campo com nome errado some e o cliente acredita ter gravado.
  describe('campos descartados', () => {
    it('registra a chave desconhecida de primeiro nível', () => {
      const middleware = schemaValidation({ body: testSchema })
      const req = { body: { name: 'Test', age: 25, extra: 'field' } }
      const next = jest.fn()

      middleware(req, {}, next)
      expect(req.camposDescartados).toEqual(['extra'])
    })

    it('registra a chave desconhecida dentro de item de array', () => {
      const schema = Joi.object().keys({
        itens: Joi.array().items(Joi.object().keys({ nome: Joi.string() }))
      })
      const middleware = schemaValidation({ body: schema })
      const req = { body: { itens: [{ nome: 'a' }, { nome: 'b', sobra: 1 }] } }
      const next = jest.fn()

      middleware(req, {}, next)
      expect(req.camposDescartados).toEqual(['itens[1].sobra'])
    })

    it('não marca nada quando o corpo está inteiro no contrato', () => {
      const middleware = schemaValidation({ body: testSchema })
      const req = { body: { name: 'Test', age: 25 } }
      const next = jest.fn()

      middleware(req, {}, next)
      expect(req.camposDescartados).toBeUndefined()
    })

    it('não confunde conteúdo livre de um objeto sem chaves declaradas', () => {
      const schema = Joi.object().keys({ metadado: Joi.object().required() })
      const middleware = schemaValidation({ body: schema })
      const req = { body: { metadado: { qualquer: 'coisa', aninhado: { x: 1 } } } }
      const next = jest.fn()

      middleware(req, {}, next)
      expect(req.camposDescartados).toBeUndefined()
    })
  })
})
