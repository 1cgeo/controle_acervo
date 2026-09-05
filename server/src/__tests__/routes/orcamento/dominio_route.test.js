'use strict'

// Teste de rota (supertest) dos dominios. Os GET exigem perfil de consulta, e
// nao sao publicos, entao aqui se mocka o ../../login junto com o banco.
//
// A GUARDA EM SI NAO SE PROVA AQUI: com o login dublado, `verifyPerfil` vira
// passagem livre. Quem a prova e routes/orcamento/verify_perfil.test.js, contra
// o middleware de verdade, e modulo_em_toda_rota.test.js, lendo o fonte.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { dominioRoute } = require('../../../orcamento/dominio')

const app = buildTestApp([{ path: '/dominio', router: dominioRoute }])

beforeEach(() => mockDb.reset())

describe('GET /dominio', () => {
  test('natureza_despesa retorna 200 com dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([
      { code: 1, nome: 'Material de consumo', gnd: 3, grupo: 'Custeio' }
    ])
    const res = await request(app).get('/dominio/natureza_despesa')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(1)
  })

  test('tipo_licitacao retorna 200 com dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([
      { code: 1, nome: 'GCALC DSG' },
      { code: 2, nome: 'Propria' }
    ])
    const res = await request(app).get('/dominio/tipo_licitacao')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(2)
  })

  test('tipo_item_dfd retorna 200 com dados', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ code: 1, nome: 'Material' }])
    const res = await request(app).get('/dominio/tipo_item_dfd')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toHaveLength(1)
  })
})

// O `em_uso` E A PROMESSA DA TELA: ela avisa ANTES do clique, em vez de deixar a
// pessoa confirmar "esta ação não pode ser desfeita" para so entao levar o 409
// do `tratarDeletar`. A promessa so vale se a contagem cobrir TODAS as chaves
// estrangeiras que o DDL declara, e duas ficaram para tras:
// `nota_credito_recolhimento` (ND e UG, desde a 1.40.0) e `dgeo.instituicao`
// (UG, desde a 1.51.0). Uma UG que so emitiu documento de recolhimento aparecia
// como "em uso: 0", e excluir levava 409.
//
// A VARREDURA E DO SQL, e nao do numero: com o banco dublado, um `em_uso`
// inventado no duble passaria em qualquer assercao sobre o resultado. O que se
// prende aqui e a consulta citar cada tabela que aponta o catalogo.
describe('em_uso conta TODAS as chaves estrangeiras do catalogo', () => {
  const sqlDa = async caminho => {
    mockDb.conn.any.mockResolvedValueOnce([])
    await request(app).get(caminho)
    return String(mockDb.conn.any.mock.calls[0][0])
  }

  test('natureza_despesa soma NC, item do PDR e recolhimento', async () => {
    const sql = await sqlDa('/dominio/natureza_despesa')
    expect(sql).toContain('orcamento.nota_credito WHERE cod_nd')
    expect(sql).toContain('orcamento.pdr_item WHERE cod_nd')
    expect(sql).toContain('orcamento.nota_credito_recolhimento')
  })

  test('ug soma NC, recolhimento e a instituicao', async () => {
    const sql = await sqlDa('/dominio/ug')
    expect(sql).toContain('orcamento.nota_credito')
    expect(sql).toContain('orcamento.nota_credito_recolhimento')
    expect(sql).toContain('dgeo.instituicao')
  })

  // O CONTROLE: `plano_interno` tem UMA chave estrangeira so, e acrescentar
  // tabela ali seria contar o que nao aponta para ele.
  test('plano_interno conta so a NC, que e a unica que o aponta', async () => {
    const sql = await sqlDa('/dominio/plano_interno')
    expect(sql).toContain('orcamento.nota_credito')
    expect(sql).not.toContain('nota_credito_recolhimento')
  })
})
