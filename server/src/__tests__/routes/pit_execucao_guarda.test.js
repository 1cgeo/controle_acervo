'use strict'

// A GUARDA DA GRADE DO PIT: as leituras da execução são de CONSULTA EM PRODUÇÃO.
//
// A grade responde quanto cada meta planejou e quanto entregou, mês a mês. As
// três leituras diretas (`/execucao`, `/execucao/resumo`,
// `/execucao/meta/:metaId`), o DIAGNÓSTICO e o ENSAIO devolvem o mesmo dado,
// então uma guarda mais fraca em qualquer uma delas seria o caminho de volta
// para quem as outras barram.
//
// A REGRA MUDOU EM 2026-08-08, e este arquivo mudou com ela. Era `verifyGerente`
// nas cinco, e o desenho antigo errava em dois eixos ao mesmo tempo:
//
//   NO NÍVEL   exigia GERENTE para OLHAR o que o OPERADOR lança. Quem preenche a
//              execução não podia conferir a própria grade.
//   NO MÓDULO  o `verifyGerente` aceita o gerente de QUALQUER módulo, então o
//              gerente da mapoteca lia a grade da produção, e o operador de
//              Produção não lia.
//
// A régua nova é a dos três módulos: CONSULTA lê, OPERADOR lança, GERENTE
// responde pela área. Aqui isso vira `verifyPerfil('consulta', 'producao')` na
// leitura, com a escrita intocada em `verifyPerfil('operador', 'producao')`.
//
// O QUE ESTE ARQUIVO PROVA, e por que ele não mocka o login: quem decide é o
// `verifyPerfil`, e ele lê o perfil do BANCO a cada requisição, e não do token.
// Dublar o login provaria que a rota chama uma função, e não que pessoa sem
// perfil em Produção é barrada. Aqui o JWT é assinado e validado de verdade, e
// só o banco é dublê.

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

// dominio.modulo: 4 é producao. O número aparece aqui de propósito, e não vem de
// `verify_perfil.js`: importar o mapa de lá faria o teste concordar com o fonte
// mesmo se o fonte trocasse de módulo.
const MODULO_PRODUCAO = 4

const PERFIL = { consulta: 1, operador: 2, gerente: 3 }

const app = buildTestApp([{ path: '/metas', router: pitRoute }])

const token = () =>
  'Bearer ' + jwt.sign({ id: 1, uuid: UUID }, JWT_SECRET, { expiresIn: '1h' })

// A ÚNICA leitura que o `verifyPerfil` faz: a linha do usuário ativo com o
// `perfil_id` daquele módulo (LEFT JOIN, então NULO é "não tem linha lá"). O
// administrador global curto-circuita a comparação de nível.
const quemEntra = ({ administrador = false, perfil = null } = {}) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({
    id: 1,
    administrador,
    perfil_id: perfil
  })
}

// AS CINCO leituras da grade, com uma query que o Joi de cada uma aceita.
//
// O DIAGNÓSTICO e o ENSAIO entram na lista, e não é detalhe: os dois devolvem o
// planejado meta a meta, que é o dado de `/execucao`. Uma lista que só cobrisse
// as três diretas deixaria dois endereços livres para divergir.
const LEITURAS_DA_GRADE = [
  ['/metas/execucao?ano=2026'],
  ['/metas/execucao/resumo?ano=2026'],
  ['/metas/execucao/meta/7'],
  ['/metas/execucao/diagnostico?ano=2026'],
  ['/metas/execucao/ensaio?ano=2026']
]

beforeEach(() => mockDb.reset())

