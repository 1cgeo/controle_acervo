'use strict'

// Teste unitario do controller de login, com o BANCO mockado e o bcrypt DE
// VERDADE. A conferencia da senha e LOCAL, e e o que este arquivo prova:
// mockar o bcrypt provaria a consulta, e nao a conferencia.
//
// O que ele protege, alem da senha: a resposta do login carrega, FORA do token,
// o que o client precisa para montar a interface unica dos módulos.
//   - `perfis`: mapa nome_abrev -> nivel, para o client saber onde a pessoa entra
//   - `modulos`: o catalogo dominio.modulo, para o seletor exibir o NOME de cada
//     modulo em vez de decorar codigo (GET /usuarios/dominio/modulo e admin-only,
//     entao quem so tem consulta nao consegue le-lo)
//   - `instituicao`: o nome e a sigla de quem opera esta instalacao, para o
//     client DESENHAR com eles (2026-08-09). Ate essa data o "1º CGEO" estava
//     escrito em quatro lugares do client, e outro Centro veria o nosso nome
//     depois de configurar o proprio.
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

const INSTITUICAO = { nome: '1º Centro de Geoinformação', sigla: '1º CGEO' }

// O `carimbo` e a coluna `left(md5(senha), 8)` que o login le na MESMA consulta
// do hash desde 2026-09-05. Aqui ele e um dublê com a forma certa (oito
// caracteres hexadecimais); quem o CALCULA e o PostgreSQL, e o caso "o token
// leva o carimbo" prova que a consulta o pede.
const CARIMBO = '3f2504e0'

const usuario = (extra = {}) => ({
  id: 7,
  uuid: 'uuid-7',
  administrador: false,
  senha: HASH,
  carimbo: CARIMBO,
  ...extra
})

// O `oneOrNone` atende DOIS pedidos na mesma transacao: o usuario e a
// instituicao. Roteia pelo SQL, e nao pela ordem das chamadas, porque ordem se
// quebra em silencio quando alguem insere uma consulta no meio.
let usuarioAtual
let instituicaoAtual

