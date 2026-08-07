'use strict'

/**
 * A LISTA DE NCs DEVOLVE O SALDO, e não só o valor.
 *
 * POR QUE ELE VEM DO SERVIDOR. O saldo é o número da decisão de empenhar, e é a
 * MESMA régua que `validarTetoDasNcs` usa para barrar o empenho: recebido,
 * menos o devolvido, menos o empenhado LÍQUIDO de anulação. Derivá-lo na tela
 * abriria a porta para a tela prometer crédito que o servidor recusa, sem erro
 * nenhum entre os dois.
 *
 * O QUE ESTES CASOS PRENDEM, e cada um falharia por um motivo diferente:
 *   - o recolhimento desconta (senão a tela oferece crédito devolvido);
 *   - a anulação da NE devolve o valor à NC (senão a NC anulada parece esgotada);
 *   - o saldo pode ficar NEGATIVO, e não é zerado (senão a NC que precisa de
 *     atenção some da tela justamente por estar errada).
 */

const { db } = require('../../database')
const { cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

const ncCtrl = require('../../orcamento/nota_credito/nota_credito_ctrl')
const neCtrl = require('../../orcamento/nota_empenho/nota_empenho_ctrl')
const recolhimentoCtrl = require('../../orcamento/nota_credito/recolhimento_ctrl')

const ANO = 2026
const ND_CONSUMO = '339030'
const PDR = 1

beforeAll(async () => {
  await db.createConn()
})

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const novaNc = (extra = {}) => ncCtrl.criar(
  {
    numero: 'NC-SALDO',
    ano: ANO,
    cod_nd: ND_CONSUMO,
    valor_nc: 1000,
    classificacao_id: PDR,
    ...extra
  },
  ADMIN_UUID
)

/** O saldo da NC como a LISTA o devolve, que é o que a tela mostra. */
const saldoDaLista = async (ncId) => {
  const linhas = await ncCtrl.listar({ ano: ANO })
  const linha = linhas.find(l => String(l.id) === String(ncId))
  expect(linha).toBeDefined()
  return { saldo: Number(linha.saldo), empenhado: Number(linha.empenhado) }
}

/**
 * Devolve crédito lançando o DOCUMENTO de recolhimento.
 *
 * Desde a 1.40.0 não há campo `valor_recolhido` no corpo da NC: a devolução é
 * uma linha em `orcamento.nota_credito_recolhimento`, e o recolhido da NC é a
 * soma delas. `numero` varia porque a unicidade é (ano, numero, NC alvo): dois
 * documentos distintos sobre a MESMA NC precisam de números distintos.
 */
const recolher = (ncId, valor, numero = 'NC-REC') => recolhimentoCtrl.criar(
  { nota_credito_id: Number(ncId), numero, ano: ANO, valor },
  ADMIN_UUID
)

const empenhar = (ncId, valor, extra = {}) => neCtrl.criar({
  numero: `NE-${valor}-${Math.round(Math.random() * 1e6)}`,
  ano: ANO,
  data_empenho: '2026-02-04',
  notas_credito: [{ nota_credito_id: ncId, valor }],
  ...extra
}, ADMIN_UUID)

describe('o saldo da nota de crédito', () => {
  test('sem empenho nem recolhimento, o saldo é o valor inteiro', async () => {
    const nc = await novaNc()
    expect(await saldoDaLista(nc.id)).toEqual({ saldo: 1000, empenhado: 0 })
  })

  test('o empenho consome o saldo', async () => {
    const nc = await novaNc()
    await empenhar(nc.id, 400)
    expect(await saldoDaLista(nc.id)).toEqual({ saldo: 600, empenhado: 400 })
  })

  test('o recolhimento desconta do saldo', async () => {
    const nc = await novaNc()
    await recolher(nc.id, 250)
    await empenhar(nc.id, 400)
    // 1000 recebido, 250 devolvido, 400 empenhado.
    expect(await saldoDaLista(nc.id)).toEqual({ saldo: 350, empenhado: 400 })
  })

  /**
   * O RECOLHIDO É SOMA, e não uma linha só.
   *
   * Sem este caso, os demais passariam numa implementação que lesse APENAS o
   * primeiro documento de recolhimento da NC (um `LIMIT 1`, um `MIN`), e o erro
   * ficaria invisível: o caso real de 2026 tem NC abatida por mais de um
   * documento, e a 2026NC401316 abate duas NCs de uma vez.
   */
  test('dois documentos de recolhimento somam no recolhido e no saldo', async () => {
    const nc = await novaNc()
    await recolher(nc.id, 100, 'NC-REC-A')
    await recolher(nc.id, 150, 'NC-REC-B')

    const linha = await ncCtrl.getPorId(nc.id)
    expect(Number(linha.valor_recolhido)).toBe(250)
    expect(await saldoDaLista(nc.id)).toEqual({ saldo: 750, empenhado: 0 })
  })

  test('a anulação da NE devolve o valor ao saldo', async () => {
    const nc = await novaNc()
    await empenhar(nc.id, 400, { valor_anulado: 400 })
    // A NE existe e vale 400, mas está anulada por inteiro: consome zero.
    expect(await saldoDaLista(nc.id)).toEqual({ saldo: 1000, empenhado: 0 })
  })

  test('a anulação PARCIAL devolve só a parte anulada', async () => {
    const nc = await novaNc()
    await empenhar(nc.id, 400, { valor_anulado: 150 })
    // VARIÂNCIA contra o caso acima: se a anulação fosse tudo ou nada, este
    // daria 1000 (ignorando o empenho) ou 600 (ignorando a anulação).
    expect(await saldoDaLista(nc.id)).toEqual({ saldo: 750, empenhado: 250 })
  })

  test('o saldo fica NEGATIVO quando o crédito é devolvido depois do empenho', async () => {
    // O caso real de 2026 (2026NC400698 e 2026NC400702): empenhou-se, e depois o
    // crédito voltou. A NC está mesmo abaixo de zero, e zerar aqui esconderia
    // exatamente a linha que precisa de atenção.
    const nc = await novaNc()
    await empenhar(nc.id, 900)
    await recolher(nc.id, 400)

    const { saldo } = await saldoDaLista(nc.id)
    expect(saldo).toBe(-300)
    expect(saldo).toBeLessThan(0)
  })
})
