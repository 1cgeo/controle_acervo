'use strict'

// RENOMEAR O GRUPO do PIT, contra banco de verdade.
//
// A LACUNA QUE ORIGINOU A ROTA. O nome do grupo ("Meta 5 - Serviços de
// Capacitação em Geoinformação e Apoio de Levantamento Topográfico") era gravado
// SÓ na criação: o `resolverMeta` devolve o grupo existente sem sobrescrever, de
// propósito, para que a última linha digitada não mande no nome do bloco inteiro,
// e o comentário dele prometia um "ato próprio" que nunca existiu. Não havia
// UPDATE em `pit.meta` em rota nenhuma. O nome sai impresso no RPCMTec, então o
// relatório assinado levava o que a primeira carga escreveu.
//
// E O NOME MUDA. O PIT 2026 R2, assinado em 8 SET 2026, rebatizou a Meta 5 de
// "Serviços de Capacitação em Geoinformação..." para "Serviços de Estágio em
// Geoinformação...", com os mesmos itens embaixo. O DDL dizia "revisão nenhuma o
// altera", e isso era premissa, não medida.
//
// O QUE ESTA SUÍTE PROTEGE:
//
//   1. O nome muda, e SÓ ele: os itens do grupo, suas declarações e o grupo
//      vizinho ficam intactos. É o risco real de um UPDATE em tabela-pai.
//   2. Renomear NÃO é ato de revisão, e por isso não exige revisão aberta; mas
//      exige MOTIVO, que é o que separa "a DSG renomeou" de "digitei errado".
//   3. O `resolverMeta` continua NÃO sobrescrevendo. A porta nova não podia
//      abrir a porta velha de carona.

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

const ROTA = (ano, numero) => `/api/metas/grupos/${ano}/${numero}`

const NOME_VELHO = 'Serviços de Capacitação em Geoinformação e Apoio de Levantamento Topográfico'
const NOME_NOVO = 'Serviços de Estágio em Geoinformação e Apoio de Levantamento Topográfico'
const MOTIVO = 'PIT 2026 R2 assinado em 8 SET 2026 renomeou a Meta 5.'

const criarGrupo = async (numeroMeta, nome) =>
  conn.one(
    `INSERT INTO pit.meta (ano, numero_meta, nome, usuario_cadastramento_uuid)
     VALUES (2026, $1, $2, $3)
     ON CONFLICT (ano, numero_meta) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id`,
    [numeroMeta, nome, ADMIN_UUID]
  )

const criarItem = async (grupoId, item) =>
  conn.one(
    `INSERT INTO pit.meta_item (meta_id, item, unidade_id, origem_id,
                                usuario_cadastramento_uuid)
     VALUES ($1, $2, 3, 2, $3) RETURNING id`,
    [grupoId, item, ADMIN_UUID]
  )

const nomeNoBanco = async (numeroMeta) => {
  const r = await conn.one(
    'SELECT nome FROM pit.meta WHERE ano = 2026 AND numero_meta = $1', [numeroMeta]
  )
  return r.nome
}

// ---------------------------------------------------------------------------
// O QUE A ROTA EXISTE PARA REPROVAR. Vem antes do caminho feliz de propósito:
// régua vista só passar não foi vista funcionar.
// ---------------------------------------------------------------------------

describe('PUT /api/metas/grupos/:ano/:numeroMeta, o que ela recusa', () => {
  test('grupo inexistente responde 404, e não cria nada', async () => {
    const res = await request(app)
      .put(ROTA(2026, 42))
      .set('Authorization', admin())
      .send({ nome: NOME_NOVO, motivo: MOTIVO })

    expect(res.status).toBe(404)

    const { count } = await conn.one(
      'SELECT COUNT(*)::int AS count FROM pit.meta WHERE ano = 2026 AND numero_meta = 42'
    )
    expect(count).toBe(0)
  })

  test('sem motivo responde 400, e o nome NÃO muda', async () => {
    await criarGrupo(5, NOME_VELHO)

    const res = await request(app)
      .put(ROTA(2026, 5))
      .set('Authorization', admin())
      .send({ nome: NOME_NOVO })

    expect(res.status).toBe(400)
    expect(await nomeNoBanco(5)).toBe(NOME_VELHO)
  })

  test('motivo curto demais responde 400, e o nome NÃO muda', async () => {
    await criarGrupo(5, NOME_VELHO)

    const res = await request(app)
      .put(ROTA(2026, 5))
      .set('Authorization', admin())
      .send({ nome: NOME_NOVO, motivo: 'oi' })

    expect(res.status).toBe(400)
    expect(await nomeNoBanco(5)).toBe(NOME_VELHO)
  })

  test('nome só de espaço responde 400, e o nome NÃO muda', async () => {
    await criarGrupo(5, NOME_VELHO)

    const res = await request(app)
      .put(ROTA(2026, 5))
      .set('Authorization', admin())
      .send({ nome: '   ', motivo: MOTIVO })

    expect(res.status).toBe(400)
    expect(await nomeNoBanco(5)).toBe(NOME_VELHO)
  })

  // A validação de /api/metas é ESTRITA: chave desconhecida vira 400 com
  // sugestão, em vez de sumir no stripUnknown. Sem isto, um `descricao` no lugar
  // de `nome` gravaria nada e responderia sucesso.
  test('chave desconhecida no corpo responde 400, e o nome NÃO muda', async () => {
    await criarGrupo(5, NOME_VELHO)

    const res = await request(app)
      .put(ROTA(2026, 5))
      .set('Authorization', admin())
      .send({ nome: NOME_NOVO, motivo: MOTIVO, descricao: 'nao pertence aqui' })

    expect(res.status).toBe(400)
    expect(await nomeNoBanco(5)).toBe(NOME_VELHO)
  })

  test('usuário não administrador não renomeia', async () => {
    await criarGrupo(5, NOME_VELHO)

    const res = await request(app)
      .put(ROTA(2026, 5))
      .set('Authorization', generateUserToken())
      .send({ nome: NOME_NOVO, motivo: MOTIVO })

    expect(res.status).toBeGreaterThanOrEqual(401)
    expect(res.status).toBeLessThan(404)
    expect(await nomeNoBanco(5)).toBe(NOME_VELHO)
  })

  test('exercício encerrado não aceita renomear', async () => {
    await criarGrupo(5, NOME_VELHO)
    await conn.none('UPDATE pit.pit SET situacao_id = 3 WHERE ano = 2026')

    try {
      const res = await request(app)
        .put(ROTA(2026, 5))
        .set('Authorization', admin())
        .send({ nome: NOME_NOVO, motivo: MOTIVO })

      expect(res.status).toBe(400)
      expect(await nomeNoBanco(5)).toBe(NOME_VELHO)
    } finally {
      await conn.none('UPDATE pit.pit SET situacao_id = 2 WHERE ano = 2026')
    }
  })
})

