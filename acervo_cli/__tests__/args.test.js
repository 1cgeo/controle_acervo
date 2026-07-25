// Path: __tests__\args.test.js
'use strict'

// Testes com node:test (embutido no Node), nao jest: o CLI nao instala
// node_modules proprio, e depender do jest do server/ para testar o CLI criaria
// um acoplamento que a dependencia zero existe para evitar.
//   Rodar: cd acervo_cli && npm test

const { test } = require('node:test')
const assert = require('node:assert')

const { parse, exigir, numero, lista, repetida } = require('../lib/args')

test('separa posicionais de flags com valor', () => {
  const r = parse(['produto', '2965-2', '--escala', '50k'])
  assert.deepStrictEqual(r._, ['produto', '2965-2'])
  assert.strictEqual(r.flags.escala, '50k')
})

test('flags booleanas nao consomem o proximo argumento', () => {
  const r = parse(['produtos', 'excluir-versao', '--dry-run', '--data', '{}'])
  assert.strictEqual(r.flags['dry-run'], true)
  assert.strictEqual(r.flags.data, '{}')
})

test('aceita a forma --flag=valor', () => {
  const r = parse(['cobertura', '--escala=50k', '--mi=2965-2,2965-4'])
  assert.strictEqual(r.flags.escala, '50k')
  assert.strictEqual(r.flags.mi, '2965-2,2965-4')
})

test('--flag=valor nao consome o proximo argumento', () => {
  const r = parse(['--escala=50k', 'cobertura'])
  assert.deepStrictEqual(r._, ['cobertura'])
})

test('flag desconhecida sem valor nao engole a flag seguinte', () => {
  // O modo de falha que este teste tranca: --arquivos viraria "--caminho" como
  // valor, e o --caminho sumiria sem aviso nenhum.
  const r = parse(['produto', '--arquivos', '--caminho'])
  assert.strictEqual(r.flags.arquivos, true)
  assert.strictEqual(r.flags.caminho, true)
})

test('-- encerra as flags', () => {
  const r = parse(['produtos', 'criar-produtos', '--', '--nao-e-flag'])
  assert.deepStrictEqual(r._, ['produtos', 'criar-produtos', '--nao-e-flag'])
})

test('valor com espacos e preservado', () => {
  const r = parse(['editar', 'produto', '--set', 'nome=Serra do Mar'])
  assert.strictEqual(r.flags.set, 'nome=Serra do Mar')
})

test('flag repetida acumula em array, nao sobrescreve', () => {
  // O --set do editar depende disto: sobrescrever perderia a primeira mudanca
  // em silencio, que e a classe de erro mais cara num comando de escrita.
  const r = parse(['editar', 'versao', '--set', 'a=1', '--set', 'b=2'])
  assert.deepStrictEqual(r.flags.set, ['a=1', 'b=2'])
  assert.deepStrictEqual(repetida(r.flags, 'set'), ['a=1', 'b=2'])
})

test('repetida devolve array mesmo com uma ocorrencia so', () => {
  const r = parse(['editar', 'versao', '--set', 'a=1'])
  assert.deepStrictEqual(repetida(r.flags, 'set'), ['a=1'])
  assert.deepStrictEqual(repetida({}, 'set'), [])
})

test('exigir recusa flag ausente, booleana vazia e repetida', () => {
  assert.throws(() => exigir({}, 'id', 'id do registro'), /Falta --id/)
  assert.throws(() => exigir({ id: true }, 'id'), /Falta --id/)
  assert.throws(() => exigir({ id: ['1', '2'] }, 'id'), /mais de uma vez/)
  assert.strictEqual(exigir({ id: '42' }, 'id'), '42')
})

test('numero devolve o padrao quando a flag falta e recusa texto', () => {
  assert.strictEqual(numero({}, 'mes', 7), 7)
  assert.strictEqual(numero({ mes: '3' }, 'mes', 7), 3)
  assert.throws(() => numero({ mes: 'julho' }, 'mes', 7), /precisa ser um numero/)
})

test('lista divide por virgula, junta repeticoes e ignora vazios', () => {
  assert.deepStrictEqual(lista('2965-2, 2965-4 ,'), ['2965-2', '2965-4'])
  assert.deepStrictEqual(lista(['2965-2', '2965-4']), ['2965-2', '2965-4'])
  assert.strictEqual(lista(undefined), null)
})
