'use strict'

// Este arquivo tinha 9 casos, e 7 deles exercitavam o Joi (que `.min(1)` recusa
// zero, que `.integer()` recusa 1.5). Sobraram os que sao POLITICA NOSSA: os
// valores de default e o teto do limit, que e o que protege o banco de um
// `limit=100000` vindo da query string.

const gerenciaSchema = require('../../../gerencia/gerencia_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

describe('Paginacao da gerencia', () => {
  it('sem parametro, pagina 1 e 20 por pagina', () => {
    const value = aceita(gerenciaSchema.paginationParams.validate({}))
    expect(value.page).toBe(1)
    expect(value.limit).toBe(20)
  })

  it('aceita ate 100 por pagina', () => {
    const value = aceita(gerenciaSchema.paginationParams.validate({ page: 5, limit: 100 }))
    expect(value.page).toBe(5)
    expect(value.limit).toBe(100)
  })

  it('recusa acima de 100, que e o teto que protege o banco', () => {
    recusaPor(
      gerenciaSchema.paginationParams.validate({ limit: 200 }),
      'limit',
      'number.max'
    )
  })
})
