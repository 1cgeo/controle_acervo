'use strict'

// A saida do sag_cli e a MESMA regra dos outros seis: com `--json` o stdout
// inteiro tem de ser JSON, porque quem le a resposta e o modulo orcamento do
// SAP montando a proxima chamada. O buraco que restava aqui era o registro
// AUSENTE, que saia como a prosa `(vazio)` e quebrava o parse justamente no
// caso mais comum, a consulta que nao achou nada.
//   Rodar: cd sag_cli && node --test

const { test } = require('node:test')
const assert = require('node:assert')

const saida = require('../lib/saida')

test('registro ausente com --json sai como null, e nao como (vazio)', () => {
  assert.strictEqual(JSON.parse(saida.registro(null, { formato: 'json' })), null)
  assert.strictEqual(JSON.parse(saida.registro(undefined, { formato: 'json' })), null)
  // Sem --json a resposta legivel nao muda.
  assert.strictEqual(saida.registro(null, {}), '(vazio)')
})

test('registro presente com --json continua sendo JSON completo', () => {
  const voltou = JSON.parse(saida.registro(
    { NUMERO_NC: '2026NC000123', VALOR_NC: 1500.5, OBS: null },
    { formato: 'json' }
  ))
  assert.strictEqual(voltou.NUMERO_NC, '2026NC000123')
  assert.strictEqual(voltou.VALOR_NC, 1500.5)
  assert.strictEqual(voltou.OBS, null)
})

test('lista vazia com --json sai como [], e nao como prosa', () => {
  assert.deepStrictEqual(JSON.parse(saida.lista([], { formato: 'json' }).texto), [])
})
