'use strict'

// Este arquivo tinha 6 casos, e 3 deles exercitavam o `.required()` do Joi.
// Sobrou o que e REGRA DO PROJETO: `cliente` e um enum fechado.
//
// Ele importa porque o Auth Server registra a sessao por cliente, e um valor
// novo precisa ser cadastrado LA antes de ser aceito aqui. Recusar no schema
// devolve 400 dizendo o campo; aceitar devolveria uma falha de autenticacao
// vinda do servico externo, muito mais dificil de ler. A fumaca cobre o mesmo
// caso pelo lado da rota.

const loginSchema = require('../../../login/login_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

describe('Schema do login', () => {
  it.each(['sca_web', 'sca_qgis'])('aceita o cliente %s', (cliente) => {
    aceita(loginSchema.login.validate({ usuario: 'admin', senha: 'pass', cliente }))
  })

  it('recusa cliente fora do enum, em vez de deixar o Auth Server recusar', () => {
    recusaPor(
      loginSchema.login.validate({
        usuario: 'admin', senha: 'pass', cliente: 'inexistente'
      }),
      'cliente',
      'any.only'
    )
  })

  it('exige o cliente: sem ele o Auth Server nao sabe que sessao abrir', () => {
    recusaPor(
      loginSchema.login.validate({ usuario: 'admin', senha: 'pass' }),
      'cliente',
      'any.required'
    )
  })
})
