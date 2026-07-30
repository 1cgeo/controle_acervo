'use strict'

const httpCode = require('../../../utils/http_code')

describe('httpCode', () => {
  it('should have correct status codes', () => {
    expect(httpCode.OK).toBe(200)
    expect(httpCode.Created).toBe(201)
    expect(httpCode.NoContent).toBe(204)
    expect(httpCode.BadRequest).toBe(400)
    expect(httpCode.Unauthorized).toBe(401)
    expect(httpCode.Forbidden).toBe(403)
    expect(httpCode.NotFound).toBe(404)
    expect(httpCode.Conflict).toBe(409)
    // 416 entrou em 2026-07-29, com o download de arquivo pelo navegador: é a
    // resposta para retomada que pede faixa de bytes fora do arquivo.
    expect(httpCode.RangeNotSatisfiable).toBe(416)
    expect(httpCode.InternalError).toBe(500)
  })

  it('should have exactly 10 codes', () => {
    expect(Object.keys(httpCode)).toHaveLength(10)
  })
})
