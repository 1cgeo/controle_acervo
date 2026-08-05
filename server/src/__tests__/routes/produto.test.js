'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken, ADMIN_UUID } = require('../helpers/auth')
const { createFullProduct, createProduto, createVersao } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

describe('Produto Routes', () => {
  describe('POST /api/produtos/produtos (bulk create)', () => {
    it('should create products in bulk (admin)', async () => {
      const res = await request(app)
        .post('/api/produtos/produtos')
        .set('Authorization', generateAdminToken())
        .send({
          produtos: [{
            nome: 'Carta Rota',
            mi: 'MI-001',
            inom: 'SF-22-Y-D',
            tipo_escala_id: 2,
            denominador_escala_especial: null,
            tipo_produto_id: 1,
            descricao: null,
            geom: 'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
          }]
        })

      expect(res.status).toBe(201)

      const criado = await conn.oneOrNone(
        `SELECT id FROM acervo.produto WHERE nome = 'Carta Rota'`
      )
      expect(criado).not.toBeNull()
    })

    it('should reject with invalid body', async () => {
      const res = await request(app)
        .post('/api/produtos/produtos')
        .set('Authorization', generateAdminToken())
        .send({ produtos: [] })

      expect(res.status).toBe(400)
    })

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/produtos/produtos')
        .send({ produtos: [{ nome: 'Test' }] })

      expect(res.status).toBe(401)
    })
  })

  describe('PUT /api/produtos/produto (update)', () => {
    it('should require admin', async () => {
      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateUserToken())
        .send({
          id: 1,
          nome: 'Updated',
          tipo_escala_id: 2,
          denominador_escala_especial: null,
          tipo_produto_id: 1,
          descricao: ''
        })

      expect(res.status).toBe(403)
    })

    it('should update produto (admin)', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          id: Number(chain.produto.id),
          nome: 'Atualizado Via Rota',
          mi: 'MI-2345',
          inom: 'INOM-TEST',
          tipo_escala_id: 1,
          denominador_escala_especial: null,
          tipo_produto_id: 1,
          descricao: 'desc atualizada',
          geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))'
        })

      expect(res.status).toBe(200)

      const atualizado = await conn.one(
        `SELECT nome FROM acervo.produto WHERE id = $1`, [chain.produto.id]
      )
      expect(atualizado.nome).toBe('Atualizado Via Rota')
    })

    const corpoProduto = (id, extra = {}) => ({
      id: Number(id),
      nome: 'Produto Teste',
      mi: 'MI-2345',
      inom: 'INOM-TEST',
      tipo_escala_id: 1,
      denominador_escala_especial: null,
      tipo_produto_id: 1,
      descricao: '',
      ...extra
    })

    it('should unpin subtipo_produto_id (null), allowing versions of mixed subtipos', async () => {
      const produto = await createProduto({ subtipo_produto_id: 7 })
      await createVersao(produto.id, { subtipo_produto_id: 7 })

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send(corpoProduto(produto.id, { subtipo_produto_id: null }))

      expect(res.status).toBe(200)

      const atualizado = await conn.one(
        `SELECT subtipo_produto_id FROM acervo.produto WHERE id = $1`, [produto.id]
      )
      expect(atualizado.subtipo_produto_id).toBeNull()
    })

    it('should pin subtipo_produto_id when versions do not conflict', async () => {
      const produto = await createProduto({ subtipo_produto_id: null })
      await createVersao(produto.id, { subtipo_produto_id: 1 })

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send(corpoProduto(produto.id, { subtipo_produto_id: 1 }))

      expect(res.status).toBe(200)

      const atualizado = await conn.one(
        `SELECT subtipo_produto_id FROM acervo.produto WHERE id = $1`, [produto.id]
      )
      expect(Number(atualizado.subtipo_produto_id)).toBe(1)
    })

    it('should refuse to pin a subtipo that existing versions contradict', async () => {
      const produto = await createProduto({ subtipo_produto_id: null })
      await createVersao(produto.id, { subtipo_produto_id: 1 })

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send(corpoProduto(produto.id, { subtipo_produto_id: 7 }))

      expect(res.status).toBe(400)

      const inalterado = await conn.one(
        `SELECT subtipo_produto_id FROM acervo.produto WHERE id = $1`, [produto.id]
      )
      expect(inalterado.subtipo_produto_id).toBeNull()
    })

    it('should keep subtipo_produto_id untouched when the field is omitted', async () => {
      const produto = await createProduto({ subtipo_produto_id: null })

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send(corpoProduto(produto.id, { nome: 'Sem subtipo no corpo' }))

      expect(res.status).toBe(200)

      const atualizado = await conn.one(
        `SELECT nome, subtipo_produto_id FROM acervo.produto WHERE id = $1`, [produto.id]
      )
      expect(atualizado.nome).toBe('Sem subtipo no corpo')
      expect(atualizado.subtipo_produto_id).toBeNull()
    })
  })

  describe('DELETE /api/produtos/produto', () => {
    it('should delete produto moving files to arquivo_deletado', async () => {
      const chain = await createFullProduct()

      const res = await request(app)
        .delete('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          produto_ids: [Number(chain.produto.id)],
          motivo_exclusao: 'Teste de exclusão'
        })

      expect(res.status).toBe(200)

      const restante = await conn.oneOrNone(
        `SELECT id FROM acervo.produto WHERE id = $1`, [chain.produto.id]
      )
      expect(restante).toBeNull()

      const deletado = await conn.one(
        `SELECT COUNT(*)::int AS n FROM acervo.arquivo_deletado WHERE versao_id IS NULL OR versao_id = $1`,
        [chain.versao.id]
      )
      expect(deletado.n).toBe(1)
    })

    it('should return 404 for non-existent product', async () => {
      const res = await request(app)
        .delete('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          produto_ids: [99999],
          motivo_exclusao: 'Não existe'
        })

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/produtos/renumerar-versoes', () => {
    it('should shift existing editions to open a slot for an older one', async () => {
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1ª Edição', subtipo_produto_id: 2, data_criacao: '2001-01-01', data_edicao: '2001-01-01' })

      const res = await request(app)
        .post('/api/produtos/renumerar-versoes')
        .set('Authorization', generateAdminToken())
        .send({
          produto_id: Number(produto.id),
          subtipo_produto_id: 2,
          familia: 'EDICAO',
          nova_data_edicao: '1957-01-01'
        })

      expect(res.status).toBe(200)
      expect(res.body.dados.rotulo_livre).toBe('1ª Edição')
      expect(res.body.dados.versoes_deslocadas).toHaveLength(1)

      const versao = await conn.one(
        `SELECT versao FROM acervo.versao WHERE produto_id = $1`, [produto.id]
      )
      expect(versao.versao).toBe('2ª Edição')
    })

    it('should reject without admin auth', async () => {
      const produto = await createProduto()

      const res = await request(app)
        .post('/api/produtos/renumerar-versoes')
        .set('Authorization', generateUserToken())
        .send({
          produto_id: Number(produto.id),
          subtipo_produto_id: 2,
          familia: 'EDICAO',
          nova_data_edicao: '1957-01-01'
        })

      expect(res.status).toBe(403)
    })

    it('should reject invalid familia format', async () => {
      const produto = await createProduto()

      const res = await request(app)
        .post('/api/produtos/renumerar-versoes')
        .set('Authorization', generateAdminToken())
        .send({
          produto_id: Number(produto.id),
          subtipo_produto_id: 2,
          familia: 'demasiado-longa',
          nova_data_edicao: '1957-01-01'
        })

      expect(res.status).toBe(400)
    })
  })

  // A versao PLANEJADA e a folha que ainda vamos produzir. Ela existe para o item
  // do pedido poder apontar para um MI de verdade, em vez de a informacao morrer
  // numa observacao em prosa. O que estes testes guardam e o CICLO: nasce sem
  // arquivo, e o arquivo entra na MESMA versao quando a producao terminar.
  describe('POST /api/produtos/produto_versao_planejada', () => {
    const folhaPlanejada = (over = {}) => ([{
      nome: 'Arapongas-NE',
      mi: '2758-3-NE',
      inom: 'SF-22-Y-D-III-3-NE',
      tipo_escala_id: 1,
      denominador_escala_especial: null,
      tipo_produto_id: 3,
      subtipo_produto_id: null,
      descricao: '',
      geom: 'SRID=4674;POLYGON((-51.375 -23.375,-51.375 -23.25,-51.25 -23.25,-51.25 -23.375,-51.375 -23.375))',
      versoes: [{
        uuid_versao: null,
        versao: '1-DSG',
        nome: null,
        subtipo_produto_id: 3,
        lote_id: null,
        metadado: {},
        descricao: '',
        orgao_produtor: '1º CGEO',
        palavras_chave: [],
        data_criacao: '2026-07-30',
        data_edicao: '2026-07-30'
      }],
      ...over
    }])

    it('cria o produto e a versao com tipo_versao_id 3 e NENHUM arquivo', async () => {
      const res = await request(app)
        .post('/api/produtos/produto_versao_planejada')
        .set('Authorization', generateAdminToken())
        .send(folhaPlanejada())

      expect(res.status).toBe(201)

      const versao = await conn.one(`
        SELECT v.tipo_versao_id, v.id, p.mi, p.tipo_produto_id, p.tipo_escala_id,
               (SELECT count(*)::int FROM acervo.arquivo a WHERE a.versao_id = v.id) AS arquivos
        FROM acervo.versao v JOIN acervo.produto p ON p.id = v.produto_id
        WHERE p.mi = '2758-3-NE'`)

      expect(versao.tipo_versao_id).toBe(3)
      // Sem isto a folha planejada apareceria como imprimivel na fila.
      expect(versao.arquivos).toBe(0)
      expect(versao.tipo_produto_id).toBe(3)
      expect(versao.tipo_escala_id).toBe(1)
    })

    it('a versao planejada NAO exige a edicao anterior, como a historica', async () => {
      // O caminho estrito do gatilho validate_version pede a versao N-1. Uma
      // folha que ainda nao existe nao tem edicao anterior nenhuma, e a regra
      // passou a valer para todo tipo que nao e Regular.
      const res = await request(app)
        .post('/api/produtos/produto_versao_planejada')
        .set('Authorization', generateAdminToken())
        .send(folhaPlanejada({
          mi: '2758-3-NO',
          inom: 'SF-22-Y-D-III-3-NO',
          nome: 'Arapongas-NO',
          versoes: [{
            uuid_versao: null, versao: '3-DSG', nome: null, subtipo_produto_id: 3,
            lote_id: null, metadado: {}, descricao: '', orgao_produtor: '1º CGEO',
            palavras_chave: [], data_criacao: '2026-07-30', data_edicao: '2026-07-30'
          }]
        }))

      expect(res.status).toBe(201)
    })

    it('exige perfil de operador', async () => {
      const res = await request(app)
        .post('/api/produtos/produto_versao_planejada')
        .set('Authorization', generateUserToken())
        .send(folhaPlanejada({ mi: '2758-3-SE', inom: 'SF-22-Y-D-III-3-SE' }))

      expect(res.status).toBe(403)
    })

    it('a rota historica continua gravando tipo 2, e nao 3', async () => {
      const res = await request(app)
        .post('/api/produtos/produto_versao_historica')
        .set('Authorization', generateAdminToken())
        .send(folhaPlanejada({ mi: '2758-3-SO', inom: 'SF-22-Y-D-III-3-SO', nome: 'Arapongas-SO' }))

      expect(res.status).toBe(201)
      const versao = await conn.one(`
        SELECT v.tipo_versao_id FROM acervo.versao v
        JOIN acervo.produto p ON p.id = v.produto_id WHERE p.mi = '2758-3-SO'`)
      expect(versao.tipo_versao_id).toBe(2)
    })
  })

  // Versao planejada num produto que JA EXISTE. E a irma de
  // /produto_versao_planejada para a folha que ja esta no acervo e vai ganhar
  // uma edicao nova: o produto nao pode nascer de novo, so a versao.
  describe('POST /api/produtos/versao_planejada', () => {
    const versaoPlanejada = (produtoId, over = {}) => ([{
      uuid_versao: null,
      versao: '1-DSG',
      nome: null,
      produto_id: Number(produtoId),
      subtipo_produto_id: 1,
      lote_id: null,
      metadado: {},
      descricao: '',
      orgao_produtor: '1º CGEO',
      palavras_chave: [],
      data_criacao: '2026-07-30',
      data_edicao: '2026-07-30',
      ...over
    }])

    it('grava tipo_versao_id 3 no produto existente, sem arquivo', async () => {
      const produto = await createProduto()

      const res = await request(app)
        .post('/api/produtos/versao_planejada')
        .set('Authorization', generateAdminToken())
        .send(versaoPlanejada(produto.id))

      expect(res.status).toBe(201)

      const versao = await conn.one(`
        SELECT v.tipo_versao_id, v.versao,
               (SELECT count(*)::int FROM acervo.arquivo a WHERE a.versao_id = v.id) AS arquivos
        FROM acervo.versao v WHERE v.produto_id = $1`, [produto.id])

      expect(versao.tipo_versao_id).toBe(3)
      expect(versao.versao).toBe('1-DSG')
      // Sem isto a folha prometida apareceria como imprimivel na fila.
      expect(versao.arquivos).toBe(0)
    })

    // A rota gemea nao pode escorregar de tipo: as duas passam pelo MESMO corpo
    // de funcao, e um argumento trocado nao daria erro nenhum, so um numero
    // errado na coluna que separa promessa de registro.
    it('a rota historica continua gravando tipo 2, e nao 3', async () => {
      const produto = await createProduto()

      const res = await request(app)
        .post('/api/produtos/versao_historica')
        .set('Authorization', generateAdminToken())
        .send(versaoPlanejada(produto.id))

      expect(res.status).toBe(201)

      const versao = await conn.one(
        `SELECT tipo_versao_id FROM acervo.versao WHERE produto_id = $1`, [produto.id]
      )
      expect(versao.tipo_versao_id).toBe(2)
    })

    it('produto inexistente nao grava versao nenhuma', async () => {
      const res = await request(app)
        .post('/api/produtos/versao_planejada')
        .set('Authorization', generateAdminToken())
        .send(versaoPlanejada(999999))

      expect(res.status).toBeGreaterThanOrEqual(400)

      const n = await conn.one(
        `SELECT count(*)::int AS c FROM acervo.versao WHERE produto_id = 999999`
      )
      expect(n.c).toBe(0)
    })

    // 409, e nao 400: o corpo esta certo, o que colide e o estado do acervo. E o
    // mesmo espelho amigavel da UNIQUE unique_version_per_product que a rota
    // historica ja tinha.
    it('versao repetida no mesmo produto devolve 409', async () => {
      const produto = await createProduto()
      await createVersao(produto.id, { versao: '1-DSG' })

      const res = await request(app)
        .post('/api/produtos/versao_planejada')
        .set('Authorization', generateAdminToken())
        .send(versaoPlanejada(produto.id))

      expect(res.status).toBe(409)

      const n = await conn.one(
        `SELECT count(*)::int AS c FROM acervo.versao WHERE produto_id = $1`, [produto.id]
      )
      expect(n.c).toBe(1)
    })

    it('exige perfil de operador', async () => {
      const produto = await createProduto()

      const res = await request(app)
        .post('/api/produtos/versao_planejada')
        .set('Authorization', generateUserToken())
        .send(versaoPlanejada(produto.id))

      expect(res.status).toBe(403)
    })

    // 404, e nao 500. Antes, `produto_id` inexistente estourava a chave
    // estrangeira e virava a mensagem generica de erro interno -- que e o que o
    // servidor responde quando ELE errou. Aqui quem errou foi quem chamou, e o
    // 500 nao dizia que o problema era o id do produto.
    it('produto inexistente devolve 404 dizendo qual id faltou', async () => {
      const res = await request(app)
        .post('/api/produtos/versao_planejada')
        .set('Authorization', generateAdminToken())
        .send(versaoPlanejada(9999999))

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('9999999')

      const n = await conn.one('SELECT count(*)::int AS c FROM acervo.versao')
      expect(n.c).toBe(0)
    })

    // Em lote, o erro nomeia TODOS os que faltam: dizer so o primeiro faria quem
    // corrigisse voltar a tomar 404 pelo seguinte, um por vez.
    it('em lote, nomeia todos os produtos que faltam e nao grava nenhum', async () => {
      const produto = await createProduto()

      const res = await request(app)
        .post('/api/produtos/versao_planejada')
        .set('Authorization', generateAdminToken())
        .send([
          ...versaoPlanejada(produto.id),
          ...versaoPlanejada(8888888, { versao: '2-DSG' }),
          ...versaoPlanejada(7777777, { versao: '3-DSG' })
        ])

      expect(res.status).toBe(404)
      expect(res.body.message).toContain('8888888')
      expect(res.body.message).toContain('7777777')

      // A transacao nao deixa meia carga: nem a versao do produto que EXISTE.
      const n = await conn.one('SELECT count(*)::int AS c FROM acervo.versao')
      expect(n.c).toBe(0)
    })

    // A rota historica e a irma, e passa pelo MESMO controlador: consertar uma e
    // esquecer a outra e o modo de falhar que este caso fecha.
    it('a rota historica ganha o mesmo 404', async () => {
      const res = await request(app)
        .post('/api/produtos/versao_historica')
        .set('Authorization', generateAdminToken())
        .send(versaoPlanejada(9999999, { versao: '1ª Edição' }))

      expect(res.status).toBe(404)
      expect(res.body.message).toContain('9999999')
    })
  })

  describe('GET /api/produtos/versao_relacionamento', () => {
    it('devolve o relacionamento gravado, e nao so uma lista vazia', async () => {
      // Com o banco limpo a rota devolve `[]`, e `Array.isArray([])` e verdade
      // para toda implementacao, certa ou errada. Semeando o relacionamento, a
      // lista tem de TRAZE-LO.
      const p1 = await createProduto({ nome: 'Rel A', mi: 'MI-REL-A', inom: 'INOM-REL-A' })
      const p2 = await createProduto({ nome: 'Rel B', mi: 'MI-REL-B', inom: 'INOM-REL-B' })
      const v1 = await createVersao(p1.id)
      const v2 = await createVersao(p2.id)
      await conn.none(
        `INSERT INTO acervo.versao_relacionamento
           (versao_id_1, versao_id_2, tipo_relacionamento_id, usuario_relacionamento_uuid)
         VALUES ($1, $2, 1, $3)`,
        [v1.id, v2.id, ADMIN_UUID]
      )

      const res = await request(app)
        .get('/api/produtos/versao_relacionamento')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      const par = res.body.dados.find(r => Number(r.versao_id_1) === Number(v1.id))
      expect(par).toBeDefined()
      expect(Number(par.versao_id_2)).toBe(Number(v2.id))
    })
  })
})
