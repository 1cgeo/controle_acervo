'use strict'

// Teste unitario do controller de login (banco e servidor de autenticacao
// mockados). O que ele protege: a resposta do login carrega, FORA do token, o
// que o client precisa para montar a interface unica dos tres modulos.
//   - `perfis`: mapa nome_abrev -> nivel, para o client saber onde a pessoa entra
//   - `modulos`: o catalogo dominio.modulo, para o seletor exibir o NOME de cada
//     modulo em vez de decorar codigo (GET /usuarios/dominio/modulo e admin-only,
//     entao quem so tem consulta nao consegue le-lo)
// Nada disso vai para dentro do JWT de proposito: quem decide o que a pessoa
// pode e o verifyPerfil, lendo o banco a cada requisicao.

const mockDb = {
  conn: {
    oneOrNone: jest.fn(),
    any: jest.fn()
  }
}

jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

jest.mock('../../authentication', () => ({
  authenticateUser: jest.fn(() => Promise.resolve(true))
}))

// serialize-error e ESM-only e entra por import() dinamico. Num teste unitario
// esse import pode resolver DEPOIS do teardown do ambiente e derrubar o
// processo. O loader nao interessa aqui, entao entra mockado.
jest.mock('../../utils/serialize_error_loader', () => ({
  serialize: error => ({ message: error.message, stack: error.stack }),
  ready: Promise.resolve()
}))

const jwt = require('jsonwebtoken')
const ctrl = require('../../login/login_ctrl')
const { JWT_SECRET } = require('../../config')

const USUARIO = { id: 7, uuid: 'uuid-7', administrador: false }

const MODULOS = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Controle Orçamentário', nome_abrev: 'orcamento' }
]

beforeEach(() => {
  jest.clearAllMocks()
  mockDb.conn.oneOrNone.mockResolvedValue(USUARIO)
  // 1a chamada: perfis do usuario. 2a chamada: catalogo de modulos.
  mockDb.conn.any
    .mockResolvedValueOnce([
      { modulo: 'acervo', perfil_id: 1 },
      { modulo: 'orcamento', perfil_id: 2 }
    ])
    .mockResolvedValueOnce(MODULOS)
})

describe('login_ctrl.login', () => {
  test('devolve o perfil por modulo como mapa', async () => {
    const dados = await ctrl.login('fulano', 'senha', 'sca_web')

    expect(dados.perfis).toEqual({ acervo: 1, orcamento: 2 })
    // Modulo sem linha nao aparece: sem linha, sem acesso
    expect(dados.perfis.mapoteca).toBeUndefined()
  })

  test('devolve o catalogo de modulos, com o nome de cada um', async () => {
    const dados = await ctrl.login('fulano', 'senha', 'sca_web')

    expect(dados.modulos).toEqual(MODULOS)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('dominio.modulo')
    )
  })

  test('perfis e modulos ficam FORA do token', async () => {
    const dados = await ctrl.login('fulano', 'senha', 'sca_web')
    const decoded = jwt.verify(dados.token, JWT_SECRET)

    expect(decoded.uuid).toBe('uuid-7')
    expect(decoded.administrador).toBe(false)
    expect(decoded.perfis).toBeUndefined()
    expect(decoded.modulos).toBeUndefined()
  })

  test('administrador global vem no corpo, mesmo sem perfil nenhum', async () => {
    mockDb.conn.oneOrNone.mockResolvedValue({ ...USUARIO, administrador: true })
    mockDb.conn.any.mockReset()
    mockDb.conn.any
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(MODULOS)

    const dados = await ctrl.login('chefe', 'senha', 'sca_web')

    expect(dados.administrador).toBe(true)
    expect(dados.perfis).toEqual({})
    expect(dados.modulos).toHaveLength(3)
  })
})
