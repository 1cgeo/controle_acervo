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

    // Sem espera: o `generateExpiredToken` assina com `expiresIn: '0s'`, ou
    // seja `exp === iat`, e ja nasce vencido. O `setTimeout` de 1,1 s que havia
    // aqui era relogio parado na suite, e o caso 'rejeita token expirado tambem
    // no endpoint de admin' ja provava isso sem esperar nada.
    it('should reject expired tokens', async () => {
      const res = await request(app)
        .get('/api/acervo/camadas_produto')
        .set('Authorization', generateExpiredToken())
      expect(res.status).toBe(401)
    })

    // 200, e nao `not.toBe(401)`. Este arquivo roda no pacote de banco, entao o
    // PostgreSQL existe e a rota RESPONDE: aceitar qualquer coisa que nao seja
    // 401 deixava passar o 500 de excecao nao tratada.
    it.each([
      ['admin', () => generateAdminToken()],
      ['usuario', () => generateUserToken()],
      // O prefixo Bearer e outro ramo do parser do cabecalho, e nao outro token.
      ['admin com prefixo Bearer', () => `Bearer ${generateAdminToken()}`]
    ])('aceita o token de %s', async (_quem, token) => {
      const res = await request(app)
        .get('/api/acervo/camadas_produto')
        .set('Authorization', token())
      expect(res.status).toBe(200)
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

    // A instituicao entrou na foto em 2026-08-09, para o client DESENHAR com o
    // nome do Centro em vez de o ter escrito no codigo. Vem aqui, e nao numa
    // chamada propria, pelo mesmo motivo de `modulos`.
    //
    // `toHaveProperty`, e nao o valor: o nome depende do que o banco de teste
    // semeou, e fixar '1º CGEO' aqui recriaria em teste o defeito que a mudanca
    // conserta. O que se cobra e o CONTRATO -- o campo existe, e traz nome e
    // sigla quando ha linha.
    it('leva a instituicao desta instalacao junto da foto', async () => {
      const res = await request(app)
        .get('/api/login/sessao')
        .set('Authorization', generateUserToken())

      expect(res.status).toBe(200)
      expect(res.body.dados).toHaveProperty('instituicao')

      if (res.body.dados.instituicao) {
        expect(res.body.dados.instituicao).toHaveProperty('nome')
        expect(res.body.dados.instituicao).toHaveProperty('sigla')
        // Nem `ug_code` nem rastro: quem precisa deles e a TELA de edicao, que
        // le GET /api/instituicao.
        expect(res.body.dados.instituicao).not.toHaveProperty('ug_code')
      }
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
