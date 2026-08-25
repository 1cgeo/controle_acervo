'use strict'

// O PEDIDO CANCELADO NÃO SOMA (2026-08-25), contra o banco de verdade.
//
// O defeito: as consultas do relatório e do Anuário somavam `quantidade` sem
// olhar a situação, então um pedido cancelado entrava na produção publicada.
// Medido na produção em 2026-08-25: 30 linhas e 60 cópias em 3.203 e 13.177, e
// as três abas do relatório (Mil, META4_DETALHADA e resumo anual) publicavam
// todas as três o número inflado.
//
// O `dashboard_ctrl.js` nunca teve o defeito, porque as dez consultas de
// entrega dele passam pelo `FILTRO_ENTREGUE_ANO`, que só admite Remetido e
// Concluído. O `pit_execucao_ctrl.js` também não, porque já escrevia o filtro
// à mão na Meta 4. A régua saiu de lá para o `query_fragments.js`.
//
// O QUE ESTE ARQUIVO GUARDA
// -------------------------
// 1. Que o cancelado sai das quatro consultas de soma, e não de uma só (a que
//    esquecer volta a inflar em silêncio, e nada quebra).
// 2. Que a coluna "Det.?" da aba Mil continua VERDADEIRA no cancelado. Ela era
//    derivada da mesma CTE que soma, e o conserto a faria dizer "ninguém
//    detalhou" sobre um pedido com 15 itens. Foi reescrita como EXISTS.
// 3. Que o não cancelado continua contando. Sem este par, um filtro que zerasse
//    tudo passaria nos outros testes.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')

const relatorioCtrl = require('../../mapoteca/relatorio_ctrl')
const anuarioCtrl = require('../../mapoteca/anuario_ctrl')