const roteiaOneOrNone = sql =>
  Promise.resolve(
    /dgeo\.instituicao/.test(String(sql)) ? instituicaoAtual : usuarioAtual
  )

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
  usuarioAtual = usuario()
  instituicaoAtual = INSTITUICAO
  mockT.oneOrNone.mockImplementation(roteiaOneOrNone)
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

  // ---------------------------------------------------------------------------
  // O CARIMBO DA SENHA (2026-09-05)
  // ---------------------------------------------------------------------------
  //
  // Ate esta data o token nao carregava nada ligado a senha, e trocar a senha
  // NAO derrubava a sessao aberta noutra maquina: ela valia pelas oito horas do
  // `JWT_EXPIRACAO`, e o reset feito pelo administrador tambem nao expulsava
  // ninguem. O `carimbo` e o que amarra o token ao hash vigente; as sete guardas
  // o releem do banco a cada requisicao (`unit/login/carimbo_da_senha.test.js`).
  test('o token leva o carimbo da senha, com oito caracteres', async () => {
    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')
    const decoded = jwt.verify(dados.token, JWT_SECRET)

    expect(decoded.carimbo).toBe(CARIMBO)
    expect(decoded.carimbo).toHaveLength(8)
    // E ele NAO sai na resposta: quem o le e a guarda, dentro do token.
    expect(dados.carimbo).toBeUndefined()
  })

  // O NUMERO E DO POSTGRESQL, e nao deste dublê: o login pede a coluna na MESMA
  // consulta que ja lia o hash, com a expressao que as guardas conferem. Sem
  // esta metade, o caso acima provaria so que um campo do mock atravessa.
  test('o carimbo vem da consulta do login, sem ida a mais ao banco', async () => {
    await ctrl.login('fulano', SENHA_CERTA, 'sca_web')

    const doUsuario = mockT.oneOrNone.mock.calls
      .map(([sql]) => String(sql))
      .filter(sql => /FROM dgeo\.usuario/.test(sql))

    expect(doUsuario).toHaveLength(1)
    expect(doUsuario[0]).toContain('left(md5(senha), 8) AS carimbo')
  })

  // O HASH NAO SAI DO BANCO: o que viaja e o resumo de oito caracteres.
  test('o hash bcrypt nao entra no token nem na resposta', async () => {
    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')
    const decoded = jwt.verify(dados.token, JWT_SECRET)

    expect(JSON.stringify(decoded)).not.toContain(HASH)
    expect(JSON.stringify(dados)).not.toContain(HASH)
  })

  test('perfis e modulos ficam FORA do token', async () => {
    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')
    const decoded = jwt.verify(dados.token, JWT_SECRET)

    expect(decoded.uuid).toBe('uuid-7')
    expect(decoded.administrador).toBe(false)
    expect(decoded.perfis).toBeUndefined()
    expect(decoded.modulos).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // A INSTITUICAO, que o client usa para DESENHAR (2026-08-09)
  // ---------------------------------------------------------------------------

  test('devolve a instituicao desta instalacao, com nome e sigla', async () => {
    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')

    expect(dados.instituicao).toEqual(INSTITUICAO)
    expect(mockT.oneOrNone).toHaveBeenCalledWith(
      expect.stringContaining('dgeo.instituicao')
    )
  })

  // A prova que interessa: com o nome escrito no codigo do client, este teste
  // passaria e a tela continuaria errada. Aqui e o CONTRATO que se guarda -- o
  // que o banco tem e o que o client recebe.
  test('OUTRA instalacao devolve o nome DELA', async () => {
    instituicaoAtual = { nome: '4º Centro de Geoinformação', sigla: '4º CGEO' }

    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')

    expect(dados.instituicao).toEqual({
      nome: '4º Centro de Geoinformação',
      sigla: '4º CGEO'
    })
  })

  // A linha e semeada pelo `er/dgeo.sql` e pela migracao, mas um banco sem ela
  // nao pode trancar ninguem do lado de fora por causa de um rotulo. Quem cobra
  // a ausencia e o GET /api/instituicao, com a mensagem que diz o que aplicar.
  test('banco sem a linha da instituicao NAO impede o login', async () => {
    instituicaoAtual = null

    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')

    expect(dados.token).toBeTruthy()
    expect(dados.instituicao).toBeNull()
  })

  // Ela e dado de INSTALACAO, e nao credencial: cabe na resposta e nao dentro
  // do token, que e o mesmo tratamento de `perfis` e `modulos`.
  test('a instituicao tambem fica FORA do token', async () => {
    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')
    const decoded = jwt.verify(dados.token, JWT_SECRET)

    expect(decoded.instituicao).toBeUndefined()
  })

  // A senha NUNCA volta por rota, e a consulta da instituicao nao muda isso: o
  // hash e lido para conferir, e nada do usuario alem de uuid e administrador
  // sai daqui.
  test('a resposta do login nao carrega senha nenhuma', async () => {
    const dados = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')

    expect(dados.senha).toBeUndefined()
    expect(JSON.stringify(dados)).not.toContain(HASH)
  })

  test('administrador global vem no corpo, mesmo sem perfil nenhum', async () => {
    usuarioAtual = usuario({ administrador: true })
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
    usuarioAtual = null

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
    usuarioAtual = usuario({ senha: null })

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

// A rota de sessao devolve a MESMA foto do login, sem trocar o token: e o que
// o client reconfere no boot e a cada 403. A instituicao entrou nela junto,
// senao quem corrigisse o nome do Centro so o veria na sessao seguinte.
describe('login_ctrl.sessao', () => {
  beforeEach(() => {
    // Fila propria e explicita: os testes de login que rejeitam antes de chamar
    // `any` deixam pares enfileirados, e aqui o que se le tem de ser deste teste.
    mockT.any.mockReset()
    mockT.any
      .mockResolvedValueOnce([{ modulo: 'acervo', perfil_id: 1 }])
      .mockResolvedValueOnce(MODULOS)
  })

  test('devolve a mesma foto do login, com a instituicao junto', async () => {
    const dados = await ctrl.sessao('uuid-7')

    expect(dados.perfis).toEqual({ acervo: 1 })
    expect(dados.modulos).toEqual(MODULOS)
    expect(dados.instituicao).toEqual(INSTITUICAO)
    // Nao devolve token: a sessao continua sendo a mesma.
    expect(dados.token).toBeUndefined()
  })

  test('OUTRA instalacao devolve o nome DELA tambem na sessao', async () => {
    instituicaoAtual = { nome: '4º Centro de Geoinformação', sigla: '4º CGEO' }

    const dados = await ctrl.sessao('uuid-7')

    expect(dados.instituicao.sigla).toBe('4º CGEO')
  })

  test('banco sem a linha da instituicao nao derruba a sessao', async () => {
    instituicaoAtual = null

    const dados = await ctrl.sessao('uuid-7')

    expect(dados.instituicao).toBeNull()
    expect(dados.perfis).toEqual({ acervo: 1 })
  })
})

// ---------------------------------------------------------------------------
// O TOKEN DA TILE (2026-08-09)
// ---------------------------------------------------------------------------
//
// A URL da camada MVT leva credencial na QUERY, porque uma camada XYZ nao tem
// onde por cabecalho. Ate esta data quem ia ali era o token de SESSAO: oito
// horas de vida, aceito por todas as guardas, escrito inteiro em
// `logs/combined.log` pelo middleware de log e publicado pela rota aberta
// `/logs`. O que anda na URL hoje e este token: audiencia propria, minutos de
// vida, e nenhuma outra guarda o aceita (`unit/login/audiencia_do_token.test.js`).
describe('login_ctrl.tokenDeTile', () => {
  const QUEM = { id: 7, uuid: 'uuid-7', administrador: false, cliente: 'sap_web' }

  test('assina com a audiencia de tile, e nao com a de sessao', async () => {
    const { token } = await ctrl.tokenDeTile(QUEM)
    const decoded = jwt.verify(token, JWT_SECRET)

    expect(decoded.aud).toBe('tile')
    expect(decoded.uuid).toBe('uuid-7')
  })

  // MINUTOS, E NAO HORAS: e o unico ganho que o token na URL admite, porque o
  // que ficou escrito em log, historico e proxy nao se apaga.
  test('vive minutos, e muito menos que o token de sessao', async () => {
    const { token, expira_em_segundos: prazo } = await ctrl.tokenDeTile(QUEM)
    const decoded = jwt.verify(token, JWT_SECRET)

    expect(prazo).toBe(decoded.exp - decoded.iat)
    expect(prazo).toBeGreaterThan(0)
    expect(prazo).toBeLessThanOrEqual(15 * 60)

    const sessao = await ctrl.login('fulano', SENHA_CERTA, 'sca_web')
    const daSessao = jwt.verify(sessao.token, JWT_SECRET)
    expect(prazo).toBeLessThan(daSessao.exp - daSessao.iat)
  })

  // Ele NAO carrega perfil nenhum, pelo mesmo motivo do token de sessao: quem
  // decide o que a pessoa pode e a guarda, lendo o banco a cada requisicao.
  test('nao leva perfil nenhum dentro', async () => {
    const { token } = await ctrl.tokenDeTile(QUEM)
    const decoded = jwt.verify(token, JWT_SECRET)

    expect(decoded.perfis).toBeUndefined()
    // O `cliente` VAI, e e o que impede a tile de entrar no rastro como
    // 'desconhecido'.
    expect(decoded.cliente).toBe('sap_web')
  })

  // NAO LE O BANCO: quem chama e a rota sob `verifyLogin`, que acabou de
  // conferir que a conta existe e esta ativa. Uma segunda consulta aqui
  // responderia a mesma pergunta na mesma requisicao.
  test('nao vai ao banco', async () => {
    mockDb.conn.oneOrNone.mockClear()
    mockDb.conn.tx.mockClear()

    await ctrl.tokenDeTile(QUEM)

    expect(mockDb.conn.oneOrNone).not.toHaveBeenCalled()
    expect(mockDb.conn.tx).not.toHaveBeenCalled()
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
