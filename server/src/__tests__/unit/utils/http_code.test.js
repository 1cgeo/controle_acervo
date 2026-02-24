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
    expect(httpCode.InternalError).toBe(500)
  })

  it('should have exactly 8 codes', () => {
    expect(Object.keys(httpCode)).toHaveLength(8)
  })
})
