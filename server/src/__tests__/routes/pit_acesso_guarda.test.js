'use strict'

// A GUARDA DA LEITURA DO PIT: ela pede ACESSO AO SISTEMA, e não só sessão.
//
// O PIT do ano e o Extra-PIT são rotas de PLATAFORMA: não têm prefixo de módulo
// e não pedem perfil num módulo específico, porque os módulos consomem a
// lista. Elas eram `verifyLogin`, e a diferença é a conta RECÉM-CRIADA: ela
// nasce sem nenhuma linha em `dgeo.usuario_perfil`, está logada e não está no
// sistema. O plano de trabalho da Divisão inteira não é o que ela vê enquanto
// espera a concessão.
//
// POR QUE ESTE ARQUIVO NÃO MOCKA O LOGIN: quem decide é o `verifyAcesso`, e ele
// lê o perfil do BANCO a cada requisição, e não do token. Dublar o login
// provaria que a rota chama uma função, e não que a conta sem concessão é
// barrada. Aqui o JWT é assinado e validado de verdade, e só o banco é dublê.

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

// As duas leituras que o `verifyAcesso` faz, nesta ordem: a linha do usuário
// ativo e a existência de QUALQUER perfil. O administrador global curto-circuita
// a segunda.
const quemEntra = ({ administrador = false, temAcesso = false } = {}) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, administrador })
  mockDb.conn.one.mockResolvedValueOnce({ temAcesso })
}

// As leituras que a conta sem concessão alcançava: a lista do ano, os anos com
// meta e a lista do Extra-PIT.
const LEITURAS = [
  ['/metas?ano=2026'],
  ['/metas/anos'],
  ['/metas/extra?ano=2026']
]

beforeEach(() => mockDb.reset())

describe('Leitura do PIT: quem não tem perfil em módulo nenhum não entra', () => {
  test.each(LEITURAS)(
    'GET %s recusa a conta logada e sem concessão nenhuma',
    async (caminho) => {
      quemEntra({ administrador: false, temAcesso: false })

      const res = await request(app).get(caminho).set('Authorization', token())

      expect(res.status).toBe(403)
      // A mensagem diz o passo seguinte, e não só que o acesso foi negado: é a
      // mesma frase que a tela de perfil mostra a essa pessoa.
      expect(res.body.message).toMatch(/administrador do sistema/i)
    }
  )

  // Qualquer perfil, em qualquer módulo, basta: a rota é de plataforma, e exigir
  // um módulo específico esconderia o plano anual de quem trabalha noutro.
  test.each(LEITURAS)('GET %s aceita quem tem perfil em algum módulo', async (caminho) => {
    quemEntra({ administrador: false, temAcesso: true })

    const res = await request(app).get(caminho).set('Authorization', token())

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test.each(LEITURAS)(
    'GET %s aceita o administrador global, que não tem linha de perfil',
    async (caminho) => {
      // `temAcesso: false` prova que quem o deixou passar foi a coluna
      // `administrador`: ele nem chega à segunda consulta.
      quemEntra({ administrador: true, temAcesso: false })

      const res = await request(app).get(caminho).set('Authorization', token())

      expect(res.status).toBe(200)
    }
  )

  test.each(LEITURAS)('GET %s sem token vira 401', async (caminho) => {
    const res = await request(app).get(caminho)

    expect(res.status).toBe(401)
  })
})

// A recusa acontece ANTES do controller tocar o banco. Provar pelo 403 não
// basta: um 403 vindo de outro middleware satisfaria o caso.
describe('A guarda barra antes de ler as metas', () => {
  test('a conta sem concessão não chega à consulta do PIT', async () => {
    quemEntra({ administrador: false, temAcesso: false })

    const res = await request(app).get('/metas?ano=2026').set('Authorization', token())

    expect(res.status).toBe(403)
    expect(mockDb.conn.any).not.toHaveBeenCalled()
  })

  // A conta INATIVA para no primeiro passo, e nem chega à pergunta do perfil:
  // desativar alguém vale na hora, e não no fim do JWT_EXPIRACAO.
  test('usuário inativo é barrado sem que se pergunte pelo perfil', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    const res = await request(app).get('/metas?ano=2026').set('Authorization', token())

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/inativo/i)
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })
})
