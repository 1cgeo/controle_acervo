'use strict'

// Chave desconhecida no CORPO da requisicao (supertest).
//
// Antes, o schemaValidation validava o body com stripUnknown: true, entao um
// campo com nome errado era descartado em silencio: o servidor respondia 200 e
// quem chamou achava que tinha gravado. Agora o corpo RECUSA chave
// desconhecida com 400 dizendo QUAL chave sobrou e, quando o nome se parece
// com um campo declarado, sugerindo o correto.
//
// A unica tolerancia e nomeada: o item de DFD aceita as 7 chaves que o client
// web reenvia por terem vindo do GET (PK, FK, tipo_item do JOIN e as colunas de
// auditoria), declaradas com .strip() em dfd_schema.js. Elas sao descartadas,
// nao aceitas como dado, e o descarte vai para o log do servidor com a rota.
//
// Banco e autenticacao mockados (passthrough admin), como nos demais testes de
// rota. O logger e mockado para provar o registro do descarte.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))
jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))

const request = require('supertest')
const logger = require('../../../utils/logger')
const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { dfdRoute } = require('../../../orcamento/dfd')
const { notaCreditoRoute } = require('../../../orcamento/nota_credito')
// A meta do PIT e rota de PLATAFORMA, e nao do modulo, mas o contrato de chave
// desconhecida vale igual: o router entra daqui.
const { pitRoute } = require('../../../pit')
const { dominioRoute } = require('../../../orcamento/dominio')

// A rota /usuarios do repo de origem nao veio na fusao: o SCA ja tem a sua, e e
// ela que serve os tres modulos. O corpo dela segue a regra do schemaValidation
// do SCA (descarta e avisa), coberta por __tests__/unit/utils/schema_validation.
const app = buildTestApp([
  { path: '/dfd', router: dfdRoute },
  { path: '/notas_credito', router: notaCreditoRoute },
  { path: '/metas', router: pitRoute },
  { path: '/dominio', router: dominioRoute }
])

beforeEach(() => {
  mockDb.reset()
  logger.warn.mockClear()
})

const dfdValido = {
  numero: 'DFD-001',
  ano: 2026,
  objeto: 'Aquisicao'
}

// Nao deve ter sobrado nada para o controller: a validacao barra antes.
const esperaRecusa = (res, trecho) => {
  expect(res.status).toBe(400)
  expect(res.body.success).toBe(false)
  expect(res.body.message).toContain(trecho)
  expect(mockDb.conn.one).not.toHaveBeenCalled()
  expect(mockDb.conn.none).not.toHaveBeenCalled()
}

