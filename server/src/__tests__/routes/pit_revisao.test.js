'use strict'

// A REVISÃO do PIT contra banco de verdade.
//
// POR QUE AQUI E NÃO em pit_route.test.js, que mocka o banco: o que se prova
// nesta suíte é uma REGRA de estado (rascunho contra publicada), e ela mora em
// colunas e em consultas reais. Regra mockada só prova que o código chamou a si
// mesmo.
//
// O QUE ESTE ARQUIVO PROTEGE, e a lacuna que o originou:
//
//   1. TIRAR uma meta do rascunho. `pit.meta_item_revisao` é esparsa, e as linhas de
//      uma revisão SÃO as alterações dela: faltava o caminho de volta, e quem
//      acrescentasse uma meta por engano só saía publicando o erro. A lacuna
//      apareceu na carga do PIT de 2026, onde a meta 6.9 teve de entrar no R0
//      marcada `cancelada` porque não havia como deixá-la AUSENTE.
//   2. A revisão PUBLICADA não se altera. O que ela declara é o que o relatório
//      daquele mês reporta, e reescrever isso reescreveria o passado.
//   3. As ALTERAÇÕES trazem o valor anterior ao lado, que é a tela de
//      conferência contra o DIEx.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken, ADMIN_UUID } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
}, 60000)

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

// Um ITEM com identidade, sem declaração nenhuma: a declaração é o que a
// revisão traz. O GRUPO nasce junto, porque o item pendura nele.
const criarMeta = async (numeroMeta, item) => {
  const grupo = await conn.one(
    `INSERT INTO pit.meta (ano, numero_meta, nome, usuario_cadastramento_uuid)
     VALUES (2026, $1, $2, $3)
     ON CONFLICT (ano, numero_meta) DO UPDATE SET nome = pit.meta.nome
     RETURNING id`,
    [numeroMeta, `Meta ${numeroMeta}`, ADMIN_UUID]
  )
  return conn.one(
    `INSERT INTO pit.meta_item (meta_id, item, unidade_id, origem_id,
                                usuario_cadastramento_uuid)
     VALUES ($1, $2, 1, 1, $3) RETURNING id`,
    [grupo.id, item, ADMIN_UUID]
  )
}

const criarRevisao = async (codigo) => {
  const res = await request(app)
    .post('/api/metas/revisoes')
    .set('Authorization', admin())
    .send({ ano: 2026, codigo })
  expect(res.status).toBe(201)
  return res.body.dados.id
}

