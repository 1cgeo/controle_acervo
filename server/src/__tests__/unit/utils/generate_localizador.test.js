'use strict'

const generateLocalizador = require('../../../utils/generate_localizador')

describe('generateLocalizador', () => {
  it('should return string in XXXX-YYYY-ZZZZ format', () => {
    const loc = generateLocalizador()
    expect(loc).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  it('should not contain confusable characters O, 0, 1, I', () => {
    for (let i = 0; i < 100; i++) {
      const loc = generateLocalizador()
      expect(loc).not.toMatch(/[O01I]/)
    }
  })

  it('should generate unique values', () => {
    const results = new Set()
    for (let i = 0; i < 50; i++) {
      results.add(generateLocalizador())
    }
    expect(results.size).toBe(50)
  })

  it('should have length of 14 (4+1+4+1+4)', () => {
    expect(generateLocalizador()).toHaveLength(14)
  })
})
