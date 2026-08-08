'use strict'

// A GUARDA DO RPCMTec depois da decisão do chefe, de 2026-08-08.
//
// A regra tem três níveis, e cada um destes describes prova um:
//
//   LER      qualquer GERENTE, de qualquer módulo, lê o relatório INTEIRO: a
//            lista, a edição, o documento, o PDF, os anexos e as duas planilhas
//            que sobem para a DSG no mesmo envio.
//   ESCREVER o gerente altera a subseção DO MÓDULO DELE, e só ela. A subseção do
//            módulo vizinho responde 403, e a que não é de módulo nenhum também.
//   ASSINAR  criar, excluir, FECHAR e REABRIR continuam do ADMINISTRADOR. É o
//            documento que o chefe da Divisão assina.
//
// POR QUE ESTE ARQUIVO NÃO MOCKA O LOGIN: quem decide são o `verifyGerente` e o
// `verifyModuloSubsecao`, e os dois leem o perfil do BANCO a cada requisição, e
// não do token. Dublar o login provaria que a rota chama uma função, e não que o
// gerente da mapoteca é barrado na seção do orçamento. Aqui o JWT é assinado e
// validado de verdade, e só o banco é dublê. Mesma forma de
// `pit_acesso_guarda.test.js` e de `rpcmtec_capacitacao_guarda.test.js`.
//
// O QUE NÃO SE PROVA AQUI, e por escolha: o SQL do relatório, que é do banco de
// verdade (`routes/rpcmtec.test.js`). Toda asserção deste arquivo é sobre 403 e
// "não 403".

const jwt = require('jsonwebtoken')
const request = require('supertest')

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const { buildTestApp } = require('../helpers/orcamento/testApp')
const { JWT_SECRET } = require('../../config')
const { rpcmtecRoute } = require('../../rpcmtec')
const estrutura = require('../../rpcmtec/rpcmtec_estrutura')

const UUID = '11111111-1111-1111-1111-111111111111'

const app = buildTestApp([{ path: '/rpcmtec', router: rpcmtecRoute }])

const token = () =>
  'Bearer ' + jwt.sign({ id: 1, uuid: UUID }, JWT_SECRET, { expiresIn: '1h' })

/**
 * As leituras que as guardas fazem, na ordem em que acontecem:
 *
 *   1. `oneOrNone`  a linha do usuário ativo (verifyGerente);
 *   2. `one`        existe perfil de gerente em ALGUM módulo (verifyGerente);
 *   3. `one`        existe perfil de gerente NAQUELE módulo
 *                   (verifyModuloSubsecao), só nas rotas de subseção.
 *
 * O administrador global curto-circuita a 2 e a 3.
 */
const quemEntra = ({
  administrador = false, gerenteEmAlgum = false, gerenteNoModulo = false
} = {}) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, administrador })
  mockDb.conn.one.mockResolvedValueOnce({ gerente: gerenteEmAlgum })
  mockDb.conn.one.mockResolvedValueOnce({ gerente: gerenteNoModulo })
}

beforeEach(() => mockDb.reset())

// ---------------------------------------------------------------------------
// LER
// ---------------------------------------------------------------------------

// O relatório inteiro, pelos endereços que a tela chama. O Anuário e o RTM
// entram na lista porque são dois botões da MESMA barra: deixá-los no
// administrador daria à tela do gerente dois botões que respondem 403.
const LEITURAS = [
  '/rpcmtec',
  '/rpcmtec/anos',
  '/rpcmtec/1',
  '/rpcmtec/1/documento',
  '/rpcmtec/1/pdf',
  '/rpcmtec/1/conferir',
  '/rpcmtec/1/anexos',
  '/rpcmtec/anexo/1/download',
  '/rpcmtec/anuario?ano=2026&mes=7',
  '/rpcmtec/anuario/ods?ano=2026&mes=7',
  '/rpcmtec/rtm/ods?ano=2026&mes=7'
]

