'use strict'

// O `Content-Type` DA MÍDIA DE CAMPO NÃO SAI DO BANCO SEM CONFERÊNCIA.
//
// `GET /api/campo/imagem/:id/arquivo` é o único lugar do módulo que devolve
// bytes crus, e até 2026-09-05 ele declarava o `mime_type` da linha tal como ele
// estava lá. O campo vinha do CORPO do pedido (`Joi.string().max(100)`), então
// um operador do módulo `pit` podia gravar `text/html` com os bytes de uma
// página e recebê-la de volta EXECUTÁVEL na origem da própria aplicação: o CSP
// está desligado por decisão (`server/app.js`, "aplicação de intranet") e o
// `nosniff` do helmet impede ADIVINHAR o tipo, não impede honrar o declarado.
//
// SÃO DUAS PORTAS, e por isso duas guardas. O schema fecha a ENTRADA, e a lista
// de permitidos na SAÍDA existe para as linhas que entraram por outra: as 143
// imagens do dump do SAP, cujo tipo a carga adivinha pelo número mágico
// (`scripts/carregar_campo_sap.py`). Fechar só o Joi deixaria essas de pé.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../login', () => require('../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../helpers/orcamento/testApp')
const { campoRoute } = require('../../campo')

const app = buildTestApp([{ path: '/campo', router: campoRoute }])

beforeEach(() => mockDb.reset())

const linha = mimeType => ({
  id: 9,
  tipo: 'foto',
  mime_type: mimeType,
  conteudo: Buffer.from('bytes da foto')
})

describe('GET /campo/imagem/:imagemId/arquivo', () => {
  test('o tipo PERMITIDO sai como está', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(linha('image/jpeg'))

    const res = await request(app).get('/campo/imagem/9/arquivo')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/jpeg')
  })

  // A LINHA ANTIGA, que é o motivo de a guarda estar também na saída: ela já
  // está no banco e nenhum Joi a alcança mais.
  test('o tipo FORA da lista vira application/octet-stream', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(linha('text/html'))

    const res = await request(app).get('/campo/imagem/9/arquivo')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/octet-stream')
    expect(res.headers['content-type']).not.toContain('text/html')
  })

  // 133 das 143 imagens do dump do SAP estão sem `mime_type`: elas já caíam
  // neste ramo antes da lista, e continuam caindo.
  test('o tipo NULO continua no genérico', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(linha(null))

    const res = await request(app).get('/campo/imagem/9/arquivo')

    expect(res.headers['content-type']).toContain('application/octet-stream')
  })

  test('404 quando a imagem não existe', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    const res = await request(app).get('/campo/imagem/9/arquivo')

    expect(res.status).toBe(404)
  })
})
