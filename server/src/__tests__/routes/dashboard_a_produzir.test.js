'use strict'

/**
 * A PRODUZIR: a folha prometida que ainda nao virou edicao regular.
 *
 * A pergunta que nenhuma parte do painel respondia. As outras dizem o que o
 * acervo TEM e o que ENTROU; esta diz o que ele DEVE, e com prazo.
 *
 * O que os testes fazem cumprir, e por que cada um existe:
 *
 * 1. So a versao PLANEJADA entra. Filtrar por "sem arquivo" pegaria tambem o
 *    Registro Historico (408 versoes na producao em 2026-08), que e acervo antigo
 *    catalogado sem o digital, e nao promessa nenhuma.
 * 2. A folha SEM data prevista vem PRIMEIRO. Ela e erro de cadastro e some do
 *    planejado do PIT sem erro nenhum; esconde-la no fim da lista a faria passar
 *    despercebida.
 * 3. O atraso sai do SERVIDOR. A tela que subtrai datas erra o fuso, e duas
 *    telas subtraindo a mesma coisa chegariam a dois numeros.
 * 4. A rota NAO tem parametro de ano. A versao planejada e um estado, e nao um
 *    fato datado: a folha prometida para dezembro segue devida em janeiro.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProduto, createVersao } = require('../helpers/fixtures')

const {
  domainConstants: { TIPO_VERSAO }
} = require('../../utils')

let app
let token

beforeAll(async () => {
  app = await getApp()
  token = generateAdminToken()
})

afterEach(async () => {
  await cleanTestData()
})

/**
 * Dia de calendario LOCAL, deslocado de N dias, no formato 'YYYY-MM-DD'.
 *
 * NAO use `new Date(...).toISOString().slice(0, 10)`, que era o que estava aqui:
 * o `toISOString` fala UTC, e o `dias_atraso` sai de `CURRENT_DATE - data_prevista`
 * no PostgreSQL, que fala o fuso do servidor (America/Sao_Paulo). Das 21h a
 * meia-noite as duas leituras discordam em um dia, e o teste falhava TODA NOITE
 * nessa janela de tres horas -- sem ninguem ter mexido em nada.
 *
 * E o mesmo fuso que obriga `Joi.date().iso().raw()` nos dias de calendario das
 * rotas: dia de calendario nao e instante, e converte-lo para UTC anda um dia.
 *
 * @param {number} deslocamentoDias
 * @returns {string}
 */
const diaLocal = (deslocamentoDias) => {
  const d = new Date()
  d.setDate(d.getDate() + deslocamentoDias)
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

const pedirAProduzir = () =>
  request(app)
    .get('/api/dashboard/a_produzir')
    .set('Authorization', `Bearer ${token}`)

/** Uma versao planejada, com a data prometida que se quiser. */
const semearPlanejada = async (mi, dataPrevista, overrides = {}) => {
  const produto = await createProduto({ nome: `Folha ${mi}`, mi, inom: `INOM-${mi}` })
  const versao = await createVersao(produto.id, {
    tipo_versao_id: TIPO_VERSAO.PLANEJADA,
    versao: '1-DSG',
    ...overrides
  })
  // `data_prevista` nao esta no INSERT do fixture: ela e recente e so este
  // teste a usa. UPDATE aqui evita mexer no fixture que toda a suite consome.
  await conn.none(
    'UPDATE acervo.versao SET data_prevista = $1 WHERE id = $2',
    [dataPrevista, versao.id]
  )
  return versao
}

describe('GET /api/dashboard/a_produzir', () => {
  test('devolve so a versao PLANEJADA, e nao o registro historico sem arquivo', async () => {
    await semearPlanejada('2758-3-NE', '2026-10-31')

    const produtoAntigo = await createProduto({ nome: 'Folha antiga', mi: '2900-1', inom: 'INOM-2900-1' })
    await createVersao(produtoAntigo.id, {
      tipo_versao_id: TIPO_VERSAO.REGISTRO_HISTORICO,
      versao: '1ª Edição'
    })

    const res = await pedirAProduzir()

    expect(res.status).toBe(200)
    // A LISTA E O PAYLOAD, e nao um objeto com ela dentro: os dois outros blocos
    // do antigo /plano_ano (lote em andamento e Extra-PIT) sairam para as telas
    // do PIT e da administracao do acervo.
    expect(Array.isArray(res.body.dados)).toBe(true)
    expect(res.body.dados).toHaveLength(1)
    expect(res.body.dados[0].mi).toBe('2758-3-NE')
  })

  test('a folha SEM data prevista vem primeiro', async () => {
    await semearPlanejada('2758-3-NE', '2026-01-31')
    await semearPlanejada('2784-1-NO', null)

    const { body } = await pedirAProduzir()

    expect(body.dados).toHaveLength(2)
    expect(body.dados[0].mi).toBe('2784-1-NO')
    expect(body.dados[0].data_prevista).toBeNull()
  })

  test('o atraso vem calculado, e nao negativo quando o prazo nao venceu', async () => {
    const ontem = diaLocal(-1)
    const daquiUmAno = diaLocal(365)
    await semearPlanejada('2758-3-NE', ontem)
    await semearPlanejada('2784-1-NO', daquiUmAno)

    const { body } = await pedirAProduzir()
    const porMi = Object.fromEntries(body.dados.map(r => [r.mi, r]))

    expect(Number(porMi['2758-3-NE'].dias_atraso)).toBe(1)
    // Zero, e nao -365: "faltam N dias" a tela diz com a propria data_prevista.
    expect(Number(porMi['2784-1-NO'].dias_atraso)).toBe(0)
  })

  test('cobra login', async () => {
    const res = await request(app).get('/api/dashboard/a_produzir')
    expect(res.status).toBe(401)
  })

  test('a rota antiga /plano_ano nao existe mais', async () => {
    const res = await request(app)
      .get('/api/dashboard/plano_ano?ano=2026')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})
