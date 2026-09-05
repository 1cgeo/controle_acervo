'use strict'

/**
 * O RECORTE DA RASTREABILIDADE, e o 403 que explica.
 *
 * `dominio.modulo` tem SETE `nome_abrev`; `auditoria.evento.modulo` guarda os
 * SEIS de `MODULOS_VALIDOS` (`auditoria/mapa/index.js`), que não incluem `pit`
 * nem `efetivo` -- o que esses dois gravam é auditado sob 'plataforma', que é do
 * administrador global.
 *
 * Até 2026-09-05 quem era gerente SÓ de um dos dois passava no guarda e recebia
 * uma tela em branco POR CONSTRUÇÃO: a lista rodava `a.modulo IN ('pit')`, que
 * devolve zero, e os quatro combos de filtro voltavam vazios pelo mesmo recorte.
 * A leitura natural disso é "o sistema não registra nada" ou "está quebrado".
 *
 * Os três casos abaixo são a correção inteira:
 *   1. gerente só de `pit` -> 403, com a frase que diz onde o PIT é auditado;
 *   2. gerente de `pit` E de `acervo` -> passa, recortado ao acervo (o `pit`
 *      some do recorte, e é isso que a interseção faz);
 *   3. administrador global -> passa sem recorte nenhum (`modulos: null`), e a
 *      interseção nem é consultada.
 *
 * NÃO TOCA O BANCO: `dgeo.usuario` e `dgeo.usuario_perfil` entram por dublê,
 * como em `unit/login/audiencia_do_token.test.js`. O que se prova é a decisão de
 * autorização, que acontece entre as duas consultas.
 */

const mockDb = {
  conn: {
    oneOrNone: jest.fn(),
    any: jest.fn(),
    one: jest.fn()
  }
}

jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

// serialize-error é ESM-only e entra por import() dinâmico; num teste unitário
// esse import pode resolver DEPOIS do teardown e derrubar o processo.
jest.mock('../../../utils/serialize_error_loader', () => ({
  serialize: error => ({ message: error.message, stack: error.stack }),
  ready: Promise.resolve()
}))

const jwt = require('jsonwebtoken')
const express = require('express')
const request = require('supertest')

const { JWT_SECRET } = require('../../../config')
const { sendJsonAndLogMiddleware, errorHandler } = require('../../../utils')

const verifyRastreabilidade = require('../../../auditoria/verify_rastreabilidade')
const { MODULOS_VALIDOS } = require('../../../auditoria/mapa')

const UUID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'

const FRASE =
  'A rastreabilidade registra os módulos acervo, mapoteca, orçamento, ' +
  'equipamento e produção. O que o PIT e o efetivo gravam fica sob ' +
  "'plataforma', que é do administrador."

const token = () =>
  jwt.sign({ id: 2, uuid: UUID, cliente: 'sap_web' }, JWT_SECRET, {
    expiresIn: '1h'
  })

/**
 * Um app com a guarda e uma rota que devolve o RECORTE que ela montou: é o
 * recorte, e não o status, que diz o que a pessoa vai ver.
 */
const app = () => {
  const aplicacao = express()
  aplicacao.use(sendJsonAndLogMiddleware)
  aplicacao.get('/alvo', verifyRastreabilidade, (req, res) =>
    res.sendJsonAndLog(true, 'passou', 200, req.rastreabilidade)
  )
  aplicacao.use((err, req, res, next) => errorHandler.log(err, res))
  return aplicacao
}

/** Responde como o banco responderia para uma conta com estes módulos. */
const contaCom = ({ administrador = false, modulos = [] }) => {
  mockDb.conn.oneOrNone.mockResolvedValue({ id: 2, administrador })
  mockDb.conn.any.mockResolvedValue(modulos.map(modulo => ({ modulo })))
}

const pedir = () => request(app()).get('/alvo').set('Authorization', `Bearer ${token()}`)

beforeEach(() => jest.clearAllMocks())

describe('a interseção com o que a trilha registra', () => {
  // A premissa dos três casos. Se um dia `pit` entrar em `MODULOS_VALIDOS`, é
  // este caso que fica vermelho primeiro, e aí a frase do 403 é que está errada.
  it('`pit` e `efetivo` NÃO são módulos da trilha', () => {
    expect(MODULOS_VALIDOS.has('pit')).toBe(false)
    expect(MODULOS_VALIDOS.has('efetivo')).toBe(false)
    expect(MODULOS_VALIDOS.has('acervo')).toBe(true)
  })

  it('gerente só de `pit` recebe 403, com a frase que diz o porquê', async () => {
    contaCom({ modulos: ['pit'] })

    const res = await pedir()

    expect(res.status).toBe(403)
    expect(res.body.message).toBe(FRASE)
  })

  it('gerente só de `efetivo` recebe o mesmo 403', async () => {
    contaCom({ modulos: ['efetivo'] })

    const res = await pedir()

    expect(res.status).toBe(403)
    expect(res.body.message).toBe(FRASE)
  })

  it('gerente de `pit` E de `acervo` entra, recortado ao acervo', async () => {
    contaCom({ modulos: ['pit', 'acervo'] })

    const res = await pedir()

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual({ administrador: false, modulos: ['acervo'] })
  })

  it('o administrador global passa sem recorte nenhum', async () => {
    contaCom({ administrador: true, modulos: [] })

    const res = await pedir()

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual({ administrador: true, modulos: null })
    // Ele nem chega a consultar os perfis: a flag global curto-circuita.
    expect(mockDb.conn.any).not.toHaveBeenCalled()
  })

  // A recusa que já existia continua sendo a dela, e não a nova: quem não é
  // gerente de nada nunca chegou perto da interseção.
  it('quem não é gerente de módulo nenhum continua com a recusa antiga', async () => {
    contaCom({ modulos: [] })

    const res = await pedir()

    expect(res.status).toBe(403)
    expect(res.body.message).toBe(
      'Esta tela é do administrador global e dos gerentes de módulo.'
    )
  })

  it('conta inativa ou apagada continua sendo 403 antes de tudo', async () => {
    mockDb.conn.oneOrNone.mockResolvedValue(null)

    const res = await pedir()

    expect(res.status).toBe(403)
    expect(res.body.message).toBe('Usuário não encontrado ou inativo')
  })
})
