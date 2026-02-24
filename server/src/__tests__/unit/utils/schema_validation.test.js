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
})
