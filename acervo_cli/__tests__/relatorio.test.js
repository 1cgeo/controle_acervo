'use strict'

// A escolha da lista em `acervo finalizados`.
//
// A rota `/api/integracao/acervo/produtos_finalizados` devolve DOIS arrays no
// mesmo objeto: `resumo` (agregado por escala e tipo) e `produtos` (uma linha
// por versao). O verbo pegava "o primeiro array que vier", e `resumo` vem antes:
// a tela mostrava o agregado sob o titulo "Produtos finalizados".
//
// O caso `resumo antes de produtos` REPROVA aquele estado: com a heuristica
// antiga ele devolvia a linha de resumo.

const { test } = require('node:test')
const assert = require('node:assert')

const { listaDeProdutos } = require('../comandos/relatorio')

// A forma real da resposta, na ordem real das chaves (medida em 06/08/2026
// contra a copia local do banco de producao, ano 2024: 12 resumos, 157
// produtos).
const RESPOSTA = {
  ano: 2024,
  mes: 12,
  cumulativo: true,
  total: 157,
  resumo: [
    { tipo_produto: 'Carta Topográfica', escala: '1:50.000', quantidade: 23 }
  ],
  produtos: [
    { mi: '2927-2-SE', nome: 'Coudelaria de Rincão', versao: '1-DSG' },
    { mi: '2857-2', nome: 'São José dos Pinhais', versao: '1-DSG' }
  ]
}

test('pega `produtos`, e nao o `resumo` que vem antes dele', () => {
  const lista = listaDeProdutos(RESPOSTA)

  assert.strictEqual(lista.length, 2)
  // A assercao que reprova o estado anterior: `quantidade` so existe no resumo.
  assert.ok(!('quantidade' in lista[0]), 'pegou o resumo no lugar dos produtos')
  assert.strictEqual(lista[0].mi, '2927-2-SE')
})

test('aceita array na raiz, se a rota um dia devolver so a lista', () => {
  assert.deepStrictEqual(listaDeProdutos([{ mi: 'X' }]), [{ mi: 'X' }])
})

test('sem `produtos` devolve vazio, e nao o primeiro array que aparecer', () => {
  assert.deepStrictEqual(listaDeProdutos({ resumo: [{ quantidade: 1 }] }), [])
  assert.deepStrictEqual(listaDeProdutos(null), [])
})
