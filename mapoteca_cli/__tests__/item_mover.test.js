'use strict'

// Testes com node:test (embutido no Node), nao jest: ver args.test.js.
//   Rodar: cd mapoteca_cli && npm test
//
// O que estes testes trancam
// --------------------------
// `mapoteca item mover` remonta a linha do item a partir da leitura, porque o
// `PUT /mapoteca/produto_pedido` vai na COLECAO e SUBSTITUI a linha inteira.
// Ao remontar, ele copiava TODA chave presente na leitura, inclusive as de
// valor null.
//
// Isso quebrava o item do ACERVO. O `produtoPedidoAtualizacao` tem
// `.xor('uuid_versao', 'nome_avulso')`, e o Joi conta chave presente com valor
// null como PREENCHIDA. Um item de acervo chega do GET com `uuid_versao`
// preenchido e `nome_avulso: null`, entao o corpo remontado levava as duas e a
// validacao local reprovava com "contains a conflict between exclusive peers".
// Medido em producao em 2026-08-25, nos itens 1920 e 1921 do pedido 132.
//
// O item AVULSO nunca sentiu o defeito (uuid nulo, nome preenchido), o que
// explica o verbo ter nascido e passado. Por isso os dois casos estao aqui.

const { test } = require('node:test')
const assert = require('node:assert')

const http = require('../lib/http')
const { VERBOS } = require('../comandos/pedido')

const DE = 132
const PARA = 157

// Recorte do item como o GET /mapoteca/pedido/:id o devolve dentro de
// `produtos`: a linha inteira, com as colunas vazias presentes e nulas.
function itemAcervo (extra) {
  return Object.assign({
    id: 1920,
    pedido_id: DE,
    uuid_versao: '39e010ac-270e-49f8-abdb-ace9ea3b5b99',
    nome_avulso: null,
    descricao_avulso: null,
    quantidade: 2,
    tipo_midia_id: 6,
    tipo_midia_fornecida_id: 6,
    observacao: null,
    producao_especifica: false,
    meta_pit_id: null,
    produto_nome: 'Aeródromo de Saicã (Mosaico Orto 1:10.000)',
    mi: null
  }, extra || {})
}

function itemAvulso (extra) {
  return Object.assign({
    id: 2633,
    pedido_id: DE,
    uuid_versao: null,
    nome_avulso: 'Aeródromo de Saicã 1: 10.000',
    descricao_avulso: 'Aeródromo de Saicã 1: 10.000',
    quantidade: 2,
    tipo_midia_id: 6,
    tipo_midia_fornecida_id: 6,
    observacao: null,
    producao_especifica: false,
    meta_pit_id: null,
    produto_nome: null,
    mi: null
  }, extra || {})
}

function pedido (id, produtos) {
  return { id, documento_solicitacao: `DIEx do ${id}`, produtos }
}

/**
 * Substitui a rede. O GET devolve a origem ou o destino conforme o caminho, e
 * toda escrita fica registrada. A conferencia final do verbo torna a ler os
 * dois, entao o stub responde sempre.
 */
function comServidor (itensOrigem, fn) {
  const original = http.autenticada
  const originalPausa = http.pausa
  const escritas = []

  http.pausa = async () => {}
  http.autenticada = async (cfg, metodo, caminho, opcoes = {}) => {
    if (metodo === 'GET') {
      const id = Number(String(caminho).split('/').pop())
      return { dados: pedido(id, id === DE ? itensOrigem : []) }
    }
    escritas.push({ metodo, caminho, corpo: opcoes.corpo })
    return { message: 'Item atualizado com sucesso' }
  }

  return fn(escritas).finally(() => {
    http.autenticada = original
    http.pausa = originalPausa
  })
}

test('item do ACERVO: o corpo remontado nao leva nome_avulso nulo (o xor do Joi)', async () => {
  await comServidor([itemAcervo()], async escritas => {
    await VERBOS.mover({
      _: ['item', 'mover'],
      flags: { de: String(DE), para: String(PARA), ids: '1920' }
    }, {})

    assert.strictEqual(escritas.length, 1, 'era para gravar um item')
    const corpo = escritas[0].corpo
    assert.strictEqual(corpo.pedido_id, PARA)
    assert.strictEqual(corpo.id, 1920)
    assert.strictEqual(corpo.uuid_versao, '39e010ac-270e-49f8-abdb-ace9ea3b5b99')
    assert.ok(!('nome_avulso' in corpo), 'nome_avulso nulo nao pode entrar no corpo')
    assert.ok(!('descricao_avulso' in corpo), 'descricao_avulso nula nao pode entrar no corpo')
  })
})

test('item AVULSO: o corpo remontado nao leva uuid_versao nulo, e mantem o nome', async () => {
  await comServidor([itemAvulso()], async escritas => {
    await VERBOS.mover({
      _: ['item', 'mover'],
      flags: { de: String(DE), para: String(PARA), ids: '2633' }
    }, {})

    assert.strictEqual(escritas.length, 1)
    const corpo = escritas[0].corpo
    assert.strictEqual(corpo.pedido_id, PARA)
    assert.strictEqual(corpo.nome_avulso, 'Aeródromo de Saicã 1: 10.000')
    assert.ok(!('uuid_versao' in corpo), 'uuid_versao nulo nao pode entrar no corpo')
  })
})

test('o que tem valor sobrevive a remontagem', async () => {
  const item = itemAcervo({ observacao: 'linha 2 do DIEx, conferida', quantidade: 7 })
  await comServidor([item], async escritas => {
    await VERBOS.mover({
      _: ['item', 'mover'],
      flags: { de: String(DE), para: String(PARA), ids: '1920' }
    }, {})

    const corpo = escritas[0].corpo
    assert.strictEqual(corpo.observacao, 'linha 2 do DIEx, conferida')
    assert.strictEqual(corpo.quantidade, 7)
    assert.strictEqual(corpo.tipo_midia_id, 6)
    assert.strictEqual(corpo.producao_especifica, false, 'false nao e nulo, e tem de passar')
  })
})

test('o dry-run continua sem gravar', async () => {
  await comServidor([itemAcervo()], async escritas => {
    await VERBOS.mover({
      _: ['item', 'mover'],
      flags: { de: String(DE), para: String(PARA), ids: '1920', 'dry-run': true }
    }, {})

    assert.strictEqual(escritas.length, 0)
  })
})
