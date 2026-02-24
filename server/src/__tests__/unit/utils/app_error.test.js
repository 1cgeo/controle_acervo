'use strict'

const AppError = require('../../../utils/app_error')
const httpCode = require('../../../utils/http_code')

describe('AppError', () => {
  it('should create error with message and default status 500', () => {
    const err = new AppError('Something went wrong')
    expect(err.message).toBe('Something went wrong')
    expect(err.statusCode).toBe(httpCode.InternalError)
    expect(err).toBeInstanceOf(Error)
  })

  it('should create error with custom status code', () => {
    const err = new AppError('Not found', httpCode.NotFound)
    expect(err.statusCode).toBe(404)
  })

  it('should accept error trace as third parameter', () => {
    const err = new AppError('Fail', httpCode.BadRequest, 'trace info')
    expect(err.errorTrace).toBe('trace info')
  })

  it('should serialize Error objects in errorTrace', () => {
    const err = new AppError('Fail', httpCode.BadRequest, { detail: 'info' })
    expect(err.errorTrace).toEqual({ detail: 'info' })
  })
})