describe('LER o RPCMTec é de QUALQUER gerente', () => {
  test.each(LEITURAS)('GET %s aceita o gerente de um módulo só', async (caminho) => {
    quemEntra({ administrador: false, gerenteEmAlgum: true })

    const res = await request(app).get(caminho).set('Authorization', token())

    // A asserção é sobre a GUARDA. Com o banco dublê o controlador responde 404
    // ou 500 conforme a rota, e o que importa aqui é não ter sido 403.
    expect(res.status).not.toBe(403)
  })

  test.each(LEITURAS)('GET %s recusa quem não é gerente em módulo nenhum', async (caminho) => {
    quemEntra({ administrador: false, gerenteEmAlgum: false })

    const res = await request(app).get(caminho).set('Authorization', token())

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/gerente em nenhum módulo/i)
  })

  test.each(LEITURAS)('GET %s aceita o administrador global', async (caminho) => {
    // `gerenteEmAlgum: false` prova que quem o deixou passar foi a coluna
    // `administrador`: ele nem chega à segunda consulta.
    quemEntra({ administrador: true, gerenteEmAlgum: false })

    const res = await request(app).get(caminho).set('Authorization', token())

    expect(res.status).not.toBe(403)
  })

  test.each(LEITURAS)('GET %s sem token vira 401', async (caminho) => {
    const res = await request(app).get(caminho)

    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// ESCREVER uma subseção
// ---------------------------------------------------------------------------

// Uma subseção de cada módulo, pelo mapa de `rpcmtec_estrutura.js`. A lista é
// escrita à mão, e não derivada da estrutura, porque é justamente o mapa que se
// quer provar: derivá-la dele faria o teste concordar com qualquer troca.
const SUBSECOES = [
  ['2.1', 'producao'],
  ['2.7', 'acervo'],
  ['3.1', 'mapoteca'],
  ['4.2', 'orcamento'],
  ['6.1', 'efetivo']
]

// As três rotas que mudam UMA subseção pelo `:numero` do caminho. A quarta (a
// importação da 5.1) tem o número fixo na rota e está no describe do fim.
const ESCRITAS = [
  ['put', (numero) => `/rpcmtec/1/subsecao/${numero}`],
  ['delete', (numero) => `/rpcmtec/1/subsecao/${numero}`],
  ['put', (numero) => `/rpcmtec/1/subsecao/${numero}/revisao`]
]

describe('O mapa subseção -> módulo é o que a estrutura declara', () => {
  test.each(SUBSECOES)('a subseção %s é do módulo %s', (numero, modulo) => {
    expect(estrutura.bloco(numero).modulo).toBe(modulo)
  })

  // A chave é OBRIGATÓRIA, e o carregamento de `verify_modulo_subsecao.js` já a
  // cobra. Aqui ela se prova de novo, porque a mensagem daquele erro só aparece
  // no boot e ninguém a leria numa suíte verde.
  test('toda subseção declara o módulo dela, mesmo as de módulo nenhum', () => {
    const mudas = estrutura.BLOCOS.filter(b => !('modulo' in b))

    expect(mudas.map(b => b.numero)).toEqual([])
  })
})

describe.each(SUBSECOES)('A subseção %s, do módulo %s', (numero, modulo) => {
  test.each(ESCRITAS)(
    `%s: o gerente de ${modulo} altera a ${numero}`,
    async (metodo, caminho) => {
      quemEntra({ gerenteEmAlgum: true, gerenteNoModulo: true })

      const res = await request(app)[metodo](caminho(numero))
        .set('Authorization', token()).send({ revisado: true })

      expect(res.status).not.toBe(403)
    }
  )

  test.each(ESCRITAS)(
    `%s: o gerente de OUTRO módulo não altera a ${numero}`,
    async (metodo, caminho) => {
      // Gerente em ALGUM módulo (passa a primeira guarda) e NÃO neste (para na
      // segunda). É o gerente da mapoteca diante da seção do orçamento.
      quemEntra({ gerenteEmAlgum: true, gerenteNoModulo: false })

      const res = await request(app)[metodo](caminho(numero))
        .set('Authorization', token()).send({ revisado: true })

      expect(res.status).toBe(403)
      // A mensagem NOMEIA o módulo: é o que impede o mapa de ter mudado sem
      // ninguém ver, e é o que a pessoa precisa ler para saber o que pedir.
      expect(res.body.message).toMatch(
        new RegExp(`módulo ${modulo}`, 'i')
      )
    }
  )

  test.each(ESCRITAS)(
    `%s: o administrador global altera a ${numero}`,
    async (metodo, caminho) => {
      quemEntra({ administrador: true, gerenteEmAlgum: false, gerenteNoModulo: false })

      const res = await request(app)[metodo](caminho(numero))
        .set('Authorization', token()).send({ revisado: true })

      expect(res.status).not.toBe(403)
    }
  )
})

// As de módulo nenhum: a finalidade, o desenvolvimento e a TI, o equipamento, a
// divulgação e as lições do chefe. Elas ficaram com o administrador, e este é o
// caso que impede o `null` de virar "passa qualquer um" numa refatoração.
const SEM_MODULO = ['1.1', '5.2', '7.1', '8.4', '9.1']

describe('Subseção de módulo nenhum continua sendo do administrador', () => {
  test.each(SEM_MODULO)('o gerente não altera a %s', async (numero) => {
    quemEntra({ gerenteEmAlgum: true, gerenteNoModulo: true })

    const res = await request(app).put(`/rpcmtec/1/subsecao/${numero}`)
      .set('Authorization', token()).send({ linhas: [] })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/não é de módulo nenhum/i)
  })

  test.each(SEM_MODULO)('o administrador altera a %s', async (numero) => {
    quemEntra({ administrador: true })

    const res = await request(app).put(`/rpcmtec/1/subsecao/${numero}`)
      .set('Authorization', token()).send({ linhas: [] })

    expect(res.status).not.toBe(403)
  })

  // A importação do CSV é da 5.1, que hoje é de módulo nenhum. O número está no
  // CAMINHO, e a guarda o recebe pronto: se ela lesse `req.params.numero` aqui,
  // leria `undefined` e o mapa não seria consultado.
  test('a importação da 5.1 recusa o gerente', async () => {
    quemEntra({ gerenteEmAlgum: true, gerenteNoModulo: true })

    const res = await request(app).post('/rpcmtec/1/subsecao/5.1/importar')
      .set('Authorization', token()).send({ csv: 'repo,commits\n' })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/5\.1 não é de módulo nenhum/i)
  })
})

// Um número que não é subseção nenhuma para na guarda, e a resposta NÃO repete o
// que o cliente mandou: quem não é administrador não descobre por esta porta
// quais números existem.
describe('Número que não é subseção nenhuma', () => {
  test('para na guarda, sem eco do que o cliente mandou', async () => {
    quemEntra({ gerenteEmAlgum: true, gerenteNoModulo: true })

    const res = await request(app).put('/rpcmtec/1/subsecao/42.42')
      .set('Authorization', token()).send({ linhas: [] })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/não existe no RPCMTec/i)
    expect(res.body.message).not.toMatch(/42/)
  })
})