describe('Corpo com chave desconhecida e recusado', () => {
  test('POST /dfd com campo desconhecido vira 400 citando a chave', async () => {
    const res = await request(app)
      .post('/dfd')
      .send({ ...dfdValido, campo_que_nao_existe: 'x' })
    esperaRecusa(res, 'campo desconhecido "campo_que_nao_existe"')
  })

  test('POST /dfd com erro de digitacao sugere a chave mais parecida', async () => {
    const res = await request(app)
      .post('/dfd')
      .send({ numero: 'DFD-001', ano: 2026, objetoo: 'Aquisicao' })
    esperaRecusa(res, 'campo desconhecido "objetoo"')
    expect(res.body.message).toContain('Você quis dizer "objeto"?')
  })

  test('POST /dfd com chave sem nenhuma semelhanca nao inventa sugestao', async () => {
    const res = await request(app)
      .post('/dfd')
      .send({ ...dfdValido, xyzabcdefgh: 1 })
    esperaRecusa(res, 'campo desconhecido "xyzabcdefgh"')
    expect(res.body.message).not.toContain('Você quis dizer')
  })

  test('a recusa nao e so do DFD: POST /notas_credito tambem barra', async () => {
    const res = await request(app).post('/notas_credito').send({
      numero: 'NC-001',
      ano: 2026,
      cod_nd: '339030',
      valor_nc: 1000,
      classificacao_id: 2,
      valor_nc_extra: 50
    })
    esperaRecusa(res, 'campo desconhecido "valor_nc_extra"')
  })

  test('POST /metas com chave desconhecida barra antes de tocar o banco', async () => {
    const res = await request(app)
      .post('/metas')
      .send({ ano: 2026, descricao: 'Meta A', descricaao: 'duplicada' })
    esperaRecusa(res, 'campo desconhecido "descricaao"')
    expect(res.body.message).toContain('Você quis dizer "descricao"?')
  })

  test('chave desconhecida DENTRO do item de DFD tambem e recusada', async () => {
    // O item tolera as chaves de eco do client, mas nao um nome errado: e
    // justamente o caso que o strip silencioso escondia.
    const res = await request(app)
      .post('/dfd')
      .send({
        ...dfdValido,
        itens: [{ tipo_item_id: 1, descrciao: 'Item A' }]
      })
    esperaRecusa(res, 'campo desconhecido "itens[0].descrciao"')
    expect(res.body.message).toContain('Você quis dizer "descricao"?')
  })

  test('corpo valido continua passando', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 42 })
    const res = await request(app)
      .post('/dfd')
      .send({
        ...dfdValido,
        itens: [{ tipo_item_id: 1, descricao: 'Item A', valor_total: 100 }]
      })
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

// A tolerancia foi concedida ao CLIENT WEB, nao a todo consumidor. O
// orcamento_cli manda campo a mais em PUT /dominio/<sub>/<code>: reenvia o
// `code` que a rota ja tira do path. A recusa foi MANTIDA de proposito, e este
// teste fixa a escolha. O client WEB ja acerta (o dialog de dominio omite o
// code no update), entao o conserto cabe ao CLI, nao ao servidor. O 400 nomeia
// a chave sobrando, que e a informacao que o operador precisa.
//
// O caso irmao, PUT /usuarios/:uuid, saiu deste arquivo na fusao: a rota de
// usuarios do SCA e que passou a valer, e ela segue o schemaValidation do SCA.
describe('Recusa mantida onde so o CLI manda campo a mais', () => {
  test('PUT /dominio/natureza_despesa/:code recusa o code repetido no corpo', async () => {
    const res = await request(app)
      .put('/dominio/natureza_despesa/339030')
      .send({ code: '339030', nome: 'Material de consumo', gnd: 3 })
    esperaRecusa(res, 'campo desconhecido "code"')
  })
})

describe('Eco do client no item de DFD: descartado, nao recusado, e registrado', () => {
  // Reproduz o que o dialog do client manda no PUT: os itens vieram de
  // GET /dfd/:id e voltam inteiros, com as colunas que o servidor nao aceita.
  const itemComoVeioDoGet = {
    id: 7,
    dfd_id: 42,
    tipo_item_id: 1,
    tipo_item: 'Material',
    cod_catmat_catser: '123',
    descricao: 'Item A',
    quantidade: 2,
    valor_unitario: 50,
    valor_total: 100,
    data_cadastramento: '2026-07-01T00:00:00.000Z',
    usuario_cadastramento_uuid: 'uuid-1',
    data_modificacao: '2026-07-02T00:00:00.000Z',
    usuario_modificacao_uuid: 'uuid-2'
  }

  test('PUT /dfd/:id com o item inteiro do GET continua funcionando', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 42 }) // DFD existe
    mockDb.conn.one.mockResolvedValueOnce({ id: 42 }) // UPDATE

    const res = await request(app)
      .put('/dfd/42')
      .send({ ...dfdValido, itens: [itemComoVeioDoGet] })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('o descarte e registrado no log com a rota e as chaves', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 42 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 42 })

    await request(app)
      .put('/dfd/42')
      .send({ ...dfdValido, itens: [itemComoVeioDoGet] })

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [mensagem, meta] = logger.warn.mock.calls[0]
    expect(mensagem).toContain('descartados')
    expect(meta.rota).toBe('PUT /dfd/42')
    expect(meta.chaves).toEqual(
      expect.arrayContaining([
        'itens[0].id',
        'itens[0].dfd_id',
        'itens[0].tipo_item',
        'itens[0].data_cadastramento',
        'itens[0].usuario_cadastramento_uuid',
        'itens[0].data_modificacao',
        'itens[0].usuario_modificacao_uuid'
      ])
    )
    expect(meta.chaves).toHaveLength(7)
  })
})
