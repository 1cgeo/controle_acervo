'use strict'

/**
 * O SALDO DO PAINEL VEM EM DUAS METADES, e não num líquido só.
 *
 * O CASO REAL, medido em 2026-08-07. O cartão "Saldo" mostrava R$ 428,73, que
 * eram R$ 5.612,10 de crédito realmente não empenhado MENOS R$ 5.183,37 de
 * saldo NEGATIVO. Saldo negativo é impossível (empenhado maior que o crédito
 * disponível) e sempre indica defeito de lançamento: naquele dia eram dois
 * empenhos anulados no SIAFI que o SCA ainda contava.
 *
 * Um número que esconde defeito atrás de compensação é pior que não mostrar
 * nada, e por isso o painel passou a devolver `saldo_positivo` e
 * `saldo_negativo` separados, somados NOTA A NOTA.
 *
 * O SINAL VIAJA COM O NÚMERO: `saldo_negativo` sai negativo, e não em módulo.
 * Tomar o módulo aqui obrigaria toda tela a lembrar de recolocar o sinal.
 */

const { db } = require('../../database')
const { cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

const ncCtrl = require('../../orcamento/nota_credito/nota_credito_ctrl')
const neCtrl = require('../../orcamento/nota_empenho/nota_empenho_ctrl')
const recolhimentoCtrl = require('../../orcamento/nota_credito/recolhimento_ctrl')
const dashboardCtrl = require('../../orcamento/dashboard/dashboard_ctrl')

const ANO = 2026
const ND = '339030'
const PDR = 1

// Os números medidos em produção em 2026-08-07.
const A_EMPENHAR = 5612.10
const NEGATIVO = 5183.37

beforeAll(async () => {
  await db.createConn()
})

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const novaNc = (numero, valor) => ncCtrl.criar(
  { numero, ano: ANO, cod_nd: ND, valor_nc: valor, classificacao_id: PDR },
  ADMIN_UUID
)

const empenhar = (ncId, valor, numero) => neCtrl.criar({
  numero,
  ano: ANO,
  data_empenho: '2026-02-04',
  notas_credito: [{ nota_credito_id: Number(ncId), valor }]
}, ADMIN_UUID)

const recolher = (ncId, valor, numero) => recolhimentoCtrl.criar(
  { nota_credito_id: Number(ncId), numero, ano: ANO, valor },
  ADMIN_UUID
)

/** A linha TOTAL do painel, que é a que alimenta os cartões. */
const totalDoPainel = async () => {
  const { linhas } = await dashboardCtrl.getExecucaoPorNd({ ano: ANO, mes: 12 })
  const total = linhas.find(l => l.cod_nd === 'TOTAL')
  expect(total).toBeDefined()
  return total
}

describe('as duas metades do saldo no painel', () => {
  test('separa o crédito a empenhar do saldo negativo, e não os cancela', async () => {
    // A: crédito recebido e não empenhado. Sozinha, ela é o "a empenhar".
    const a = await novaNc('NC-SALDO-POS', A_EMPENHAR)

    // B: empenhada por inteiro e DEPOIS recolhida em parte. É o defeito real:
    // o empenho já não cabe no crédito que sobrou. A ordem importa, porque o
    // teto recusaria o empenho se o recolhimento viesse antes.
    const valorB = 6183.37
    const b = await novaNc('NC-SALDO-NEG', valorB)
    await empenhar(b.id, valorB, 'NE-SALDO-NEG')
    await recolher(b.id, NEGATIVO, 'NC-REC-NEG')

    const total = await totalDoPainel()

    expect(Number(total.saldo_positivo)).toBeCloseTo(A_EMPENHAR, 2)
    expect(Number(total.saldo_negativo)).toBeCloseTo(-NEGATIVO, 2)

    // O LÍQUIDO ANTIGO, que era o que a tela mostrava: as duas metades somam
    // R$ 428,73. O caso existe para provar que o número velho ESCONDIA os dois
    // de cima, e não para trazê-lo de volta.
    expect(
      Number(total.saldo_positivo) + Number(total.saldo_negativo)
    ).toBeCloseTo(428.73, 2)

    // VARIÂNCIA: as duas metades são mesmo diferentes entre si e diferentes de
    // zero. Sem esta linha, o caso passaria numa implementação que devolvesse
    // o mesmo número nas duas colunas.
    expect(Number(total.saldo_positivo)).not.toBeCloseTo(
      Number(total.saldo_negativo), 2
    )

    expect(a.id).toBeDefined()
  })

  test('sem NC negativa, o saldo negativo é ZERO e o positivo é o crédito inteiro', async () => {
    await novaNc('NC-SO-POSITIVA', A_EMPENHAR)

    const total = await totalDoPainel()

    expect(Number(total.saldo_positivo)).toBeCloseTo(A_EMPENHAR, 2)
    expect(Number(total.saldo_negativo)).toBe(0)
  })

  test('a soma é por NOTA, e não sobre o líquido do ano', async () => {
    // Duas NCs que se cancelariam num líquido: +1000 e -1000. Um cartão único
    // mostraria R$ 0,00 e diria que está tudo certo, com uma NC empenhada acima
    // do crédito disponível na tela ao lado.
    await novaNc('NC-MAIS-MIL', 1000)

    const b = await novaNc('NC-MENOS-MIL', 2000)
    await empenhar(b.id, 2000, 'NE-MENOS-MIL')
    await recolher(b.id, 1000, 'NC-REC-MIL')

    const total = await totalDoPainel()

    expect(Number(total.saldo_positivo)).toBeCloseTo(1000, 2)
    expect(Number(total.saldo_negativo)).toBeCloseTo(-1000, 2)
  })
})

describe('o recebido do PDR sai separado do Extra-PDR', () => {
  /**
   * O cartão "% recebido do previsto" divide `recebido_pdr` pelo `previsto`, e
   * não o recebido total: Extra-PDR é, por definição, o crédito que o PDR não
   * previu. O painel precisa entregar as duas parcelas separadas para a tela
   * poder fazer a conta certa.
   */
  test('recebido_pdr e recebido_extra são campos distintos na linha TOTAL', async () => {
    await novaNc('NC-DO-PDR', 300)
    await ncCtrl.criar(
      {
        numero: 'NC-EXTRA',
        ano: ANO,
        cod_nd: ND,
        valor_nc: 700,
        // 2 = Extra-PDR: sem item de PDR, e sem previsão nenhuma.
        classificacao_id: 2
      },
      ADMIN_UUID
    )

    const total = await totalDoPainel()

    expect(Number(total.recebido_pdr)).toBeCloseTo(300, 2)
    expect(Number(total.recebido_extra)).toBeCloseTo(700, 2)
    expect(Number(total.recebido)).toBeCloseTo(1000, 2)
  })
})
