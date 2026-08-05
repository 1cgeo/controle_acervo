'use strict'

// Teste unitario do controller de login, com o BANCO mockado e o bcrypt DE
// VERDADE. A conferencia da senha e LOCAL, e e o que este arquivo prova:
// mockar o bcrypt provaria a consulta, e nao a conferencia.
//
// O que ele protege, alem da senha: a resposta do login carrega, FORA do token,
// o que o client precisa para montar a interface unica dos tres modulos.
//   - `perfis`: mapa nome_abrev -> nivel, para o client saber onde a pessoa entra
//   - `modulos`: o catalogo dominio.modulo, para o seletor exibir o NOME de cada
//     modulo em vez de decorar codigo (GET /usuarios/dominio/modulo e admin-only,
//     entao quem so tem consulta nao consegue le-lo)
// Nada disso vai para dentro do JWT de proposito: quem decide o que a pessoa
// pode e o verifyPerfil, lendo o banco a cada requisicao.

// A transacao do login usa `t.oneOrNone`, `t.any` e `t.none`; a sessao usa
// `task`. Os dois recebem o MESMO objeto, entao um teste so descreve as duas.
const mockT = {
  oneOrNone: jest.fn(),
  any: jest.fn(),
  none: jest.fn()
}

const mockDb = {
  conn: {
    tx: jest.fn(fn => fn(mockT)),
    task: jest.fn(fn => fn(mockT)),
    oneOrNone: jest.fn()
  }
}

jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

// serialize-error e ESM-only e entra por import() dinamico. Num teste unitario
// esse import pode resolver DEPOIS do teardown do ambiente e derrubar o
// processo. O loader nao interessa aqui, entao entra mockado.
jest.mock('../../utils/serialize_error_loader', () => ({
  serialize: error => ({ message: error.message, stack: error.stack }),
  ready: Promise.resolve()
}))

const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const ctrl = require('../../login/login_ctrl')
const { JWT_SECRET } = require('../../config')

const SENHA_CERTA = 'senha-de-verdade'
let HASH

const MODULOS = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Controle Orçamentário', nome_abrev: 'orcamento' }
]

const usuario = (extra = {}) => ({
  id: 7,
  uuid: 'uuid-7',
  administrador: false,
  senha: HASH,
  ...extra
})

beforeAll(async () => {
  // Custo 4, e nao o 10 de producao: aqui o que se prova e que o caminho passa
  // pelo bcrypt, e o custo so encareceria a suite. O hash carrega o proprio
  // custo, entao o `compare` funciona igual.
  HASH = await bcrypt.hash(SENHA_CERTA, 4)
})

beforeEach(() => {
  jest.clearAllMocks()
  mockDb.conn.tx.mockImplementation(fn => fn(mockT))
  mockDb.conn.task.mockImplementation(fn => fn(mockT))
  mockT.oneOrNone.mockResolvedValue(usuario())
  mockT.none.mockResolvedValue(undefined)
  // 1a chamada: perfis do usuario. 2a chamada: catalogo de modulos.
  mockT.any
    .mockResolvedValueOnce([
      { modulo: 'acervo', perfil_id: 1 },
      { modulo: 'orcamento', perfil_id: 2 }
    ])
    .mockResolvedValueOnce(MODULOS)
})

describe('login_ctrl.login', () => {
  test('devolve o perfil por modulo como mapa', async () => {
    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')

    expect(dados.perfis).toEqual({ acervo: 1, orcamento: 2 })
    // Modulo sem linha nao aparece: sem linha, sem acesso
    expect(dados.perfis.mapoteca).toBeUndefined()
  })

  test('devolve o catalogo de modulos, com o nome de cada um', async () => {
    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')

    expect(dados.modulos).toEqual(MODULOS)
    expect(mockT.any).toHaveBeenCalledWith(
      expect.stringContaining('dominio.modulo')
    )
  })

  test('perfis e modulos ficam FORA do token', async () => {
    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')
    const decoded = jwt.verify(dados.token, JWT_SECRET)

    expect(decoded.uuid).toBe('uuid-7')
    expect(decoded.administrador).toBe(false)
    expect(decoded.perfis).toBeUndefined()
    expect(decoded.modulos).toBeUndefined()
  })

  test('administrador global vem no corpo, mesmo sem perfil nenhum', async () => {
    mockT.oneOrNone.mockResolvedValue(usuario({ administrador: true }))
    mockT.any.mockReset()
    mockT.any
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(MODULOS)

    const dados = await ctrl.login('chefe', SENHA_CERTA, 'sca_web')

    expect(dados.administrador).toBe(true)
    expect(dados.perfis).toEqual({})
    expect(dados.modulos).toHaveLength(3)
  })

  // -------------------------------------------------------------------------
  // A senha, conferida aqui e nao por um servico externo
  // -------------------------------------------------------------------------

  test('senha errada e recusada, mesmo com o usuario existindo', async () => {
    await expect(ctrl.login('fulano', 'outra-senha', 'sca_web')).rejects.toThrow(
      'Usuário ou senha inválida'
    )
  })

  test('usuario inexistente ou inativo nao chega a conferir senha', async () => {
    mockT.oneOrNone.mockResolvedValue(null)

    await expect(ctrl.login('ninguem', SENHA_CERTA, 'sca_web')).rejects.toThrow(
      'Usuário não autorizado'
    )
  })

  // Este e o estado de quem foi importado do Auth Server e ainda nao teve o
  // hash copiado por `scripts/copiar_usuarios_auth.js`. A causa e
  // administrativa, e responder "usuário ou senha inválida" mandaria a pessoa
  // tentar para sempre a senha certa. Por isso a mensagem e OUTRA, e o teste
  // guarda a diferenca: as duas passariam num `rejects.toThrow()` sem texto.
  test('senha nula tem mensagem propria, diferente de senha invalida', async () => {
    mockT.oneOrNone.mockResolvedValue(usuario({ senha: null }))

    await expect(ctrl.login('fulano', SENHA_CERTA, 'sca_web')).rejects.toThrow(
      'Usuário sem senha cadastrada no sistema'
    )
  })

  // -------------------------------------------------------------------------
  // Historico de acesso, que alimenta a tela #/acessos
  // -------------------------------------------------------------------------

  test('grava o acesso com o cliente que entrou', async () => {
    await ctrl.login('fulano', SENHA_CERTA, 'sca_qgis')

    expect(mockT.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO dgeo.login'),
      expect.objectContaining({ id: 7, cliente: 'sca_qgis' })
    )
  })

  test('login recusado NAO grava acesso', async () => {
    await expect(ctrl.login('fulano', 'errada', 'sca_web')).rejects.toThrow()

    expect(mockT.none).not.toHaveBeenCalled()
  })
})

describe('login_ctrl.conferirSenha', () => {
  test('aceita a senha vigente', async () => {
    mockDb.conn.oneOrNone.mockResolvedValue({ senha: HASH })

    await expect(ctrl.conferirSenha('uuid-7', SENHA_CERTA)).resolves.toBeUndefined()
  })

  test('recusa senha errada com a mensagem da troca de senha', async () => {
    mockDb.conn.oneOrNone.mockResolvedValue({ senha: HASH })

    await expect(ctrl.conferirSenha('uuid-7', 'outra')).rejects.toThrow(
      'Senha atual inválida'
    )
  })

  test('usuario inativo cai em nao encontrado, e nao em senha invalida', async () => {
    mockDb.conn.oneOrNone.mockResolvedValue(null)

    await expect(ctrl.conferirSenha('uuid-7', SENHA_CERTA)).rejects.toThrow(
      'Usuário não encontrado ou inativo'
    )
  })
})