const ANO = 2026
const SITUACAO_CANCELADO = 6
const SITUACAO_CONCLUIDO = 5

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const criaCliente = async (nome) => {
  const res = await request(app)
    .post('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
    .send({ nome, tipo_cliente_id: 1 })
  expect(res.status).toBe(201)
  const lista = await request(app)
    .get('/api/mapoteca/cliente')
    .set('Authorization', generateAdminToken())
  return lista.body.dados.find(c => c.nome === nome).id
}

const criaPedido = async (clienteId, overrides) => {
  const res = await request(app)
    .post('/api/mapoteca/pedido')
    .set('Authorization', generateAdminToken())
    .send({
      data_pedido: '2026-03-10',
      cliente_id: clienteId,
      situacao_pedido_id: SITUACAO_CONCLUIDO,
      data_atendimento: '2026-03-20',
      ...overrides
    })
  expect(res.status).toBe(201)
  return res.body.dados
}

const criaItem = async (pedidoId, nome, quantidade) => {
  const res = await request(app)
    .post('/api/mapoteca/produto_pedido')
    .set('Authorization', generateAdminToken())
    .send({
      nome_avulso: nome,
      pedido_id: pedidoId,
      quantidade,
      tipo_midia_id: 6
    })
  expect(res.status).toBe(201)
}

/**
 * Um par de pedidos com a MESMA forma, separados só pela situação. O par é o
 * teste: o vivo prova que a consulta continua contando, e o cancelado prova que
 * ela parou de contar o que não devia.
 */
const criaPar = async (sufixo, { quantidade = 11 } = {}) => {
  const clienteId = await criaCliente(`OM Cancelado ${sufixo}`)
  const vivo = await criaPedido(clienteId, {})
  const cancelado = await criaPedido(clienteId, {
    situacao_pedido_id: SITUACAO_CANCELADO,
    motivo_cancelamento: 'duplicata, para o teste'
  })
  await criaItem(vivo.id, `Vivo ${sufixo}`, quantidade)
  await criaItem(cancelado.id, `Cancelado ${sufixo}`, quantidade)
  return { clienteId, vivo, cancelado, quantidade }
}

const soma = (linhas, campo) =>
  linhas.reduce((acc, l) => acc + Number(l[campo] || 0), 0)

// ---------------------------------------------------------------------------

describe('As quatro somas do relatório param no cancelado', () => {
  it('aba Mil: o total do ano não carrega a quantidade do cancelado', async () => {
    const { vivo, cancelado, quantidade } = await criaPar('Mil')

    const linhas = await relatorioCtrl.getRelatorioPedidosMil(ANO)
    const doVivo = linhas.find(l => Number(l.pedido_id) === Number(vivo.id))
    const doCancelado = linhas.find(l => Number(l.pedido_id) === Number(cancelado.id))

    expect(doVivo).toBeDefined()
    expect(Number(doVivo.total)).toBe(quantidade)
    // O pedido cancelado continua APARECENDO na aba, que é lista, e some só da
    // soma. Sumir da lista esconderia informação verdadeira.
    expect(doCancelado).toBeDefined()
    expect(Number(doCancelado.total || 0)).toBe(0)
  })

  it('aba Mil: a coluna Det.? continua verdadeira no cancelado COM itens', async () => {
    const { cancelado } = await criaPar('Det')

    const linhas = await relatorioCtrl.getRelatorioPedidosMil(ANO)
    const doCancelado = linhas.find(l => Number(l.pedido_id) === Number(cancelado.id))

    // Este é o caso que o conserto quase quebrou: a coluna era subproduto da
    // CTE que soma, e passaria a dizer que ninguém detalhou um pedido que tem
    // item cadastrado.
    expect(doCancelado.possui_detalhamento).toBe(true)
  })

  it('META4_DETALHADA: o item do cancelado não vira linha', async () => {
    const { vivo, cancelado } = await criaPar('Meta4')

    const linhas = await relatorioCtrl.getRelatorioPedidosDetalhado(ANO)
    const ids = linhas.map(l => Number(l.pedido_id))

    expect(ids).toContain(Number(vivo.id))
    expect(ids).not.toContain(Number(cancelado.id))
  })

  it('resumo anual: a soma de todos os clientes exclui o cancelado', async () => {
    const { quantidade } = await criaPar('Resumo')

    const linhas = await relatorioCtrl.getRelatorioPedidosResumo(ANO)
    expect(soma(linhas, 'total')).toBe(quantidade)
  })

  it('produção temática: o item do cancelado não entra', async () => {
    const { cancelado } = await criaPar('Tematico')

    const linhas = await relatorioCtrl.getRelatorioTematicos(ANO)
    const ids = linhas.map(l => Number(l.pedido_id))
    expect(ids).not.toContain(Number(cancelado.id))
  })
})

describe('O Anuário para no cancelado', () => {
  // O Anuário recorta por `data_atendimento IS NOT NULL`, e na produção de hoje
  // nenhum cancelado tem essa data: o defeito lá é ESTRUTURAL e não numérico.
  // Por isso o pedido deste teste tem data de atendimento de propósito, senão o
  // caso não existe e o teste passa de graça.
  it('itens entregues: o cancelado com data de atendimento não soma', async () => {
    const { quantidade } = await criaPar('Anuario')

    const anuario = await anuarioCtrl.getAnuarioEstatistico({
      ano: ANO,
      mes: 12,
      cumulativo: true
    })

    // A coluna `exercito` do total: os dois pedidos do par são de OM EB, e só
    // o vivo pode contar. Antes do conserto esta soma dava o dobro.
    const totalExercito =
      Number(anuario.total_convencional.exercito || 0) +
      Number(anuario.total_digital.exercito || 0)

    expect(totalExercito).toBe(quantidade)
  })
})

describe('O controle: sem o par, o filtro poderia zerar tudo', () => {
  it('dois pedidos vivos somam os dois', async () => {
    const clienteId = await criaCliente('OM Dois Vivos')
    const a = await criaPedido(clienteId, {})
    const b = await criaPedido(clienteId, {})
    await criaItem(a.id, 'Vivo A', 4)
    await criaItem(b.id, 'Vivo B', 6)

    const linhas = await relatorioCtrl.getRelatorioPedidosResumo(ANO)
    expect(soma(linhas, 'total')).toBe(10)
  })
})
