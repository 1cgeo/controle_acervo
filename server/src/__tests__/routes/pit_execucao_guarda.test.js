'use strict'

// A GUARDA DA GRADE DO PIT: as quatro leituras da execução são de GERENTE.
//
// A grade responde quanto cada meta planejou e quanto entregou, mês a mês. As
// três leituras diretas (`/execucao`, `/execucao/resumo`,
// `/execucao/meta/:metaId`) e o ENSAIO devolvem o mesmo dado, então uma guarda
// mais fraca no ensaio seria o caminho de volta para quem a grade barra.
//
// O QUE ESTE ARQUIVO PROVA, e por que ele não mocka o login: quem decide aqui é
// o `verifyGerente`, e ele lê o perfil do BANCO a cada requisição, e não do
// token. Dublar o login provaria que a rota chama uma função, e não que pessoa
// sem perfil de gerente é barrada. Aqui o JWT é assinado e validado de verdade,
// e só o banco é dublê.
//
// A guarda passa o ADMINISTRADOR GLOBAL e o GERENTE de qualquer módulo; fora
// ficam operador e consulta.

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
const { pitRoute } = require('../../pit')

const UUID = '11111111-1111-1111-1111-111111111111'

const app = buildTestApp([{ path: '/metas', router: pitRoute }])

const token = () =>
  'Bearer ' + jwt.sign({ id: 1, uuid: UUID }, JWT_SECRET, { expiresIn: '1h' })

// As duas leituras que o `verifyGerente` faz, nesta ordem: a linha do usuário
// ativo e a existência de perfil de gerente em algum módulo. O administrador
// global curto-circuita a segunda.
const quemEntra = ({ administrador = false, gerente = false } = {}) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, administrador })
  mockDb.conn.one.mockResolvedValueOnce({ gerente })
}

// As quatro leituras da grade, com uma query que o Joi de cada uma aceita.
const LEITURAS_DA_GRADE = [
  ['/metas/execucao?ano=2026'],
  ['/metas/execucao/resumo?ano=2026'],
  ['/metas/execucao/meta/7'],
  ['/metas/execucao/ensaio?ano=2026']
]

beforeEach(() => mockDb.reset())

describe('Leitura da grade do PIT: quem não é gerente não entra', () => {
  test.each(LEITURAS_DA_GRADE)(
    'GET %s recusa quem está logado e não é gerente em módulo nenhum',
    async (caminho) => {
      quemEntra({ administrador: false, gerente: false })

      const res = await request(app).get(caminho).set('Authorization', token())

      expect(res.status).toBe(403)
      expect(res.body.message).toMatch(/gerente/i)
    }
  )

  test.each(LEITURAS_DA_GRADE)('GET %s aceita o gerente', async (caminho) => {
    quemEntra({ administrador: false, gerente: true })

    const res = await request(app).get(caminho).set('Authorization', token())

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test.each(LEITURAS_DA_GRADE)(
    'GET %s aceita o administrador global, sem perfil de módulo nenhum',
    async (caminho) => {
      // O administrador nem chega à segunda consulta: `gerente: false` prova
      // que quem o deixou passar foi a coluna `administrador`.
      quemEntra({ administrador: true, gerente: false })

      const res = await request(app).get(caminho).set('Authorization', token())

      expect(res.status).toBe(200)
    }
  )

  test.each(LEITURAS_DA_GRADE)('GET %s sem token vira 401', async (caminho) => {
    const res = await request(app).get(caminho)

    expect(res.status).toBe(401)
  })
})

// O ensaio é o caso que motiva o arquivo: ele devolve o MESMO par
// planejado/realizado das irmãs, meta a meta, então tem de cobrar o MESMO
// perfil. Provar isso pelo efeito (403 acima) não basta: um 403 vindo de outro
// middleware satisfaria o caso. Aqui se prova que a recusa acontece ANTES do
// controller tocar o banco.
describe('O ensaio barra antes de ler a grade', () => {
  test('quem não é gerente não chega à consulta da execução', async () => {
    quemEntra({ administrador: false, gerente: false })

    const res = await request(app)
      .get('/metas/execucao/ensaio?ano=2026')
      .set('Authorization', token())

    expect(res.status).toBe(403)
    // `conn.any` é como o controller do ensaio lê a grade. Nenhuma chamada
    // significa que a guarda parou a requisição antes dele.
    expect(mockDb.conn.any).not.toHaveBeenCalled()
  })

  test('o gerente chega, e a consulta do ensaio recebe o ano pedido', async () => {
    quemEntra({ administrador: false, gerente: true })

    const res = await request(app)
      .get('/metas/execucao/ensaio?ano=2026')
      .set('Authorization', token())

    expect(res.status).toBe(200)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('planejada_calculada'),
      { ano: 2026, metaId: null }
    )
  })
})
