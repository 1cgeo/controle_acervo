'use strict'

// Demanda Extra-PIT contra BANCO DE VERDADE, e não contra mock.
//
// POR QUE AQUI E NÃO EM pit_route.test.js, que mocka o banco: o que se prova
// nesta suíte é uma REGRA, e regra mockada só prova que o código chamou a si
// mesmo. A materialização depende de contar linhas de `acervo.versao` e de dois
// CHECK do PostgreSQL (`versao_plano_ou_excecao` e
// `demanda_extra_origem_manual_ou_producao`), e nenhum dos dois existe num mock.
//
// A LIÇÃO QUE ORIGINOU ESTE ARQUIVO: o guard da grade do PIT foi
// "testado" mandando escrita na PRODUÇÃO, e duas linhas reais foram alteradas
// antes de alguém perceber. Guard se exercita contra banco de ensaio.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProduto, createVersao } = require('../helpers/fixtures')

let app

const PREVISTO = 1
const EM_PRODUCAO = 2
const ENVIADO = 3
const CONCLUIDO = 4

const MANUAL = 1
const PRODUCAO = 3

beforeAll(async () => {
  app = await getApp()
})

// A ORDEM IMPORTA, e ela é a própria regra sob teste: `acervo.versao` aponta
// para a demanda, então a versão sai primeiro. Apagar a demanda antes esbarra na
// `versao_demanda_extra_id_fkey`, que é exatamente o que o DELETE da rota
// recusa. `pit.demanda_extra` não entra no cleanTestData porque é do schema pit.
afterEach(async () => {
  await cleanTestData()
  await conn.none('DELETE FROM pit.demanda_extra')
})

// Identidade única por chamada: `unique_produto_identidade` cobre mi, inom,
// escala e tipo, e o fixture tem um só valor padrão. Dois produtos no mesmo
// teste colidiriam.
let sequencia = 0
const produtoNovo = async () => {
  sequencia += 1
  return createProduto({
    mi: `MI-EXTRA-${sequencia}`,
    inom: `INOM-EXTRA-${sequencia}`
  })
}

const corpo = (over = {}) => ({
  ano: 2026,
  demandante: 'OM Teste',
  tipo_produto: 'Carta Ortoimagem Especial',
  quantidade: 3,
  situacao_id: PREVISTO,
  documento_autorizacao: 'DIEx 1-Teste',
  descricao: 'Demanda de teste',
  data_entrega: null,
  ...over
})

const criar = async over => {
  const res = await request(app)
    .post('/api/metas/extra')
    .set('Authorization', generateAdminToken())
    .send(corpo(over))
  return res
}

const atualizar = async (id, over) => {
  return request(app)
    .put(`/api/metas/extra/${id}`)
    .set('Authorization', generateAdminToken())
    .send(corpo(over))
}

const ligarVersao = async demandaId => {
  const produto = await produtoNovo()
  const versao = await createVersao(produto.id)
  await conn.none(
    'UPDATE acervo.versao SET demanda_extra_id = $1 WHERE id = $2',
    [demandaId, versao.id]
  )
  return versao
}

describe('Origem da demanda Extra-PIT', () => {
  test('sem origem no corpo nasce Manual, e o comportamento antigo segue', async () => {
    const res = await criar()
    expect(res.status).toBe(201)

    const linha = await conn.one(
      'SELECT origem_id FROM pit.demanda_extra WHERE id = $1',
      [res.body.dados.id]
    )
    expect(linha.origem_id).toBe(MANUAL)
  })

  test('recusa origem que não seja Manual nem Produção', async () => {
    // 2 é Capacitação em dominio.origem_meta, e não faz sentido para a demanda.
    const res = await criar({ origem_id: 2 })
    expect(res.status).toBe(400)
  })

  test('a leitura devolve a origem por extenso e o quanto materializou', async () => {
    const criada = await criar({ origem_id: PRODUCAO, situacao_id: EM_PRODUCAO })
    await ligarVersao(criada.body.dados.id)

    const res = await request(app)
      .get('/api/metas/extra?ano=2026')
      .set('Authorization', generateAdminToken())
    expect(res.status).toBe(200)

    const linha = res.body.dados.find(d => Number(d.id) === Number(criada.body.dados.id))
    expect(linha.origem).toBe('Produção')
    expect(linha.quantidade_materializada).toBe(1)
  })
})