// ---------------------------------------------------------------------------
// O CAMINHO FELIZ, e o que ele NÃO pode arrastar junto.
// ---------------------------------------------------------------------------

describe('PUT /api/metas/grupos/:ano/:numeroMeta, o que ela faz', () => {
  test('renomeia o grupo, e só ele', async () => {
    const grupo5 = await criarGrupo(5, NOME_VELHO)
    const grupo6 = await criarGrupo(6, 'Programa Memória do Serviço Geográfico')
    const item = await criarItem(grupo5.id, '5.1')

    const res = await request(app)
      .put(ROTA(2026, 5))
      .set('Authorization', admin())
      .send({ nome: NOME_NOVO, motivo: MOTIVO })

    expect(res.status).toBe(200)
    expect(res.body.dados.nome).toBe(NOME_NOVO)
    expect(res.body.dados.numero_meta).toBe(5)

    // O nome no banco, que é o que o RPCMTec imprime.
    expect(await nomeNoBanco(5)).toBe(NOME_NOVO)

    // O GRUPO VIZINHO não se mexe: o UPDATE tem de casar por id, e não por ano.
    expect(await nomeNoBanco(6)).toBe('Programa Memória do Serviço Geográfico')
    expect(grupo6.id).not.toBe(grupo5.id)

    // O ITEM continua pendurado no mesmo grupo, com a identidade intacta.
    const depois = await conn.one(
      'SELECT meta_id, item, unidade_id, origem_id FROM pit.meta_item WHERE id = $1',
      [item.id]
    )
    expect(String(depois.meta_id)).toBe(String(grupo5.id))
    expect(depois.item).toBe('5.1')
    expect(depois.unidade_id).toBe(3)
    expect(depois.origem_id).toBe(2)
  })

  test('o nome vem aparado, e o motivo fica na auditoria', async () => {
    await criarGrupo(5, NOME_VELHO)

    const res = await request(app)
      .put(ROTA(2026, 5))
      .set('Authorization', admin())
      .send({ nome: `  ${NOME_NOVO}  `, motivo: MOTIVO })

    expect(res.status).toBe(200)
    expect(await nomeNoBanco(5)).toBe(NOME_NOVO)

    const evento = await conn.oneOrNone(
      `SELECT motivo, operacao FROM auditoria.evento
       WHERE tabela = 'pit.meta' ORDER BY id DESC LIMIT 1`
    )
    expect(evento).not.toBeNull()
    expect(evento.operacao).toBe('U')
    expect(evento.motivo).toBe(MOTIVO)
  })

  test('não exige revisão aberta: o grupo não declara nada', async () => {
    await criarGrupo(5, NOME_VELHO)

    // Nenhuma revisão existe no ano, e mesmo assim renomear passa. É a
    // diferença entre IDENTIDADE e DECLARAÇÃO.
    const { count } = await conn.one(
      'SELECT COUNT(*)::int AS count FROM pit.revisao WHERE ano = 2026'
    )
    expect(count).toBe(0)

    const res = await request(app)
      .put(ROTA(2026, 5))
      .set('Authorization', admin())
      .send({ nome: NOME_NOVO, motivo: MOTIVO })

    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// A REGRESSÃO QUE A PORTA NOVA PODERIA ABRIR.
// ---------------------------------------------------------------------------

describe('o resolverMeta continua não sobrescrevendo o nome', () => {
  test('criar item num grupo existente NÃO renomeia o grupo', async () => {
    await criarGrupo(5, NOME_VELHO)

    // Acrescentar item é ato da DSG, e cai na revisão em rascunho do ano.
    const rev = await request(app)
      .post('/api/metas/revisoes')
      .set('Authorization', admin())
      .send({ ano: 2026, codigo: 'R0' })
    expect(rev.status).toBe(201)

    const res = await request(app)
      .post('/api/metas')
      .set('Authorization', admin())
      .send({
        ano: 2026,
        numero_meta: 5,
        item: '5.2',
        descricao: 'Estágio Setorial de Fundamentos em Geoinformação.',
        quantidade_prevista: 3,
        nome: 'Nome que NAO deve vencer',
        unidade_id: 3,
        origem_id: 2
      })

    expect([200, 201]).toContain(res.status)
    expect(await nomeNoBanco(5)).toBe(NOME_VELHO)
  })
})
