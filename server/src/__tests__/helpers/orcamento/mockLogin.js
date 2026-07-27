'use strict'

// Substitui os middlewares de autenticacao por passthrough que injeta um
// usuario admin de teste. Usado nos testes de rota de feature:
//   jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))
// (NAO use isto nos testes do proprio login: la se mocka ../authentication e
// ../database e se exercita o fluxo real do JWT.)

const TEST_USER = {
  uuid: '11111111-1111-1111-1111-111111111111',
  id: 1,
  administrador: true
}

const passthrough = (req, res, next) => {
  req.usuarioUuid = TEST_USER.uuid
  req.usuarioId = TEST_USER.id
  req.administrador = TEST_USER.administrador
  next()
}

module.exports = {
  verifyLogin: passthrough,
  verifyAdmin: passthrough,
  // verifyPerfil e FABRICA de middleware (recebe nivel minimo e modulo), entao o
  // mock tambem precisa ser: verifyPerfil('operador') tem que devolver o
  // passthrough, nao executa-lo.
  verifyPerfil: () => passthrough,
  TEST_USER
}