describe('Leitura da grade do PIT: sem perfil em Produção, não entra', () => {
  test.each(LEITURAS_DA_GRADE)(
    'GET %s recusa quem está logado e não tem linha em Produção',
    async (caminho) => {
      quemEntra({ administrador: false, perfil: null })

      const res = await request(app).get(caminho).set('Authorization', token())

      expect(res.status).toBe(403)
      // A mensagem NOMEIA o nível e o módulo que faltaram. Sem checar o nome, um
      // 403 vindo de outro middleware (ou do módulo errado, que é a armadilha do
      // default 'acervo' do verifyPerfil) satisfaria o caso.
      expect(res.body.message).toMatch(/perfil consulta no módulo producao/i)
    }
  )

  test.each(LEITURAS_DA_GRADE)('GET %s aceita quem tem CONSULTA', async (caminho) => {
    quemEntra({ administrador: false, perfil: PERFIL.consulta })

    const res = await request(app).get(caminho).set('Authorization', token())

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  // A HIERARQUIA: quem lança também lê. Era exatamente isto que o
  // `verifyGerente` negava, e é a metade visível do defeito que a mudança
  // conserta.
  test.each(LEITURAS_DA_GRADE)('GET %s aceita o OPERADOR, que é quem lança', async (caminho) => {
    quemEntra({ administrador: false, perfil: PERFIL.operador })

    const res = await request(app).get(caminho).set('Authorization', token())

    expect(res.status).toBe(200)
  })

  test.each(LEITURAS_DA_GRADE)(
    'GET %s aceita o administrador global, sem perfil de módulo nenhum',
    async (caminho) => {
      // O administrador passa com `perfil_id` NULO: prova que quem o deixou
      // entrar foi a coluna `administrador`, e não uma concessão de módulo.
      quemEntra({ administrador: true, perfil: null })

      const res = await request(app).get(caminho).set('Authorization', token())

      expect(res.status).toBe(200)
    }
  )

  test.each(LEITURAS_DA_GRADE)('GET %s sem token vira 401', async (caminho) => {
    const res = await request(app).get(caminho)

    expect(res.status).toBe(401)
  })
})

// O COMPARTIMENTO É PRODUÇÃO, e provar isso pelo 403 é impossível: o gerente da
// mapoteca e a conta sem concessão nenhuma produzem a MESMA resposta, porque o
// LEFT JOIN por `modulo_id` devolve `perfil_id` nulo nos dois casos. O que separa
// um do outro é o módulo que a consulta pergunta, e é ele que se lê aqui.
describe('A grade pergunta pelo perfil no módulo PRODUÇÃO', () => {
  test.each(LEITURAS_DA_GRADE)('GET %s consulta o modulo_id 4', async (caminho) => {
    quemEntra({ administrador: false, perfil: PERFIL.consulta })

    await request(app).get(caminho).set('Authorization', token())

    expect(mockDb.conn.oneOrNone).toHaveBeenCalledWith(
      expect.stringContaining('dgeo.usuario_perfil'),
      { uuid: UUID, moduloId: MODULO_PRODUCAO }
    )
  })
})

// A recusa acontece ANTES do controller tocar o banco. Provar pelo 403 não
// basta: um 403 vindo de outro middleware satisfaria o caso.
describe('A guarda barra antes de ler a grade', () => {
  test('quem não tem perfil em Produção não chega à consulta da execução', async () => {
    quemEntra({ administrador: false, perfil: null })

    const res = await request(app)
      .get('/metas/execucao/ensaio?ano=2026')
      .set('Authorization', token())

    expect(res.status).toBe(403)
    // `conn.any` é como o controller do ensaio lê a grade. Nenhuma chamada
    // significa que a guarda parou a requisição antes dele.
    expect(mockDb.conn.any).not.toHaveBeenCalled()
  })

  test('quem tem consulta chega, e o ensaio recebe o ano pedido', async () => {
    quemEntra({ administrador: false, perfil: PERFIL.consulta })

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

// CONTROLE do que NÃO afrouxou. Sem este bloco, a mudança poderia ter baixado a
// grade E a escrita para consulta, e todos os casos acima continuariam verdes.
describe('A ESCRITA da execução continua sendo do operador', () => {
  const ESCRITAS = [
    ['post', '/metas/execucao'],
    ['delete', '/metas/execucao/1']
  ]

  test.each(ESCRITAS)('%s %s recusa quem só tem CONSULTA', async (metodo, caminho) => {
    quemEntra({ administrador: false, perfil: PERFIL.consulta })

    // O corpo não precisa ser válido: a guarda roda ANTES do `schemaValidation`,
    // então a recusa acontece sem chegar ao Joi.
    const res = await request(app)[metodo](caminho).set('Authorization', token())

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil operador no módulo producao/i)
  })
})
