'use strict'

// PUT /pedido/:id/situacao: mudar SO a situacao, sem reescrever o pedido.
//
// POR QUE A ROTA EXISTE, e e o que o primeiro bloco de casos guarda. O
// PUT /pedido substitui a LINHA INTEIRA: o ColumnSet de PEDIDO_COLS declara
// `def: null`, entao campo que o corpo nao traz vai a null, com 200 e sem aviso.
// A lista de pedidos (GET /pedido) nao devolve nove campos que o pedido tem
// (ponto_contato, contato_mapoteca, endereco_entrega, canal_recebimento_id,
// municipio, qtd_imagens, observacao, observacao_interna, motivo_cancelamento),
// e tres deles estavam preenchidos na maioria das linhas de producao em
// 2026-08-24: observacao_interna em 131 de 190 pedidos, observacao em 108,
// ponto_contato em 106.
//
// O caso 'o PUT completo montado com o que a LISTA tem apaga' REPROVA o caminho
// que a tela nao tomou. Sem ele, o teste de preservacao passaria mesmo se a
// rota nova nao fizesse nada de diferente do PUT antigo.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const {
  generateAdminToken, generateUserToken, USER_UUID
} = require('../helpers/auth')
const { SITUACAO_PEDIDO } = require('../../utils/domain_constants')

const MODULO = { mapoteca: 2 }
const NIVEL = { consulta: 1, operador: 2, gerente: 3 }

let app

beforeAll(async () => {
  app = await getApp()
})

// A concessao de perfil se desfaz nos DOIS lados, pelo motivo do
// campo_perfil.test.js: `cleanTestData` nao apaga o perfil de quem esta na
// semente, e a linha de mapoteca vazaria para o arquivo seguinte do worker.
const semPerfilNaMapoteca = () =>
  conn.none(
    `DELETE FROM dgeo.usuario_perfil
      WHERE modulo_id = $2 AND usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
    [USER_UUID, MODULO.mapoteca]
  )

beforeEach(semPerfilNaMapoteca)

afterEach(async () => {
  await semPerfilNaMapoteca()
  await cleanTestData()
})

const daPerfil = (nivel) =>
  conn.none(
    `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
     SELECT id, $2, $3 FROM dgeo.usuario WHERE uuid = $1
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
    [USER_UUID, MODULO.mapoteca, nivel]
  )

// --- Cenario ----------------------------------------------------------------