// ---------------------------------------------------------------------------
// ASSINAR
// ---------------------------------------------------------------------------

// Fechar e reabrir congelam e descongelam o documento inteiro, e criar e excluir
// abrem e apagam o mês. Nenhum é ato de gerente de módulo: a peça é UMA, e um
// gerente congelaria também as oito seções que não são dele.
const DO_ADMINISTRADOR = [
  ['post', '/rpcmtec/1/fechar'],
  ['post', '/rpcmtec/1/reabrir'],
  ['post', '/rpcmtec'],
  ['put', '/rpcmtec/1'],
  ['delete', '/rpcmtec/1'],
  ['post', '/rpcmtec/1/anexos'],
  ['delete', '/rpcmtec/anexo/1']
]

describe('Fechar, reabrir e o resto da assinatura continuam do administrador', () => {
  test.each(DO_ADMINISTRADOR)(
    '%s %s recusa o gerente de todos os módulos',
    async (metodo, caminho) => {
      // Gerente em algum módulo E no módulo consultado: mesmo o gerente mais
      // graduado que existe não passa, porque a rota não é de módulo nenhum.
      quemEntra({ gerenteEmAlgum: true, gerenteNoModulo: true })

      const res = await request(app)[metodo](caminho)
        .set('Authorization', token()).send({})

      expect(res.status).toBe(403)
      expect(res.body.message).toMatch(/administrador/i)
    }
  )

  test.each(DO_ADMINISTRADOR)('%s %s aceita o administrador', async (metodo, caminho) => {
    quemEntra({ administrador: true })

    const res = await request(app)[metodo](caminho)
      .set('Authorization', token()).send({})

    expect(res.status).not.toBe(403)
  })
})

// A recusa acontece ANTES de o controlador tocar o banco. Provar pelo 403 não
// basta: um 403 vindo de outro middleware satisfaria o caso.
describe('A guarda barra antes de ler o relatório', () => {
  test('quem não é gerente não chega à consulta das edições', async () => {
    quemEntra({ gerenteEmAlgum: false })

    const res = await request(app).get('/rpcmtec').set('Authorization', token())

    expect(res.status).toBe(403)
    expect(mockDb.conn.any).not.toHaveBeenCalled()
  })

  // A conta INATIVA para no primeiro passo, e nem chega à pergunta do perfil:
  // desativar alguém vale na hora, e não no fim do JWT_EXPIRACAO.
  test('usuário inativo é barrado sem que se pergunte pelo perfil', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    const res = await request(app).get('/rpcmtec').set('Authorization', token())

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/inativo/i)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })
})
