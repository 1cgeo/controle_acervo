'use strict'

// Testes com node:test (embutido no Node), nao jest: o CLI nao instala
// node_modules proprio, e depender do jest do server/ para testar o CLI criaria
// um acoplamento que a dependencia zero existe para evitar.
//   Rodar: node --test pit_cli/__tests__/*.test.js

const { test } = require('node:test')
const assert = require('node:assert')

const { parse, exigir, numero, lista } = require('../lib/args')

test('separa posicionais de flags com valor', () => {
  const r = parse(['meta', 'listar', '--ano', '2026'])
  assert.deepStrictEqual(r._, ['meta', 'listar'])
  assert.strictEqual(r.flags.ano, '2026')
})

test('flags booleanas nao consomem o proximo argumento', () => {
  const r = parse(['execucao', 'lancar', '--dry-run', '--data', '{}'])
  assert.strictEqual(r.flags['dry-run'], true)
  assert.strictEqual(r.flags.data, '{}')
})

test('aceita a forma --flag=valor', () => {
  const r = parse(['meta', 'listar', '--ano=2026', '--campos=id,descricao'])
  assert.strictEqual(r.flags.ano, '2026')
  assert.strictEqual(r.flags.campos, 'id,descricao')
})

test('--flag=valor nao consome o proximo argumento', () => {
  const r = parse(['--ano=2026', 'listar'])
  assert.deepStrictEqual(r._, ['listar'])
})

test('flag desconhecida sem valor nao engole a flag seguinte', () => {
  // O modo de falha que este teste tranca: --insecure viraria "--json" como
  // valor, e o --json sumiria sem aviso nenhum.
  const r = parse(['edicao', 'listar', '--insecure', '--json'])
  assert.strictEqual(r.flags.insecure, true)
  assert.strictEqual(r.flags.json, true)
})

test('o numero da subsecao sobrevive como texto, com o ponto', () => {
  // 7.1 e ROTULO de documento, e nao numero: virar 7.1 em Number e depois em
  // texto ainda daria "7.1", mas "7.10" viraria "7.1" e apontaria outra
  // subsecao. O parser nunca converte, e este teste tranca isso.
  const r = parse(['subsecao', 'gravar', '--id', '7', '--numero', '7.10'])
  assert.strictEqual(r.flags.numero, '7.10')
})

test('-- encerra as flags', () => {
  const r = parse(['meta', 'criar', '--', '--nao-e-flag'])
  assert.deepStrictEqual(r._, ['meta', 'criar', '--nao-e-flag'])
})

test('valor com espacos e preservado', () => {
  const r = parse(['meta', 'criar', '--data', '{"descricao": "Carta Topográfica"}'])
  assert.strictEqual(r.flags.data, '{"descricao": "Carta Topográfica"}')
})

test('exigir recusa flag ausente e flag booleana vazia', () => {
  assert.throws(() => exigir({}, 'file', 'caminho do arquivo'), /Falta --file/)
  assert.throws(() => exigir({ file: true }, 'file'), /Falta --file/)
  assert.strictEqual(exigir({ file: 'a.pdf' }, 'file'), 'a.pdf')
})

test('numero devolve o padrao quando a flag falta e recusa texto', () => {
  assert.strictEqual(numero({}, 'mes', 7), 7)
  assert.strictEqual(numero({ mes: '3' }, 'mes', 7), 3)
  assert.throws(() => numero({ mes: 'julho' }, 'mes', 7), /precisa ser um número/)
})

test('lista divide por virgula e ignora espacos e vazios', () => {
  assert.deepStrictEqual(
    lista('id, numero_meta ,descricao,'),
    ['id', 'numero_meta', 'descricao']
  )
  assert.strictEqual(lista(undefined), null)
})
