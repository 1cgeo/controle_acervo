'use strict'

// A AUSENCIA da copia do mes anterior no RPCMTec, provada em tres camadas.
//
// Em 2026-08-06 saiu do sistema a acao que trazia as subsecoes digitadas da
// edicao anterior para a de agora. A razao e do documento, e nao do codigo: o
// RPCMTec e o relatorio DAQUELE mes. A linha que chega pronta nao e relida, e o
// documento assinado passava a afirmar sobre agosto o que aconteceu em julho.
//
// FOI PODA, e nao desativacao. Este arquivo existe para que a volta da acao
// quebre um teste, em vez de passar despercebida numa revisao.
//
// ESTE ARQUIVO NAO USA BANCO, de proposito. Ele monta o roteador real num app
// Express minimo, com `database` e `login` mockados, e por isso cai no pacote
// `rapido`. A prova que exige banco (a edicao de julho que nasce vazia com
// junho preenchido) mora em routes/rpcmtec.test.js.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.1.0', load: jest.fn() }
}))
jest.mock('../../login', () => require('../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../helpers/orcamento/testApp')

const rpcmtecRouter = require('../../rpcmtec/rpcmtec_route')
const rpcmtecSchema = require('../../rpcmtec/rpcmtec_schema')
const subsecaoCtrl = require('../../rpcmtec/rpcmtec_subsecao_ctrl')

const app = buildTestApp([{ path: '/rpcmtec', router: rpcmtecRouter }])

beforeEach(() => mockDb.reset())

describe('RPCMTec: a rota de copiar o mes anterior nao existe', () => {
  test('POST /rpcmtec/:id/copiar-mes-anterior responde 404', async () => {
    const res = await request(app).post('/rpcmtec/1/copiar-mes-anterior').send({})

    // Antes da poda esta chamada respondia 200, com a lista das subsecoes
    // copiadas no envelope. Hoje nenhuma rota casa, e quem responde e o 404
    // padrao do Express: sem envelope `success`.
    expect(res.status).toBe(404)
    expect(res.body.success).toBeUndefined()
  })

  test('sem o numero no corpo tambem responde 404', async () => {
    // A acao aceitava o corpo vazio, que era a forma de copiar TODAS as
    // digitadas de uma vez. Nem o corpo vazio nem o corpo com numero acham rota.
    const res = await request(app)
      .post('/rpcmtec/1/copiar-mes-anterior')
      .send({ numero: '7.1' })

    expect(res.status).toBe(404)
  })

  test('VARIANCIA: o mesmo app serve as rotas que continuam existindo', async () => {
    // Sem este caso, os dois acima passariam com o roteador desmontado, com o
    // prefixo errado ou com o app vazio: ai TUDO responderia 404 e a prova nao
    // valeria nada.
    const res = await request(app).get('/rpcmtec/anos')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('nenhuma rota do roteador cita a copia no caminho', async () => {
    const caminhos = rpcmtecRouter.stack
      .filter(camada => camada.route)
      .map(camada => camada.route.path)

    // VARIANCIA: o roteador tem mesmo rotas, senao o `every` abaixo passaria
    // sobre uma lista vazia.
    expect(caminhos.length).toBeGreaterThan(20)
    expect(caminhos.filter(p => p.includes('copiar'))).toEqual([])
  })
})

describe('RPCMTec: o schema e o controlador da copia sairam junto', () => {
  test('o schema do corpo da copia nao existe mais', () => {
    // VARIANCIA: o modulo de schemas continua carregado e povoado.
    expect(rpcmtecSchema.revisarSubsecao).toBeDefined()
    expect(rpcmtecSchema.copiarMesAnterior).toBeUndefined()
  })

  test('o controlador da subsecao nao exporta mais a copia', () => {
    // VARIANCIA: as duas acoes que ficaram continuam exportadas.
    expect(typeof subsecaoCtrl.gravar).toBe('function')
    expect(typeof subsecaoCtrl.limpar).toBe('function')

    expect(subsecaoCtrl.copiarDoMesAnterior).toBeUndefined()
    expect(Object.keys(subsecaoCtrl).filter(k => /copiar/i.test(k))).toEqual([])
  })
})
