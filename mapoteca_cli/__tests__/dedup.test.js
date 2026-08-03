'use strict'

// Testes com node:test (embutido no Node), nao jest: ver args.test.js.
//   Rodar: cd mapoteca_cli && npm test

const { test } = require('node:test')
const assert = require('node:assert')

const http = require('../lib/http')
const { acharPedidoExistente } = require('../comandos/pedido')

// Um DIEx que encaminha a demanda de varias OM gera um pedido POR CLIENTE, sob
// um NUP so. A base real que originou estes testes: DIEx 7234-E4/Cmdo CMS,
// NUP 64286.011195/2026-94, com tres abas (5a Bda C Bld, 15a Bda Inf Mec, 5a DE).
const NUP = '64286.011195/2026-94'
const DOC = '7234-E4/Cmdo CMS'
const BASE = [
  { id: '161', cliente_id: '4', documento_solicitacao: DOC, documento_solicitacao_nup: NUP },
  { id: '99', cliente_id: '11', documento_solicitacao: '2160-S3/3o RCC', documento_solicitacao_nup: '65259.005084/2026-39' }
]

function comBase (pedidos, fn) {
  const original = http.autenticada
  http.autenticada = async () => ({ dados: pedidos })
  return fn().finally(() => { http.autenticada = original })
}

test('nao casa pedido de OUTRO cliente sob o mesmo NUP', async () => {
  // O modo de falha que este teste tranca: sem o recorte por cliente, o pedido
  // da 15a Bda cairia dentro do da 5a Bda C Bld e os itens das duas OM virariam
  // um pedido so, em silencio.
  const r = await comBase(BASE, () =>
    acharPedidoExistente({}, { documento_solicitacao_nup: NUP, documento_solicitacao: DOC }, 63))
  assert.strictEqual(r, null)
})

test('casa o pedido do MESMO cliente pelo NUP, e nomeia o cliente na chave', async () => {
  const r = await comBase(BASE, () =>
    acharPedidoExistente({}, { documento_solicitacao_nup: NUP, documento_solicitacao: DOC }, 4))
  assert.strictEqual(r.pedido.id, '161')
  assert.match(r.chave, /cliente 4/)
})

test('compara cliente_id como TEXTO (a listagem devolve string)', async () => {
  const r = await comBase(BASE, () =>
    acharPedidoExistente({}, { documento_solicitacao_nup: NUP }, '4'))
  assert.strictEqual(r.pedido.id, '161')
})

test('sem clienteId, mantem o comportamento antigo de casar so pelo documento', async () => {
  const r = await comBase(BASE, () =>
    acharPedidoExistente({}, { documento_solicitacao_nup: NUP }, null))
  assert.strictEqual(r.pedido.id, '161')
  assert.strictEqual(r.chave, `NUP ${NUP}`)
})

test('o numero do documento e a segunda chave, tambem recortada por cliente', async () => {
  const semNup = [{ id: '77', cliente_id: '4', documento_solicitacao: DOC, documento_solicitacao_nup: null }]
  const outro = await comBase(semNup, () =>
    acharPedidoExistente({}, { documento_solicitacao: DOC }, 63))
  assert.strictEqual(outro, null)
  const mesmo = await comBase(semNup, () =>
    acharPedidoExistente({}, { documento_solicitacao: DOC }, 4))
  assert.strictEqual(mesmo.pedido.id, '77')
})

test('sem NUP e sem documento nao ha o que deduplicar', async () => {
  const r = await acharPedidoExistente({}, {}, 4)
  assert.strictEqual(r, null)
})
