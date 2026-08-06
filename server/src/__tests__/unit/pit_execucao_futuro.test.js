'use strict'

// NAO SE LANCA REALIZADO DE MES QUE AINDA NAO CHEGOU.
//
// Realizado e o que a Divisao ENTREGOU, e novembro nao entregou nada em agosto.
// O numero lancado adiantado entra na grade, soma no acumulado e vai para a
// subsecao 2.1 do RPCMTec como producao do mes: o documento assinado passa a
// afirmar entrega que nao houve.
//
// AS TRES VARIANCIAS deste arquivo, e sem elas a guarda nao estaria provada:
//
//   1. o PLANEJADO de mes futuro passa. Distribuir a meta pelos meses do ano e
//      o trabalho normal do planejamento, e proibir isso o quebraria;
//   2. o mes CORRENTE passa. Ele esta acontecendo, e quem entrega no dia 3
//      lanca no dia 3; exigir a virada do mes empurraria todo lancamento para
//      depois, que e quando ele e esquecido;
//   3. o mes PASSADO passa, inclusive de ano anterior.
//
// A GUARDA E DO SERVIDOR, e nao da tela. A tela tambem barra (a celula do mes
// futuro nao abre), mas o CLI e qualquer outro chamador entram por aqui.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../pit/pit_execucao_ctrl')

// ORIGEM MANUAL (`dominio.origem_meta` code 1). Com origem calculada, a guarda
// da ORIGEM dispararia antes e este arquivo testaria a errada.
const metaManual = (ano) => ({
  id: 7, ano, numero_meta: 1, item: '1.1', origem_id: 1, origem: 'Manual'
})

const HOJE = new Date('2026-08-06T12:00:00Z')

/** Roda o `salvar` e devolve o erro, ou null quando ele passou da guarda. */
const tentar = async (ano, dados) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce(metaManual(ano))
  // O `antes` da linha de execucao, e o que vier depois nao importa: o que se
  // mede aqui e se a GUARDA deixou passar.
  mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
  try {
    await ctrl.salvar({ meta_id: 7, ...dados }, 'uuid-quem-lanca', {})
    return null
  } catch (e) {
    return e
  }
}

const barrouPeloFuturo = (erro) =>
  Boolean(erro) && /ainda n(ã|a)o chegou/.test(erro.message)

describe('lancamento de execucao em mes futuro', () => {
  beforeEach(() => {
    mockDb.reset()
    jest.useFakeTimers().setSystemTime(HOJE)
  })

  afterEach(() => jest.useRealTimers())

  test('realizado de mes futuro no mesmo ano e RECUSADO', async () => {
    const erro = await tentar(2026, { mes: 11, quantidade: 3 })

    expect(barrouPeloFuturo(erro)).toBe(true)
    expect(erro.statusCode).toBe(400)
    // A mensagem nomeia o mes e o ano: "nao pode" sem dizer qual celula obriga
    // quem lanca a adivinhar onde errou.
    expect(erro.message).toContain('11/2026')
  })

  test('realizado de ano inteiro no futuro e RECUSADO', async () => {
    const erro = await tentar(2027, { mes: 1, quantidade: 3 })

    expect(barrouPeloFuturo(erro)).toBe(true)
  })

  // --- As variancias ---------------------------------------------------------

  test('PLANEJADO de mes futuro passa: e o trabalho do planejamento', async () => {
    const erro = await tentar(2026, { mes: 11, quantidade_planejada: 3 })

    expect(barrouPeloFuturo(erro)).toBe(false)
  })

  test('realizado do mes CORRENTE passa', async () => {
    const erro = await tentar(2026, { mes: 8, quantidade: 3 })

    expect(barrouPeloFuturo(erro)).toBe(false)
  })

  test('realizado de mes passado passa', async () => {
    const erro = await tentar(2026, { mes: 5, quantidade: 3 })

    expect(barrouPeloFuturo(erro)).toBe(false)
  })

  test('realizado de ano anterior passa', async () => {
    const erro = await tentar(2025, { mes: 12, quantidade: 3 })

    expect(barrouPeloFuturo(erro)).toBe(false)
  })

  // APAGAR NAO E LANCAR. Quem tirou o numero de um mes futuro lancado por engano
  // precisa poder desfazer, e a guarda recusaria justamente o conserto.
  test('APAGAR o realizado de mes futuro passa, porque nao afirma entrega', async () => {
    const erro = await tentar(2026, { mes: 11, quantidade: null })

    expect(barrouPeloFuturo(erro)).toBe(false)
  })
})
