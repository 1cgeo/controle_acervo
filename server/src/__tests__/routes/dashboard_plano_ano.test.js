'use strict'

/**
 * O PLANO DO ANO: o que o acervo ainda deve produzir.
 *
 * A pergunta que nenhuma aba do painel respondia. As outras dizem o que o acervo
 * TEM e o que ENTROU; esta diz o que ele DEVE, e com prazo.
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
 * 4. O lote NAO concluido entra, e nao so o "Em execucao". O Nao iniciado e o
 *    Pausado sao trabalho que o ano ainda deve.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProjeto, createLote, createProduto, createVersao } = require('../helpers/fixtures')

const {
  domainConstants: { TIPO_VERSAO, STATUS_EXECUCAO }
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

const pedirPlano = (ano = 2026) =>
  request(app)
    .get(`/api/dashboard/plano_ano?ano=${ano}`)
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

describe('GET /api/dashboard/plano_ano', () => {
  test('devolve so a versao PLANEJADA, e nao o registro historico sem arquivo', async () => {
    await semearPlanejada('2758-3-NE', '2026-10-31')

    const produtoAntigo = await createProduto({ nome: 'Folha antiga', mi: '2900-1', inom: 'INOM-2900-1' })
    await createVersao(produtoAntigo.id, {
      tipo_versao_id: TIPO_VERSAO.REGISTRO_HISTORICO,
      versao: '1ª Edição'
    })

    const res = await pedirPlano()

    expect(res.status).toBe(200)
    expect(res.body.dados.a_produzir).toHaveLength(1)
    expect(res.body.dados.a_produzir[0].mi).toBe('2758-3-NE')
  })

  test('a folha SEM data prevista vem primeiro', async () => {
    await semearPlanejada('2758-3-NE', '2026-01-31')
    await semearPlanejada('2784-1-NO', null)

    const { body } = await pedirPlano()
    const lista = body.dados.a_produzir

    expect(lista).toHaveLength(2)
    expect(lista[0].mi).toBe('2784-1-NO')
    expect(lista[0].data_prevista).toBeNull()
  })

  test('o atraso vem calculado, e nao negativo quando o prazo nao venceu', async () => {
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const daquiUmAno = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)
    await semearPlanejada('2758-3-NE', ontem)
    await semearPlanejada('2784-1-NO', daquiUmAno)

    const { body } = await pedirPlano()
    const porMi = Object.fromEntries(body.dados.a_produzir.map(r => [r.mi, r]))

    expect(Number(porMi['2758-3-NE'].dias_atraso)).toBe(1)
    // Zero, e nao -365: "faltam N dias" a tela diz com a propria data_prevista.
    expect(Number(porMi['2784-1-NO'].dias_atraso)).toBe(0)
  })

  test('o lote nao concluido entra, e o concluido nao', async () => {
    const projeto = await createProjeto({ nome: 'Projeto do plano' })
    await createLote(projeto.id, {
      nome: 'Lote correndo', pit: 'PIT-CORRE',
      status_execucao_id: STATUS_EXECUCAO.EM_EXECUCAO
    })
    await createLote(projeto.id, {
      nome: 'Lote pausado', pit: 'PIT-PAUSA',
      status_execucao_id: STATUS_EXECUCAO.PAUSADO
    })
    await createLote(projeto.id, {
      nome: 'Lote fechado', pit: 'PIT-FECHA',
      status_execucao_id: STATUS_EXECUCAO.CONCLUIDO
    })

    const { body } = await pedirPlano()
    const nomes = body.dados.lotes_em_execucao.map(l => l.nome).sort()

    expect(nomes).toEqual(['Lote correndo', 'Lote pausado'])
  })

  test('cobra login', async () => {
    const res = await request(app).get('/api/dashboard/plano_ano?ano=2026')
    expect(res.status).toBe(401)
  })

  test('recusa ano fora da faixa em vez de devolver lista vazia', async () => {
    const res = await request(app)
      .get('/api/dashboard/plano_ano?ano=1500')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
  })
})
