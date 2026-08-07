'use strict'

/**
 * O TETO DA NC CONTA O EMPENHO LÍQUIDO, e não o bruto.
 *
 * O CASO REAL, medido em 2026-08-06. A 2026NE000002 vale R$ 1.728,00 e está
 * anulada por INTEIRO. A NC dela, a 2026NC400137, teve os mesmos R$ 1.728,00
 * recolhidos: o empenho foi anulado e o crédito voltou. A NE não consome nada.
 *
 * Ainda assim, corrigir a DATA dessa NE era impossível pela tela:
 *
 *     "O empenho excede o saldo da nota de credito 2026NC400137.
 *      Valor da NC: 1728.00; recolhido: 1728.00; ja empenhado: 0.00;
 *      saldo: 0.00; tentativa: 1728.00"
 *
 * A barreira comparava DUAS GRANDEZAS DIFERENTES. O quanto a NE já consumia
 * saía LÍQUIDO da consulta (1.728 menos 1.728 de anulação, ou seja, zero), e o
 * quanto ela passaria a consumir saía BRUTO das alocações do formulário
 * (1.728). A regra "só barra quem AUMENTA o consumo" então via um aumento de
 * zero para 1.728 onde não havia aumento nenhum.
 *
 * NENHUM TESTE COBRIA ESSA RECUSA, e foi por isso que ela sobreviveu.
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
    numero: 'NC-TETO',
    ano: ANO,
    cod_nd: ND_CONSUMO,
    valor_nc: 1728,
    classificacao_id: PDR,
    ...extra
  },
  ADMIN_UUID
)

/**
 * Devolve crédito da NC lançando o DOCUMENTO de recolhimento.
 *
 * Desde a 1.40.0 não há campo `valor_recolhido` para passar no corpo da NC: a
 * devolução é uma linha em `orcamento.nota_credito_recolhimento`, e o recolhido
 * da NC é a soma delas. O teto do empenho lê a mesma soma.
 */
const recolher = (ncId, valor, numero = 'NC-REC-TETO') => recolhimentoCtrl.criar(
  { nota_credito_id: Number(ncId), numero, ano: ANO, valor },
  ADMIN_UUID
)

const corpoDaNe = (ncId, extra = {}) => ({
  numero: 'NE-TETO',
  ano: ANO,
  data_empenho: '2026-02-04',
  notas_credito: [{ nota_credito_id: ncId, valor: 1728 }],
  ...extra
})

describe('o teto da NC desconta a anulação da própria NE', () => {
  /**
   * O CASO DA TELA, ponta a ponta: NC inteira recolhida, NE inteira anulada, e
   * o usuário só quer trocar a data.
   */
  test('a NE anulada por inteiro contra NC recolhida ainda edita a data', async () => {
    const nc = await novaNc()
    await recolher(nc.id, 1728)
    const ne = await neCtrl.criar(
      corpoDaNe(nc.id, { valor_anulado: 1728 }), ADMIN_UUID
    )

    // VARIÂNCIA: o cenário tem de ser mesmo o degenerado que trava. Sem estas
    // duas linhas, o teste passaria contra uma NC com saldo sobrando, que é
    // justamente o caso que nunca deu problema.
    const lida = await ncCtrl.getPorId(nc.id)
    expect(Number(lida.valor_nc) - Number(lida.valor_recolhido)).toBe(0)

    await neCtrl.atualizar(
      ne.id,
      corpoDaNe(nc.id, { data_empenho: '2026-03-15', valor_anulado: 1728 }),
      ADMIN_UUID
    )

    const depois = await neCtrl.getPorId(ne.id)
    expect(String(depois.data_empenho).slice(0, 10)).toBe('2026-03-15')
    // E o valor não foi mexido de contrabando para caber no teto.
    expect(Number(depois.valor_empenhado)).toBe(1728)
    expect(Number(depois.valor_anulado)).toBe(1728)
  })

  /**
   * A BARREIRA CONTINUA DE PÉ. Sem este caso, os de cima passariam numa
   * implementação que simplesmente parasse de checar o teto, e aí a validação
   * inteira viraria enfeite.
   */
  test('sem anulação, o empenho acima do saldo continua recusado', async () => {
    const nc = await novaNc()
    await recolher(nc.id, 1728)

    await expect(
      neCtrl.criar(corpoDaNe(nc.id), ADMIN_UUID)
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  /**
   * A ANULAÇÃO PARCIAL desconta na proporção certa, e não tudo ou nada.
   */
  test('a anulação parcial libera só a parte anulada', async () => {
    // NC de 1.728 sem recolhimento: o teto é 1.728 inteiro.
    const nc = await novaNc()

    // Uma NE de 1.000 anulada em 400 consome 600.
    await neCtrl.criar({
      numero: 'NE-PARCIAL',
      ano: ANO,
      data_empenho: '2026-02-04',
      notas_credito: [{ nota_credito_id: nc.id, valor: 1000 }],
      valor_anulado: 400
    }, ADMIN_UUID)

    // Sobram 1.128. Uma segunda NE de 1.128 cabe...
    const cabe = await neCtrl.criar({
      numero: 'NE-CABE',
      ano: ANO,
      data_empenho: '2026-02-05',
      notas_credito: [{ nota_credito_id: nc.id, valor: 1128 }]
    }, ADMIN_UUID)
    expect(cabe.id).toBeDefined()

    // ...e um centavo a mais, não. É o que prova que a conta é 600, e não 1.000
    // (aí sobrariam 728 e a de 1.128 já teria sido recusada) nem 0 (aí caberia
    // qualquer coisa).
    await expect(neCtrl.criar({
      numero: 'NE-ESTOURA',
      ano: ANO,
      data_empenho: '2026-02-06',
      notas_credito: [{ nota_credito_id: nc.id, valor: 0.02 }]
    }, ADMIN_UUID)).rejects.toMatchObject({ statusCode: 400 })
  })
})
