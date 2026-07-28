'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { generateAdminToken, generateUserToken, generateExpiredToken, generateToken, USER_UUID } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

describe('Auth Routes', () => {
  describe('GET /api/', () => {
    it('should return API status without auth', async () => {
      const res = await request(app).get('/api/')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.message).toContain('operacional')
    })
  })

  describe('Auth middleware (via protected endpoint)', () => {
    it('should reject requests without token', async () => {
      const res = await request(app).get('/api/acervo/camadas_produto')
      expect(res.status).toBe(401)
    })

    it('should reject requests with invalid token', async () => {
      const res = await request(app)
        .get('/api/acervo/camadas_produto')
        .set('Authorization', 'invalid-token')
      expect(res.status).toBe(401)
    })

    it('should reject expired tokens', async () => {
      // Wait a moment for the 0s token to expire
      await new Promise(resolve => setTimeout(resolve, 1100))
      const res = await request(app)
        .get('/api/acervo/camadas_produto')
        .set('Authorization', generateExpiredToken())
      expect(res.status).toBe(401)
    })

    it('should accept valid admin token', async () => {
      const res = await request(app)
        .get('/api/acervo/camadas_produto')
        .set('Authorization', generateAdminToken())
      // May get 200 or a DB error, but NOT 401
      expect(res.status).not.toBe(401)
    })

    it('should accept valid user token', async () => {
      const res = await request(app)
        .get('/api/acervo/camadas_produto')
        .set('Authorization', generateUserToken())
      expect(res.status).not.toBe(401)
    })

    it('should accept Bearer prefix', async () => {
      const res = await request(app)
        .get('/api/acervo/camadas_produto')
        .set('Authorization', `Bearer ${generateAdminToken()}`)
      expect(res.status).not.toBe(401)
    })
  })

  describe('Admin middleware (via admin-only endpoint)', () => {
    it('should reject non-admin users on admin endpoints', async () => {
      const res = await request(app)
        .post('/api/acervo/refresh_materialized_views')
        .set('Authorization', generateUserToken())
      expect(res.status).toBe(403)
    })

    it('should allow admin users on admin endpoints', async () => {
      const res = await request(app)
        .post('/api/acervo/refresh_materialized_views')
        .set('Authorization', generateAdminToken())
      // May succeed or fail for DB reason, but not 403
      expect(res.status).not.toBe(403)
    })
  })

  // O client guarda `perfis` desde o login. Quem foi rebaixado no meio do
  // expediente continuava vendo botao que o servidor ja recusava, ate sair e
  // entrar de novo. Esta rota deixa o client reconferir a foto sem novo login.
  describe('GET /api/login/sessao', () => {
    it('should reject requests without token', async () => {
      const res = await request(app).get('/api/login/sessao')
      expect(res.status).toBe(401)
    })

    it('should reject expired tokens', async () => {
      const res = await request(app)
        .get('/api/login/sessao')
        .set('Authorization', generateExpiredToken())
      expect(res.status).toBe(401)
    })

    // Nao exige perfil em modulo nenhum de proposito: quem perdeu todo o acesso
    // tambem precisa da resposta, senao a tela nunca para de oferecer o que ele
    // nao pode mais.
    it('should answer a valid token with perfis and modulos', async () => {
      const res = await request(app)
        .get('/api/login/sessao')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.dados).toHaveProperty('perfis')
      expect(res.body.dados).toHaveProperty('modulos')
      expect(res.body.dados).toHaveProperty('administrador')
      // Nao devolve token: a sessao continua sendo a mesma.
      expect(res.body.dados).not.toHaveProperty('token')
    })

    // O `administrador` do token e do momento do login e envelhece igual ao
    // perfil, entao a resposta sai do BANCO, nunca do proprio token.
    it('should read administrador from the database, not from the token', async () => {
      const tokenMentiroso = generateToken({
        id: 2,
        uuid: USER_UUID,
        administrador: true
      })

      const res = await request(app)
        .get('/api/login/sessao')
        .set('Authorization', tokenMentiroso)

      expect(res.status).toBe(200)
      expect(res.body.dados.administrador).toBe(false)
    })
  })

  describe('Validation middleware', () => {
    it('should reject requests with invalid body schema', async () => {
      const res = await request(app)
        .delete('/api/produtos/produto')
        .set('Authorization', generateAdminToken())
        .send({ produto_ids: 'not-an-array' })
      expect(res.status).toBe(400)
    })

    it('should reject requests with invalid params', async () => {
      const res = await request(app)
        .get('/api/acervo/produto/not-a-number')
        .set('Authorization', generateAdminToken())
      expect(res.status).toBe(400)
    })
  })
})