describe('A demanda de Produção não fecha sem materializar', () => {
  test('não nasce Concluída, porque na criação não há o que apontar para ela', async () => {
    const res = await criar({ origem_id: PRODUCAO, situacao_id: CONCLUIDO })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/nenhuma versão do acervo aponta/i)

    const { total } = await conn.one(
      'SELECT count(*)::int AS total FROM pit.demanda_extra'
    )
    expect(total).toBe(0)
  })

  test('recusa Enviado tanto quanto Concluído: as duas afirmam entrega', async () => {
    const criada = await criar({ origem_id: PRODUCAO, situacao_id: PREVISTO })
    const res = await atualizar(criada.body.dados.id, {
      origem_id: PRODUCAO,
      situacao_id: ENVIADO
    })
    expect(res.status).toBe(400)

    const linha = await conn.one(
      'SELECT situacao_id FROM pit.demanda_extra WHERE id = $1',
      [criada.body.dados.id]
    )
    expect(linha.situacao_id).toBe(PREVISTO)
  })

  test('com uma versão ligada, fecha', async () => {
    const criada = await criar({ origem_id: PRODUCAO, situacao_id: EM_PRODUCAO })
    await ligarVersao(criada.body.dados.id)

    const res = await atualizar(criada.body.dados.id, {
      origem_id: PRODUCAO,
      situacao_id: CONCLUIDO,
      data_entrega: '2026-07-30'
    })
    expect(res.status).toBe(200)

    const linha = await conn.one(
      'SELECT situacao_id FROM pit.demanda_extra WHERE id = $1',
      [criada.body.dados.id]
    )
    expect(linha.situacao_id).toBe(CONCLUIDO)
  })

  test('uma versão basta, mesmo prometendo mais: a quantidade muda de unidade por linha', async () => {
    const criada = await criar({
      origem_id: PRODUCAO,
      situacao_id: EM_PRODUCAO,
      quantidade: 74
    })
    await ligarVersao(criada.body.dados.id)

    const res = await atualizar(criada.body.dados.id, {
      origem_id: PRODUCAO,
      situacao_id: CONCLUIDO,
      quantidade: 74
    })
    expect(res.status).toBe(200)
  })

  test('a demanda Manual fecha sem versão nenhuma, e é para isso que ela existe', async () => {
    const criada = await criar({
      origem_id: MANUAL,
      situacao_id: PREVISTO,
      tipo_produto: 'Exposição'
    })
    const res = await atualizar(criada.body.dados.id, {
      origem_id: MANUAL,
      situacao_id: CONCLUIDO,
      tipo_produto: 'Exposição'
    })
    expect(res.status).toBe(200)
  })
})

describe('A folha cumpre o plano OU é a exceção', () => {
  test('o banco recusa meta e demanda na mesma versão', async () => {
    const criada = await criar({ origem_id: PRODUCAO })
    const meta = await conn.one(
      // Só a IDENTIDADE: a descrição mora em pit.meta_revisao,
      // e este caso não precisa dela. O que se prova aqui é o CHECK do banco.
      `INSERT INTO pit.meta (ano, numero_meta, item, usuario_cadastramento_uuid)
       VALUES (2026, 1, '1.1', (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1))
       ON CONFLICT (ano, numero_meta, item) DO UPDATE SET ano = EXCLUDED.ano
       RETURNING id`
    )
    const produto = await produtoNovo()
    const versao = await createVersao(produto.id)

    await expect(
      conn.none(
        'UPDATE acervo.versao SET meta_pit_id = $1, demanda_extra_id = $2 WHERE id = $3',
        [meta.id, criada.body.dados.id, versao.id]
      )
    ).rejects.toThrow(/versao_plano_ou_excecao/)

    await conn.none('DELETE FROM pit.meta WHERE id = $1', [meta.id])
  })
})

describe('Excluir demanda que já materializou', () => {
  test('recusa, e diz quantas folhas seguram', async () => {
    const criada = await criar({ origem_id: PRODUCAO })
    await ligarVersao(criada.body.dados.id)

    const res = await request(app)
      .delete(`/api/metas/extra/${criada.body.dados.id}`)
      .set('Authorization', generateAdminToken())
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/1 vers/i)

    const { total } = await conn.one(
      'SELECT count(*)::int AS total FROM pit.demanda_extra WHERE id = $1',
      [criada.body.dados.id]
    )
    expect(total).toBe(1)
  })
})
