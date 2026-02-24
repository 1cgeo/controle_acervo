'use strict'

const asyncHandler = require('../../../utils/async_handler')

describe('asyncHandler', () => {
  it('should call the wrapped function and pass req, res, next', async () => {
    const mockFn = jest.fn().mockResolvedValue('ok')
    const req = {}
    const res = {}
    const next = jest.fn()

    const handler = asyncHandler(mockFn)
    await handler(req, res, next)

    expect(mockFn).toHaveBeenCalledWith(req, res, next)
  })

  it('should call next with error when wrapped function rejects', async () => {
    const error = new Error('async fail')
    const mockFn = jest.fn().mockRejectedValue(error)
    const next = jest.fn()

    const handler = asyncHandler(mockFn)
    await handler({}, {}, next)

    expect(next).toHaveBeenCalledWith(error)
  })

  it('should not call next when wrapped function resolves', async () => {
    const mockFn = jest.fn().mockResolvedValue('ok')
    const next = jest.fn()

    const handler = asyncHandler(mockFn)
    await handler({}, {}, next)

    expect(next).not.toHaveBeenCalled()
  })
})
