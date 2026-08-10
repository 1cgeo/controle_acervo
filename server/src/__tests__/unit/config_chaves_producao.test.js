'use strict'

// AS TRES CHAVES DO BANCO DE EDICAO, COBRADAS NO ARRANQUE.
//
// POR QUE ISTO E UM TESTE, E NAO CONFIANCA NO Joi. `PRODUCAO_DB_ADMIN_USER` e
// `PRODUCAO_DB_ADMIN_PASSWORD` ficaram FORA do `configSchema` ate 2026-08-09,
// lidas direto de `process.env` por `database/conexao_admin.js`. Enquanto
// estiveram de fora, meia configuracao nao tinha onde aparecer: ela virava 503
// na primeira requisicao de quem fosse iniciar uma atividade, longe de quem
// digitou o arquivo.
//
// O QUE MUDA A REGRA DE LUGAR e a terceira chave. `PRODUCAO_DB_HOSTS` e a lista
// de servidores que esta instalacao pode discar, e sem ela `conexao_admin.js`
// RECUSA toda discagem -- que e o lado seguro da ausencia, e tambem um jeito
// silencioso de desligar o subsistema de quem ja tinha as outras duas. O boot e
// o unico lugar que consegue dizer isso em voz alta.
//
// ESTE ARQUIVO NAO ABRE CONEXAO e por isso cai no pacote `test:rapido`.

const CHAVES = [
  'PRODUCAO_DB_ADMIN_USER',
  'PRODUCAO_DB_ADMIN_PASSWORD',
  'PRODUCAO_DB_HOSTS'
]

const limpar = () => {
  for (const chave of CHAVES) delete process.env[chave]
}

/**
 * Carrega `config.js` do zero com o ambiente de agora.
 *
 * `errorHandler` E DUBLADO POR `jest.doMock`, e nao por `spyOn`: `config.js` le
 * o ambiente no `require`, entao ele precisa entrar num registro de modulos
 * limpo (`isolateModules`) -- e ali o `errorHandler` tambem nasce de novo, o que
 * deixaria qualquer espiao no objeto de fora para tras. O duble e preciso porque
 * o `critical` de verdade chama `process.exit(1)`, que aqui derrubaria o worker
 * do Jest em vez de reprovar o teste.
 */
const carregar = () => {
  const reclamacoes = []
  let config = null

  jest.isolateModules(() => {
    jest.doMock('../../utils/error_handler', () => ({
      critical: err => reclamacoes.push(`${err.message} ${err.errorTrace || ''}`),
      log: () => {}
    }))
    config = require('../../config')
  })

  jest.dontMock('../../utils/error_handler')
  return { config, reclamacoes }
}

const original = {}

beforeAll(() => {
  for (const chave of CHAVES) original[chave] = process.env[chave]
})

afterEach(() => {
  limpar()
  jest.restoreAllMocks()
})

afterAll(() => {
  for (const chave of CHAVES) {
    if (original[chave] === undefined) delete process.env[chave]
    else process.env[chave] = original[chave]
  }
})

describe('as tres chaves do acesso administrativo aos bancos de edicao', () => {
  // O ESTADO NORMAL de quem nao tem banco de edicao com controle de permissao: o
  // servico sobe inteiro, e as rotas de gerencia respondem 503.
  it('nenhuma das tres nao atrapalha o arranque', () => {
    limpar()
    const { reclamacoes } = carregar()
    expect(reclamacoes).toEqual([])
  })

  it('as tres preenchidas passam, e o valor chega ao objeto de configuracao', () => {
    limpar()
    process.env.PRODUCAO_DB_ADMIN_USER = 'papel-de-teste'
    process.env.PRODUCAO_DB_ADMIN_PASSWORD = 'valor-de-teste'
    process.env.PRODUCAO_DB_HOSTS = 'servidor_de_edicao,outro_servidor:5433'

    const { config, reclamacoes } = carregar()

    expect(reclamacoes).toEqual([])
    expect(config.PRODUCAO_DB_HOSTS).toBe('servidor_de_edicao,outro_servidor:5433')
  })

  // O CASO QUE MOTIVA A COBRANCA: credencial de superusuario sem lista de
  // servidores. Antes, ele subia e so falhava na primeira atividade.
  it('credencial sem a lista de servidores mata o arranque, dizendo qual falta', () => {
    limpar()
    process.env.PRODUCAO_DB_ADMIN_USER = 'papel-de-teste'
    process.env.PRODUCAO_DB_ADMIN_PASSWORD = 'valor-de-teste'

    const { reclamacoes } = carregar()

    expect(reclamacoes).toHaveLength(1)
    expect(reclamacoes[0]).toContain('PRODUCAO_DB_HOSTS')
  })

  it.each([
    ['so o usuario', { PRODUCAO_DB_ADMIN_USER: 'papel-de-teste' }],
    ['so a lista', { PRODUCAO_DB_HOSTS: 'servidor_de_edicao' }],
    [
      'lista e senha, sem o usuario',
      { PRODUCAO_DB_HOSTS: 'servidor_de_edicao', PRODUCAO_DB_ADMIN_PASSWORD: 'valor-de-teste' }
    ]
  ])('meia configuracao (%s) nao chega a rodar', (_nome, valores) => {
    limpar()
    Object.assign(process.env, valores)

    const { reclamacoes } = carregar()

    expect(reclamacoes).toHaveLength(1)
    expect(reclamacoes[0]).toContain('required peers')
  })

  // CHAVE PRESENTE E EM BRANCO E O ESTADO de quem editou o `config.env` a mao, e
  // tambem o do arquivo que `create_config.js` escreve quando se responde que
  // nao. Ela conta como AUSENTE (`vazioEhAusente`), e nao como "presente" para o
  // `Joi.and`, que cobraria as outras duas de toda instalacao.
  it('as tres presentes e em branco valem por nenhuma', () => {
    limpar()
    process.env.PRODUCAO_DB_ADMIN_USER = ''
    process.env.PRODUCAO_DB_ADMIN_PASSWORD = ''
    process.env.PRODUCAO_DB_HOSTS = '   '

    const { reclamacoes } = carregar()

    expect(reclamacoes).toEqual([])
  })
})
