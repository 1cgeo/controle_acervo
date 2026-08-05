'use strict'

// O que estes testes protegem
//
// A leitura tem que devolver tudo o que a escrita exige, com os mesmos nomes.
// Quando isso não vale, o fluxo mais banal do sistema (ler um registro, mudar
// um campo, reenviar) apaga dado sem erro nenhum. Foi o que aconteceu com
// subtipo_produto_id: o GET não o devolvia, o schema do PUT tinha .default(null),
// e uma Carta Militar deixava de ser militar com resposta 200.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createProduto, createVersao } = require('../helpers/fixtures')

const produtoSchema = require('../../produto/produto_schema')

// 24 = Carta Topográfica Militar (dominio.subtipo_produto.define_produto = true)
const SUBTIPO_MILITAR = 24

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

describe('Contrato leitura/escrita', () => {
  describe('GET /api/acervo/produto/:id devolve o que PUT /api/produtos/produto exige', () => {
    it('devolve subtipo_produto_id (a identidade do produto)', async () => {
      const produto = await createProduto({ subtipo_produto_id: SUBTIPO_MILITAR })

      const res = await request(app)
        .get(`/api/acervo/produto/${produto.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveProperty('subtipo_produto_id')
      expect(res.body.dados.subtipo_produto_id).toBe(SUBTIPO_MILITAR)
    })

    it('devolve geom em EWKT, formato que o PUT consegue reescrever', async () => {
      const produto = await createProduto()

      const res = await request(app)
        .get(`/api/acervo/produto/${produto.id}`)
        .set('Authorization', generateUserToken())

      expect(res.body.dados.geom).toMatch(/^SRID=4674;POLYGON/)
    })

    it('o corpo devolvido pelo GET é aceito pelo schema do PUT sem perder campo', () => {
      const doGet = {
        id: 1,
        nome: 'Carta Militar',
        mi: 'MI-2345',
        inom: 'INOM-TEST',
        tipo_escala_id: 1,
        denominador_escala_especial: null,
        tipo_produto_id: 1,
        subtipo_produto_id: SUBTIPO_MILITAR,
        descricao: 'x',
        geom: 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))'
      }

      const { error, value } = produtoSchema.produtoAtualizacao.validate(doGet, {
        stripUnknown: true,
        abortEarly: false
      })

      expect(error).toBeUndefined()
      expect(value.subtipo_produto_id).toBe(SUBTIPO_MILITAR)
    })

    it('ler e reenviar sem tocar em nada preserva a identidade militar', async () => {
      const produto = await createProduto({ subtipo_produto_id: SUBTIPO_MILITAR })

      const lido = await request(app)
        .get(`/api/acervo/produto/${produto.id}`)
        .set('Authorization', generateUserToken())

      const escrito = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send(lido.body.dados)

      expect(escrito.status).toBe(200)

      const depois = await conn.one(
        'SELECT subtipo_produto_id FROM acervo.produto WHERE id = $1',
        [produto.id]
      )
      expect(Number(depois.subtipo_produto_id)).toBe(SUBTIPO_MILITAR)
    })
  })

  // O domínio é lido para MONTAR o corpo, então ele também é contrato de
  // escrita: sem `define_produto`, quem escolhe o subtipo não tem como saber
  // que aquele exige produto próprio, e a recusa só chega no gatilho, depois
  // de o operador já ter copiado os bytes para o volume.
  describe('GET /api/gerencia/dominio/subtipo_produto', () => {
    it('devolve define_produto, a regra que o gatilho vai cobrar', async () => {
      const res = await request(app)
        .get('/api/gerencia/dominio/subtipo_produto')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)

      const militar = res.body.dados.find(s => s.code === SUBTIPO_MILITAR)
      expect(militar).toBeDefined()
      expect(militar.define_produto).toBe(true)

      // E o campo não é constante: subtipo comum vem false, senão o cliente
      // passaria a exigir produto próprio para todo mundo.
      expect(res.body.dados.some(s => s.define_produto === false)).toBe(true)
    })
  })

  describe('PUT /api/produtos/produto e o subtipo omitido', () => {
    it('omitir subtipo_produto_id preserva o valor gravado', async () => {
      const produto = await createProduto({ subtipo_produto_id: SUBTIPO_MILITAR })

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          id: Number(produto.id),
          nome: 'Nome novo',
          mi: produto.mi,
          inom: produto.inom,
          tipo_escala_id: produto.tipo_escala_id,
          denominador_escala_especial: null,
          tipo_produto_id: produto.tipo_produto_id,
          descricao: 'descricao nova'
        })

      expect(res.status).toBe(200)

      const depois = await conn.one(
        'SELECT nome, subtipo_produto_id FROM acervo.produto WHERE id = $1',
        [produto.id]
      )
      expect(depois.nome).toBe('Nome novo')
      expect(Number(depois.subtipo_produto_id)).toBe(SUBTIPO_MILITAR)
    })

    it('enviar subtipo_produto_id null continua despinando o produto', async () => {
      const produto = await createProduto({ subtipo_produto_id: SUBTIPO_MILITAR })

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          id: Number(produto.id),
          nome: produto.nome,
          mi: produto.mi,
          inom: produto.inom,
          tipo_escala_id: produto.tipo_escala_id,
          denominador_escala_especial: null,
          tipo_produto_id: produto.tipo_produto_id,
          subtipo_produto_id: null,
          descricao: produto.descricao
        })

      expect(res.status).toBe(200)

      const depois = await conn.one(
        'SELECT subtipo_produto_id FROM acervo.produto WHERE id = $1',
        [produto.id]
      )
      expect(depois.subtipo_produto_id).toBeNull()
    })
  })

  describe('GET /api/acervo/versao/:id devolve o que PUT /api/produtos/versao exige', () => {
    it('devolve nome (a chave do PUT), mantendo nome_versao por compatibilidade', async () => {
      const produto = await createProduto()
      const versao = await createVersao(produto.id, { nome: 'Folha Alfa' })

      const res = await request(app)
        .get(`/api/acervo/versao/${versao.id}`)
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados.nome).toBe('Folha Alfa')
      expect(res.body.dados.nome_versao).toBe('Folha Alfa')
    })

    it('ler e reenviar sem tocar em nada preserva o nome da versão', async () => {
      const produto = await createProduto()
      const versao = await createVersao(produto.id, {
        nome: 'Folha Alfa',
        metadado: {}
      })

      const lido = await request(app)
        .get(`/api/acervo/versao/${versao.id}`)
        .set('Authorization', generateUserToken())

      const escrito = await request(app)
        .put('/api/produtos/versao')
        .set('Authorization', generateAdminToken())
        .send(lido.body.dados)

      expect(escrito.status).toBe(200)

      const depois = await conn.one(
        'SELECT nome, palavras_chave FROM acervo.versao WHERE id = $1',
        [versao.id]
      )
      expect(depois.nome).toBe('Folha Alfa')
      expect(depois.palavras_chave).toEqual(['teste', 'acervo'])
    })

    it('omitir palavras_chave preserva as gravadas', async () => {
      const produto = await createProduto()
      const versao = await createVersao(produto.id, { metadado: {} })

      const res = await request(app)
        .put('/api/produtos/versao')
        .set('Authorization', generateAdminToken())
        .send({
          id: Number(versao.id),
          versao: versao.versao,
          nome: versao.nome,
          tipo_versao_id: versao.tipo_versao_id,
          subtipo_produto_id: versao.subtipo_produto_id,
          descricao: 'nova descricao',
          metadado: {},
          lote_id: null,
          orgao_produtor: versao.orgao_produtor,
          data_criacao: versao.data_criacao,
          data_edicao: versao.data_edicao
        })

      expect(res.status).toBe(200)

      const depois = await conn.one(
        'SELECT palavras_chave FROM acervo.versao WHERE id = $1',
        [versao.id]
      )
      expect(depois.palavras_chave).toEqual(['teste', 'acervo'])
    })

    it('recusa uuid_versao divergente em vez de aceitar e não gravar', async () => {
      const produto = await createProduto()
      const versao = await createVersao(produto.id, { metadado: {} })

      const res = await request(app)
        .put('/api/produtos/versao')
        .set('Authorization', generateAdminToken())
        .send({
          id: Number(versao.id),
          uuid_versao: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
          versao: versao.versao,
          nome: versao.nome,
          tipo_versao_id: versao.tipo_versao_id,
          subtipo_produto_id: versao.subtipo_produto_id,
          descricao: versao.descricao,
          metadado: {},
          lote_id: null,
          orgao_produtor: versao.orgao_produtor,
          palavras_chave: versao.palavras_chave,
          data_criacao: versao.data_criacao,
          data_edicao: versao.data_edicao
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/uuid_versao/)
    })
  })

  describe('Campo desconhecido não some mais em silêncio', () => {
    it('responde 200 mas avisa qual chave foi descartada', async () => {
      const produto = await createProduto({ subtipo_produto_id: SUBTIPO_MILITAR })

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          id: Number(produto.id),
          nome: produto.nome,
          mi: produto.mi,
          inom: produto.inom,
          tipo_escala_id: produto.tipo_escala_id,
          denominador_escala_especial: null,
          tipo_produto_id: produto.tipo_produto_id,
          // nome errado de propósito: quem escreve isso acha que gravou o subtipo
          subtipo_produto: SUBTIPO_MILITAR,
          descricao: produto.descricao
        })

      expect(res.status).toBe(200)
      expect(res.body.avisos).toBeDefined()
      expect(res.body.avisos[0]).toMatch(/subtipo_produto/)
      expect(res.body.avisos[0]).toMatch(/NÃO foram gravados/)
    })

    it('não inventa aviso quando o corpo está inteiramente correto', async () => {
      const produto = await createProduto()

      const res = await request(app)
        .put('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({
          id: Number(produto.id),
          nome: produto.nome,
          mi: produto.mi,
          inom: produto.inom,
          tipo_escala_id: produto.tipo_escala_id,
          denominador_escala_especial: null,
          tipo_produto_id: produto.tipo_produto_id,
          subtipo_produto_id: null,
          descricao: produto.descricao
        })

      expect(res.status).toBe(200)
      expect(res.body.avisos).toBeUndefined()
    })

    it('aponta a chave desconhecida dentro de item de array', async () => {
      const res = await request(app)
        .post('/api/produtos/produtos')
        .set('Authorization', generateAdminToken())
        .send({
          produtos: [{
            nome: 'Carta Aviso',
            mi: 'MI-AVISO',
            inom: 'SF-22-Y-D',
            tipo_escala_id: 2,
            denominador_escala_especial: null,
            tipo_produto_id: 1,
            descricao: null,
            escala: '1:25.000',
            geom: 'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
          }]
        })

      expect(res.status).toBe(201)
      expect(res.body.avisos[0]).toMatch(/produtos\[0\]\.escala/)
    })
  })
})
