'use strict'

// Testes com node:test (embutido no Node), nao jest: o CLI nao instala
// node_modules proprio, e depender do jest do server/ para testar o CLI criaria
// um acoplamento que a dependencia zero existe para evitar.
//   Rodar: cd auth_cli && npm test

const { test } = require('node:test')
const assert = require('node:assert')

const { parse, exigir, numero, lista, repetida } = require('../lib/args')

test('separa posicionais de flags com valor', () => {
  const r = parse(['usuario', 'obter', '--uuid', 'abc-123'])
  assert.deepStrictEqual(r._, ['usuario', 'obter'])
  assert.strictEqual(r.flags.uuid, 'abc-123')
})

test('flags booleanas nao consomem o proximo argumento', () => {
  const r = parse(['usuario', 'criar', '--dry-run', '--data', '{}'])
  assert.strictEqual(r.flags['dry-run'], true)
  assert.strictEqual(r.flags.data, '{}')
})

test('aceita a forma --flag=valor', () => {
  const r = parse(['usuario', 'perfis', '--uuid=abc', '--conceder=acervo=2'])
  assert.strictEqual(r.flags.uuid, 'abc')
  // So o PRIMEIRO '=' separa a flag do valor: o resto e valor, e aqui o valor
  // e ele proprio um par chave=valor.
  assert.strictEqual(r.flags.conceder, 'acervo=2')
})

test('--flag=valor nao consome o proximo argumento', () => {
  const r = parse(['--uuid=abc', 'usuario'])
  assert.deepStrictEqual(r._, ['usuario'])
})

test('flag desconhecida sem valor nao engole a flag seguinte', () => {
  // O modo de falha que este teste tranca: --admin viraria "--sem-senha" como
  // valor, e o --sem-senha sumiria sem aviso nenhum.
  const r = parse(['usuario', 'listar', '--admin', '--sem-senha'])
  assert.strictEqual(r.flags.admin, true)
  assert.strictEqual(r.flags['sem-senha'], true)
})

test('-- encerra as flags', () => {
  const r = parse(['usuario', 'listar', '--', '--nao-e-flag'])
  assert.deepStrictEqual(r._, ['usuario', 'listar', '--nao-e-flag'])
})

test('valor com espacos e preservado', () => {
  const r = parse(['usuario', 'criar', '--data', '{"nome": "Fulano de Tal"}'])
  assert.strictEqual(r.flags.data, '{"nome": "Fulano de Tal"}')
})

test('flag repetida acumula em array, nao sobrescreve', () => {
  // O --conceder depende disto: sobrescrever perderia a primeira concessao em
  // silencio, num comando que mexe em acesso de gente.
  const r = parse(['usuario', 'perfis', '--conceder', 'acervo=2', '--conceder', 'mapoteca=1'])
  assert.deepStrictEqual(r.flags.conceder, ['acervo=2', 'mapoteca=1'])
  assert.deepStrictEqual(repetida(r.flags, 'conceder'), ['acervo=2', 'mapoteca=1'])
})

test('repetida devolve array mesmo com uma ocorrencia so', () => {
  const r = parse(['usuario', 'perfis', '--revogar', 'orcamento'])
  assert.deepStrictEqual(repetida(r.flags, 'revogar'), ['orcamento'])
  assert.deepStrictEqual(repetida({}, 'revogar'), [])
})

test('exigir recusa flag ausente, booleana vazia e repetida', () => {
  assert.throws(() => exigir({}, 'uuid', 'uuid da pessoa'), /Falta --uuid/)
  assert.throws(() => exigir({ uuid: true }, 'uuid'), /Falta --uuid/)
  assert.throws(() => exigir({ uuid: ['a', 'b'] }, 'uuid'), /mais de uma vez/)
  assert.strictEqual(exigir({ uuid: 'abc' }, 'uuid'), 'abc')
})

test('numero devolve o padrao quando a flag falta e recusa texto', () => {
  assert.strictEqual(numero({}, 'total', 14), 14)
  assert.strictEqual(numero({ total: '30' }, 'total', 14), 30)
  assert.throws(() => numero({ total: 'trinta' }, 'total', 14), /precisa ser um numero/)
})

test('lista divide por virgula, junta repeticoes e ignora vazios', () => {
  assert.deepStrictEqual(lista('u1, u2 ,'), ['u1', 'u2'])
  assert.deepStrictEqual(lista(['u1', 'u2']), ['u1', 'u2'])
  assert.strictEqual(lista(undefined), null)
})