const criaCliente = async (nome = 'OM da Situacao') => {
  const res = await request(app)
    .post('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
    .send({ nome, tipo_cliente_id: 1 })
  expect(res.status).toBe(201)
  const linha = await conn.one(
    'SELECT id FROM mapoteca.cliente WHERE nome = $1 ORDER BY id DESC LIMIT 1',
    [nome]
  )
  return Number(linha.id)
}

// OS NOVE CAMPOS QUE A LISTA NAO DEVOLVE, todos preenchidos de proposito: e o
// conjunto inteiro que a conferencia cobre, e nao uma amostra de tres.
const CAMPOS_FORA_DA_LISTA = {
  ponto_contato: 'Cap MASSACANI, (55) 99999-0000',
  contato_mapoteca: 'Sgt da mapoteca, ramal 1234',
  endereco_entrega: 'Rua do Quartel, 100',
  canal_recebimento_id: 1,
  municipio: 'Santa Maria',
  qtd_imagens: 12,
  observacao: 'Entregar junto do lote do exercicio',
  observacao_interna: 'Conferir a folha 2962-4 antes de imprimir',
  motivo_cancelamento: 'motivo herdado de um cancelamento anterior'
}

const criaPedido = async (overrides = {}) => {
  const clienteId = await criaCliente()
  const res = await request(app)
    .post('/api/mapoteca/pedido')
    .set('Authorization', generateAdminToken())
    .send({
      data_pedido: '2026-03-10',
      cliente_id: clienteId,
      situacao_pedido_id: SITUACAO_PEDIDO.EM_ANDAMENTO,
      documento_solicitacao: 'DIEx 1234',
      ...CAMPOS_FORA_DA_LISTA,
      ...overrides
    })
  expect(res.status).toBe(201)
  return { id: Number(res.body.dados.id), clienteId }
}

/**
 * A linha gravada, com as datas ja em texto: comparar contra o Date que o
 * driver monta esconderia justamente o D-1 que estes casos procuram.
 */
const linhaDoPedido = (id) => conn.one(
  `SELECT *,
          to_char(data_pedido, 'YYYY-MM-DD') AS data_pedido_iso,
          to_char(data_atendimento, 'YYYY-MM-DD') AS data_atendimento_iso
     FROM mapoteca.pedido WHERE id = $1`,
  [id]
)

const mudaSituacao = (id, corpo, token = generateAdminToken()) => request(app)
  .put(`/api/mapoteca/pedido/${id}/situacao`)
  .set('Authorization', token)
  .send(corpo)

describe('PUT /pedido/:id/situacao - o pedido nao perde campo', () => {
  it('muda a situacao e preserva os NOVE campos que a lista nao devolve', async () => {
    const { id } = await criaPedido()

    const res = await mudaSituacao(id, {
      situacao_pedido_id: SITUACAO_PEDIDO.AGUARDANDO_ENVIO
    })
    expect(res.status).toBe(200)

    // Leitura INDEPENDENTE, no banco, e nao o eco do 200 acima.
    const linha = await linhaDoPedido(id)
    expect(linha.situacao_pedido_id).toBe(SITUACAO_PEDIDO.AGUARDANDO_ENVIO)
    for (const [campo, valor] of Object.entries(CAMPOS_FORA_DA_LISTA)) {
      expect({ [campo]: linha[campo] }).toEqual({ [campo]: valor })
    }
  })

  it('o PUT completo montado com o que a LISTA tem apaga esses campos', async () => {
    const { id, clienteId } = await criaPedido()

    // O corpo que a tela conseguiria montar SEM ler o detalhe: e exatamente o
    // que a lista devolve. E o caminho que a rota nova existe para evitar.
    const res = await request(app)
      .put('/api/mapoteca/pedido')
      .set('Authorization', generateAdminToken())
      .send({
        id,
        data_pedido: '2026-03-10',
        cliente_id: clienteId,
        situacao_pedido_id: SITUACAO_PEDIDO.AGUARDANDO_ENVIO,
        documento_solicitacao: 'DIEx 1234'
      })
    expect(res.status).toBe(200)

    const linha = await linhaDoPedido(id)
    expect(linha.situacao_pedido_id).toBe(SITUACAO_PEDIDO.AGUARDANDO_ENVIO)
    // Os nove viraram null, e o teste guarda o dano inteiro em vez de um
    // exemplo: e ele que mede o tamanho do problema.
    const apagados = Object.keys(CAMPOS_FORA_DA_LISTA)
      .filter(campo => linha[campo] === null)
    expect(apagados).toEqual(Object.keys(CAMPOS_FORA_DA_LISTA))
  })
})

describe('PUT /pedido/:id/situacao - RN02 e RN03', () => {
  it('recusa Concluido sem data_atendimento', async () => {
    const { id } = await criaPedido()

    const res = await mudaSituacao(id, {
      situacao_pedido_id: SITUACAO_PEDIDO.CONCLUIDO
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('data_atendimento')

    const linha = await linhaDoPedido(id)
    expect(linha.situacao_pedido_id).toBe(SITUACAO_PEDIDO.EM_ANDAMENTO)
  })

  it('aceita Concluido com data_atendimento, e grava o DIA que veio', async () => {
    const { id } = await criaPedido()

    const res = await mudaSituacao(id, {
      situacao_pedido_id: SITUACAO_PEDIDO.CONCLUIDO,
      data_atendimento: '2026-03-20'
    })
    expect(res.status).toBe(200)

    const linha = await linhaDoPedido(id)
    expect(linha.situacao_pedido_id).toBe(SITUACAO_PEDIDO.CONCLUIDO)
    // O dia EXATO, e nao o anterior: e o D-1 de UTC-3 que este caso procura.
    expect(linha.data_atendimento_iso).toBe('2026-03-20')
  })

  it('recusa data_atendimento anterior a data do pedido', async () => {
    const { id } = await criaPedido()

    const res = await mudaSituacao(id, {
      situacao_pedido_id: SITUACAO_PEDIDO.CONCLUIDO,
      data_atendimento: '2026-03-09'
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('anterior')
  })

  it('recusa Cancelado sem motivo_cancelamento', async () => {
    // O pedido nasce SEM motivo aqui: com o motivo herdado da fixtura, a
    // ausencia da chave no corpo passaria e o caso nao provaria a RN03.
    const { id } = await criaPedido({ motivo_cancelamento: null })

    const res = await mudaSituacao(id, {
      situacao_pedido_id: SITUACAO_PEDIDO.CANCELADO
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('motivo_cancelamento')
  })

  it('aceita Cancelado com motivo', async () => {
    const { id } = await criaPedido({ motivo_cancelamento: null })

    const res = await mudaSituacao(id, {
      situacao_pedido_id: SITUACAO_PEDIDO.CANCELADO,
      motivo_cancelamento: 'O solicitante desistiu do exercicio'
    })
    expect(res.status).toBe(200)

    const linha = await linhaDoPedido(id)
    expect(linha.situacao_pedido_id).toBe(SITUACAO_PEDIDO.CANCELADO)
    expect(linha.motivo_cancelamento).toBe('O solicitante desistiu do exercicio')
  })
})

describe('PUT /pedido/:id/situacao - chave ausente nao mexe', () => {
  it('sair de Concluido preserva a data de atendimento gravada', async () => {
    const { id } = await criaPedido({
      situacao_pedido_id: SITUACAO_PEDIDO.CONCLUIDO,
      data_atendimento: '2026-03-15'
    })

    const res = await mudaSituacao(id, {
      situacao_pedido_id: SITUACAO_PEDIDO.EM_ANDAMENTO
    })
    expect(res.status).toBe(200)

    const linha = await linhaDoPedido(id)
    expect(linha.situacao_pedido_id).toBe(SITUACAO_PEDIDO.EM_ANDAMENTO)
    // O material saiu naquele dia, e a data e registro do que aconteceu.
    expect(linha.data_atendimento_iso).toBe('2026-03-15')
  })

  it('null explicito limpa a data de atendimento', async () => {
    const { id } = await criaPedido({
      situacao_pedido_id: SITUACAO_PEDIDO.CONCLUIDO,
      data_atendimento: '2026-03-15'
    })

    const res = await mudaSituacao(id, {
      situacao_pedido_id: SITUACAO_PEDIDO.EM_ANDAMENTO,
      data_atendimento: null
    })
    expect(res.status).toBe(200)

    const linha = await linhaDoPedido(id)
    expect(linha.data_atendimento).toBeNull()
  })
})

describe('PUT /pedido/:id/situacao - recusas e rastro', () => {
  it('recusa code fora do dominio', async () => {
    const { id } = await criaPedido()

    const res = await mudaSituacao(id, { situacao_pedido_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('situacao_pedido_id')

    const linha = await linhaDoPedido(id)
    expect(linha.situacao_pedido_id).toBe(SITUACAO_PEDIDO.EM_ANDAMENTO)
  })

  it('devolve 404 para pedido inexistente', async () => {
    const res = await mudaSituacao(999999, {
      situacao_pedido_id: SITUACAO_PEDIDO.REMETIDO
    })
    expect(res.status).toBe(404)
  })

  it('registra o evento de auditoria com a situacao nova', async () => {
    const { id } = await criaPedido()

    expect((await mudaSituacao(id, {
      situacao_pedido_id: SITUACAO_PEDIDO.REMETIDO
    })).status).toBe(200)

    const evento = await conn.one(
      `SELECT dados_antes, dados_depois FROM auditoria.evento
        WHERE tabela = 'mapoteca.pedido' AND operacao = 'U' AND registro_id = $1
        ORDER BY id DESC LIMIT 1`,
      [String(id)]
    )
    expect(Number(evento.dados_antes.situacao_pedido_id))
      .toBe(SITUACAO_PEDIDO.EM_ANDAMENTO)
    expect(Number(evento.dados_depois.situacao_pedido_id))
      .toBe(SITUACAO_PEDIDO.REMETIDO)
    // O `antes` e a linha do banco, e nao o corpo: as colunas que o corpo nem
    // cita tem de estar la.
    expect(evento.dados_antes.observacao_interna)
      .toBe(CAMPOS_FORA_DA_LISTA.observacao_interna)
  })
})

describe('PUT /pedido/:id/situacao - perfil', () => {
  it('operador da mapoteca nao muda a situacao', async () => {
    const { id } = await criaPedido()
    await daPerfil(NIVEL.operador)

    const res = await mudaSituacao(
      id,
      { situacao_pedido_id: SITUACAO_PEDIDO.REMETIDO },
      generateUserToken()
    )
    expect(res.status).toBe(403)

    const linha = await linhaDoPedido(id)
    expect(linha.situacao_pedido_id).toBe(SITUACAO_PEDIDO.EM_ANDAMENTO)
  })

  it('gerente da mapoteca muda', async () => {
    const { id } = await criaPedido()
    await daPerfil(NIVEL.gerente)

    const res = await mudaSituacao(
      id,
      { situacao_pedido_id: SITUACAO_PEDIDO.REMETIDO },
      generateUserToken()
    )
    expect(res.status).toBe(200)

    const linha = await linhaDoPedido(id)
    expect(linha.situacao_pedido_id).toBe(SITUACAO_PEDIDO.REMETIDO)
  })
})