// A declaração entra direto pelo banco: quem a escreve pela API é a tela de
// metas, e o que se mede aqui é a REVISÃO, não o caminho de escrita da meta.
const declarar = async (revisaoId, metaId, dados = {}) =>
  conn.one(
    `INSERT INTO pit.meta_item_revisao
       (revisao_id, meta_item_id, descricao, quantidade_prevista, prazo, demandante,
        cancelada, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      revisaoId, metaId,
      dados.descricao ?? 'Carta Topográfica 1:25.000',
      dados.quantidade ?? 247,
      dados.prazo ?? '2026-12-31',
      dados.demandante ?? 'DSG',
      dados.cancelada ?? false,
      ADMIN_UUID
    ]
  )

const publicar = async (revisaoId, vigencia) => {
  const res = await request(app)
    .post(`/api/metas/revisoes/${revisaoId}/publicar`)
    .set('Authorization', admin())
    .send({ data_vigencia: vigencia })
  expect(res.status).toBe(200)
  return res.body.dados
}

const alteracoes = async (revisaoId) => {
  const res = await request(app)
    .get(`/api/metas/revisoes/${revisaoId}/alteracoes`)
    .set('Authorization', admin())
  expect(res.status).toBe(200)
  return res.body.dados
}

describe('Revisão do PIT: tirar uma meta do rascunho', () => {
  test('a meta sai, e a revisão deixa de alterá-la', async () => {
    const meta = await criarMeta(4, '4.2')
    const rascunho = await criarRevisao('R1')
    await declarar(rascunho, meta.id, { quantidade: 252 })

    expect(await alteracoes(rascunho)).toHaveLength(1)

    const res = await request(app)
      .delete(`/api/metas/revisoes/${rascunho}/meta/${meta.id}`)
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados.removida).toBe(true)
    expect(await alteracoes(rascunho)).toHaveLength(0)
  })

  test('a REVISÃO PUBLICADA recusa, e diz o que fazer', async () => {
    // O que ela declara é o que o relatório daquele mês reporta.
    const meta = await criarMeta(4, '4.2')
    const r0 = await criarRevisao('R0')
    await declarar(r0, meta.id, { quantidade: 247 })
    await publicar(r0, '2026-01-01')

    const res = await request(app)
      .delete(`/api/metas/revisoes/${r0}/meta/${meta.id}`)
      .set('Authorization', admin())

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/revisão nova/)
    expect(await alteracoes(r0)).toHaveLength(1)
  })

  test('meta que a revisão não altera responde 404', async () => {
    const meta = await criarMeta(4, '4.2')
    const outra = await criarMeta(6, '6.8')
    const rascunho = await criarRevisao('R1')
    await declarar(rascunho, meta.id)

    const res = await request(app)
      .delete(`/api/metas/revisoes/${rascunho}/meta/${outra.id}`)
      .set('Authorization', admin())

    expect(res.status).toBe(404)
  })

  test('revisão inexistente responde 404', async () => {
    const meta = await criarMeta(4, '4.2')

    const res = await request(app)
      .delete(`/api/metas/revisoes/999999/meta/${meta.id}`)
      .set('Authorization', admin())

    expect(res.status).toBe(404)
  })

  test('recusa quem não é administrador', async () => {
    const meta = await criarMeta(4, '4.2')
    const rascunho = await criarRevisao('R1')
    await declarar(rascunho, meta.id)

    const res = await request(app)
      .delete(`/api/metas/revisoes/${rascunho}/meta/${meta.id}`)
      .set('Authorization', generateUserToken())

    expect(res.status).toBe(403)
  })

  test('deixa rastro na ficha da META, com o motivo', async () => {
    // A pergunta que se faz depois é "por que a 4.2 voltou a 247", e ela se faz
    // na ficha da meta, não na do exercício.
    const meta = await criarMeta(4, '4.2')
    const rascunho = await criarRevisao('R1')
    await declarar(rascunho, meta.id, { quantidade: 252 })

    await request(app)
      .delete(`/api/metas/revisoes/${rascunho}/meta/${meta.id}`)
      .set('Authorization', admin())

    const evento = await conn.one(
      `SELECT * FROM auditoria.evento
       WHERE tabela = 'pit.meta_item_revisao' AND operacao = 'D'`
    )
    expect(evento.entidade).toBe('meta')
    expect(evento.entidade_id).toBe(String(meta.id))
    expect(evento.motivo).toMatch(/R1/)
    expect(Number(evento.dados_antes.quantidade_prevista)).toBe(252)
  })
})

describe('Revisão do PIT: o que ela altera', () => {
  test('traz o valor ANTERIOR ao lado, da revisão vigente antes desta', async () => {
    // É a tela de conferência contra o DIEx: sem o anterior, publicar seria um
    // ato às cegas.
    const meta = await criarMeta(4, '4.2')
    const r0 = await criarRevisao('R0')
    await declarar(r0, meta.id, { quantidade: 247 })
    await publicar(r0, '2026-01-01')

    const r1 = await criarRevisao('R1')
    await declarar(r1, meta.id, { quantidade: 252 })

    const [linha] = await alteracoes(r1)
    expect(Number(linha.quantidade_prevista)).toBe(252)
    expect(Number(linha.quantidade_anterior)).toBe(247)
    expect(linha.meta_nova).toBe(false)
    // O id vai junto: é por ele que a tela tira a meta do rascunho.
    expect(Number(linha.meta_id)).toBe(Number(meta.id))
  })

  test('meta que nunca foi declarada aparece como NOVA', async () => {
    const meta = await criarMeta(6, '6.9')
    const r1 = await criarRevisao('R1')
    await declarar(r1, meta.id, { quantidade: 30 })

    const [linha] = await alteracoes(r1)
    expect(linha.meta_nova).toBe(true)
    expect(linha.quantidade_anterior).toBeNull()
  })

  test('cancelar é uma alteração, e continua aparecendo', async () => {
    const meta = await criarMeta(5, '5.2')
    const r0 = await criarRevisao('R0')
    await declarar(r0, meta.id, { quantidade: 10 })
    await publicar(r0, '2026-01-01')

    const r1 = await criarRevisao('R1')
    await declarar(r1, meta.id, { quantidade: 10, cancelada: true })

    const [linha] = await alteracoes(r1)
    expect(linha.cancelada).toBe(true)
    expect(linha.cancelada_anterior).toBe(false)
  })
})

describe('Revisão do PIT: publicar', () => {
  test('recusa publicar revisão que não altera nada', async () => {
    // Revisão que não altera nada não é revisão: publicá-la só sujaria a lista
    // e deslocaria a leitura para uma linha que repete a anterior.
    const rascunho = await criarRevisao('R1')

    const res = await request(app)
      .post(`/api/metas/revisoes/${rascunho}/publicar`)
      .set('Authorization', admin())
      .send({ data_vigencia: '2026-05-14' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/não altera meta nenhuma/)
  })

  test('publicar duas vezes recusa na segunda', async () => {
    const meta = await criarMeta(4, '4.2')
    const r0 = await criarRevisao('R0')
    await declarar(r0, meta.id)
    await publicar(r0, '2026-01-01')

    const res = await request(app)
      .post(`/api/metas/revisoes/${r0}/publicar`)
      .set('Authorization', admin())
      .send({ data_vigencia: '2026-02-01' })

    expect(res.status).toBe(400)
  })

  test('depois de publicada, a revisão deixa de ser rascunho', async () => {
    const meta = await criarMeta(4, '4.2')
    const r0 = await criarRevisao('R0')
    await declarar(r0, meta.id)
    const dados = await publicar(r0, '2026-01-01')
    expect(dados.alteracoes).toBe(1)

    const lida = await request(app)
      .get(`/api/metas/revisoes/${r0}`)
      .set('Authorization', admin())

    expect(lida.body.dados.rascunho).toBe(false)
    expect(lida.body.dados.data_vigencia).toBe('2026-01-01')
  })
})
