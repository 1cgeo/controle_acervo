'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createFullProduct, createVersao } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

describe('Acervo Routes', () => {
  describe('GET /api/acervo/produto/:produto_id', () => {
    it('should return produto by id', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .get(`/api/acervo/produto/${chain.produto.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      // id vem como número (cast ::integer no SELECT) para o corpo desta leitura
      // servir de corpo do PUT, que exige número estrito
      expect(res.body.dados.id).toBe(Number(chain.produto.id))
    })

    it('should return 404 for missing produto', async () => {
      const res = await request(app)
        .get('/api/acervo/produto/99999')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(404)
    })

    it('should reject invalid produto_id param', async () => {
      const res = await request(app)
        .get('/api/acervo/produto/abc')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/acervo/versao/:versao_id', () => {
    it('should return versao by id', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .get(`/api/acervo/versao/${chain.versao.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      // idem ao GET de produto: número, para casar com o schema do PUT
      expect(res.body.dados.id).toBe(Number(chain.versao.id))
    })
  })

  describe('GET /api/acervo/produto/detalhado/:produto_id', () => {
    it('should return detailed produto with versions and files', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .get(`/api/acervo/produto/detalhado/${chain.produto.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.id).toBe(chain.produto.id)
      expect(res.body.dados.versoes).toHaveLength(1)
    })
  })

  describe('POST /api/acervo/prepare-download/arquivos', () => {
    it('should prepare download tokens for files', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .post('/api/acervo/prepare-download/arquivos')
        .set('Authorization', generateUserToken())
        .send({ arquivos_ids: [Number(chain.arquivo.id)] })

      expect(res.status).toBe(200)
      expect(res.body.dados).toBeDefined()
      expect(res.body.dados.length).toBe(1)
      expect(res.body.dados[0].download_token).toBeDefined()
    })

    it('should return 404 for non-existent file ids', async () => {
      const res = await request(app)
        .post('/api/acervo/prepare-download/arquivos')
        .set('Authorization', generateUserToken())
        .send({ arquivos_ids: [99999] })

      expect(res.status).toBe(404)
    })

    it('should reject empty array', async () => {
      const res = await request(app)
        .post('/api/acervo/prepare-download/arquivos')
        .set('Authorization', generateUserToken())
        .send({ arquivos_ids: [] })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/acervo/busca', () => {
    it('should return paginated search results', async () => {
      await createFullProduct()

      // Do not send page/limit as explicit query params because the schema
      // uses .strict() which prevents string-to-number coercion on query params.
      // The route handler defaults page to 1 and limit to 20 via || operator.
      const res = await request(app)
        .get('/api/acervo/busca?termo=Teste')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      // O produto semeado tem de APARECER: `total` definido e `dados` definido
      // passam com zero resultado, que e o modo de falhar da busca.
      expect(res.body.dados.total).toBe(1)
      expect(res.body.dados.page).toBe(1)
      expect(res.body.dados.dados).toHaveLength(1)
    })

    it('should return empty results for non-matching term', async () => {
      const res = await request(app)
        .get('/api/acervo/busca?termo=inexistente_xyz')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.total).toBe(0)
    })
  })

  // O quantitativo ao lado de cada opção do filtro. O contrato tem duas metades,
  // e as duas estão cobertas abaixo:
  //  1. a contagem da opção é o total que a busca devolve ao escolhê-la;
  //  2. cada lista aplica os OUTROS filtros e nunca o próprio.
  describe('GET /api/acervo/busca/facetas', () => {
    it('conta produtos por tipo, escala e subtipo', async () => {
      await createFullProduct()

      const res = await request(app)
        .get('/api/acervo/busca/facetas?termo=Teste')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      const { tipos_produto: tipos, tipos_escala: escalas, subtipos_produto: subtipos } = res.body.dados
      expect(tipos.find(t => t.code === 1).produtos).toBe(1)
      expect(escalas.find(e => e.code === 1).produtos).toBe(1)
      // O subtipo do produto de teste está na VERSÃO (subtipo_produto_id = 1), e
      // não no produto. Contar só `produto.subtipo_produto_id` deixaria a lista
      // vazia justamente no caso comum.
      expect(subtipos.find(s => s.code === 1).produtos).toBe(1)
    })

    it('a contagem da opção é o total que a busca devolve ao escolhê-la', async () => {
      await createFullProduct()
      await createFullProduct({ produto: { nome: 'Produto Teste Orto', tipo_produto_id: 3 } })

      const facetas = await request(app)
        .get('/api/acervo/busca/facetas?termo=Teste')
        .set('Authorization', generateUserToken())

      expect(facetas.status).toBe(200)
      // As DUAS opcoes, antes do laco: com a faceta vazia o corpo nunca roda e
      // o caso fica verde justamente quando a faceta deixou de contar.
      expect(facetas.body.dados.tipos_produto).toHaveLength(2)

      for (const t of facetas.body.dados.tipos_produto) {
        const busca = await request(app)
          .get(`/api/acervo/busca?termo=Teste&tipo_produto_id=${t.code}`)
          .set('Authorization', generateUserToken())
        expect(busca.body.dados.total).toBe(t.produtos)
      }
    })

    it('cada lista aplica os OUTROS filtros, e nunca o próprio', async () => {
      await createFullProduct()
      await createFullProduct({ produto: { nome: 'Produto Teste Orto', tipo_produto_id: 3 } })

      const res = await request(app)
        .get('/api/acervo/busca/facetas?termo=Teste&tipo_produto_id=1')
        .set('Authorization', generateUserToken())

      const tipos = res.body.dados.tipos_produto
      // A lista de tipos NÃO encolheu: os dois continuam lá, com o próprio
      // quantitativo. Sem isso, trocar de tipo exigiria limpar o filtro antes.
      expect(tipos.map(t => t.code).sort()).toEqual([1, 3])
      expect(tipos.find(t => t.code === 3).produtos).toBe(1)
      // A de escalas, sim: ela conta só o que sobrou do tipo escolhido.
      expect(res.body.dados.tipos_escala.find(e => e.code === 1).produtos).toBe(1)
    })

    it('exige autenticação', async () => {
      const res = await request(app).get('/api/acervo/busca/facetas')

      expect(res.status).toBe(401)
    })
  })

  // A busca lista PRODUTOS e anuncia no cartão a última edição. Quem abre a
  // ficha vem atrás das anteriores, e precisa achar a anunciada no topo.
  describe('GET /api/acervo/produto/detalhado/:produto_id', () => {
    it('devolve as versões da mais recente para a mais antiga', async () => {
      const chain = await createFullProduct()
      // data_criacao junto: acervo.versao tem CHECK (data_edicao >= data_criacao),
      // e o padrão da fixture é a data de hoje.
      await createVersao(chain.produto.id, {
        versao: '2-DSG', data_criacao: '2020-01-01', data_edicao: '2020-01-01'
      })
      await createVersao(chain.produto.id, {
        versao: '3-DSG', data_criacao: '2030-01-01', data_edicao: '2030-01-01'
      })

      const res = await request(app)
        .get(`/api/acervo/produto/detalhado/${chain.produto.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      const datas = res.body.dados.versoes.map(v => new Date(v.versao_data_edicao).getTime())
      expect(datas).toEqual([...datas].sort((a, b) => b - a))
      expect(res.body.dados.versoes[0].versao).toBe('3-DSG')
    })
  })

  // A GUARDA de `POST /refresh_materialized_views` nao se prova aqui: o caso
  // era identico ao de routes/auth.test.js ('should reject non-admin users on
  // admin endpoints'), com a mesma rota, o mesmo token e a mesma assercao.
  describe('POST /api/acervo/cleanup-expired-downloads (admin)', () => {
    it('should require admin', async () => {
      const res = await request(app)
        .post('/api/acervo/cleanup-expired-downloads')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(403)
    })

    it('should cleanup expired downloads (admin)', async () => {
      const res = await request(app)
        .post('/api/acervo/cleanup-expired-downloads')
        .set('Authorization', generateAdminToken())

      expect(res.status).toBe(200)
    })
  })
})
