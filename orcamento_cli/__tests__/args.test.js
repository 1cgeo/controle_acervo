// Path: __tests__\args.test.js
'use strict'

// Testes com node:test (embutido no Node), nao jest: o CLI nao instala
// node_modules proprio, e depender do jest do server/ para testar o CLI criaria
// um acoplamento que a dependencia zero existe para evitar.
//   Rodar: cd orcamento_cli && npm test

const { test } = require('node:test')
const assert = require('node:assert')

const { parse, exigir, numero, lista } = require('../lib/args')

test('separa posicionais de flags com valor', () => {
  const r = parse(['nc', 'listar', '--ano', '2026'])
  assert.deepStrictEqual(r._, ['nc', 'listar'])
  assert.strictEqual(r.flags.ano, '2026')
})

test('flags booleanas nao consomem o proximo argumento', () => {
  const r = parse(['nc', 'criar', '--dry-run', '--data', '{}'])
  assert.strictEqual(r.flags['dry-run'], true)
  assert.strictEqual(r.flags.data, '{}')
})

test('aceita a forma --flag=valor', () => {
  const r = parse(['nc', 'listar', '--ano=2026', '--campos=id,numero'])
  assert.strictEqual(r.flags.ano, '2026')
  assert.strictEqual(r.flags.campos, 'id,numero')
})

test('--flag=valor nao consome o proximo argumento', () => {
  const r = parse(['--ano=2026', 'listar'])
  assert.deepStrictEqual(r._, ['listar'])
})

test('flag desconhecida sem valor nao engole a flag seguinte', () => {
  // O modo de falha que este teste tranca: --extra viraria "--json" como valor,
  // e o --json sumiria sem aviso nenhum.
  const r = parse(['saldo', '--extra', '--json'])
  assert.strictEqual(r.flags.extra, true)
  assert.strictEqual(r.flags.json, true)
})

test('-- encerra as flags', () => {
  const r = parse(['nc', 'criar', '--', '--nao-e-flag'])
  assert.deepStrictEqual(r._, ['nc', 'criar', '--nao-e-flag'])
})

test('valor com espacos e preservado', () => {
  const r = parse(['licitacao', 'criar', '--data', '{"objeto": "compra de GPS"}'])
  assert.strictEqual(r.flags.data, '{"objeto": "compra de GPS"}')
})

test('exigir recusa flag ausente e flag booleana vazia', () => {
  assert.throws(() => exigir({}, 'id', 'id do registro'), /Falta --id/)
  assert.throws(() => exigir({ id: true }, 'id'), /Falta --id/)
  assert.strictEqual(exigir({ id: '42' }, 'id'), '42')
})

test('numero devolve o padrao quando a flag falta e recusa texto', () => {
  assert.strictEqual(numero({}, 'mes', 7), 7)
  assert.strictEqual(numero({ mes: '3' }, 'mes', 7), 3)
  assert.throws(() => numero({ mes: 'julho' }, 'mes', 7), /precisa ser um numero/)
})

test('lista divide por virgula e ignora espacos e vazios', () => {
  assert.deepStrictEqual(lista('id, numero ,valor_nc,'), ['id', 'numero', 'valor_nc'])
  assert.strictEqual(lista(undefined), null)
})
