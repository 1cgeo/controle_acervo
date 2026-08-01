'use strict'

// Testes com node:test (embutido no Node), nao jest: o CLI nao instala
// node_modules proprio, e depender do jest do server/ para testar o CLI criaria
// o acoplamento que a dependencia zero existe para evitar.
//   Rodar: cd mapoteca_cli && npm test

const { test } = require('node:test')
const assert = require('node:assert')

const { parse, exigir, numero, lista, texto } = require('../lib/args')

test('separa posicionais de flags com valor', () => {
  const r = parse(['pedido', 'itens', '--id', '42'])
  assert.deepStrictEqual(r._, ['pedido', 'itens'])
  assert.strictEqual(r.flags.id, '42')
})

test('flags booleanas nao consomem o proximo argumento', () => {
  const r = parse(['pedido', 'cadastrar', '--dry-run', '--plano', 'p.json'])
  assert.strictEqual(r.flags['dry-run'], true)
  assert.strictEqual(r.flags.plano, 'p.json')
})

test('aceita a forma --flag=valor', () => {
  const r = parse(['pedido', 'listar', '--campos=id,prazo'])
  assert.strictEqual(r.flags.campos, 'id,prazo')
})

test('--flag=valor nao consome o proximo argumento', () => {
  const r = parse(['--ano=2026', 'relatorio'])
  assert.deepStrictEqual(r._, ['relatorio'])
})

test('flag desconhecida sem valor nao engole a flag seguinte', () => {
  // O modo de falha que este teste tranca: --novo viraria "--json" como valor, e
  // o --json sumiria sem aviso nenhum.
  const r = parse(['pedido', 'cadastrar', '--novo', '--json'])
  assert.strictEqual(r.flags.novo, true)
  assert.strictEqual(r.flags.json, true)
})

test('-- encerra as flags', () => {
  const r = parse(['resolver', '--', '--nao-e-flag'])
  assert.deepStrictEqual(r._, ['resolver', '--nao-e-flag'])
})

test('varios posicionais sobrevivem (resolver recebe N folhas)', () => {
  const r = parse(['resolver', '2962-4-NE', '2963-1', '2963-2', '--tipo-produto', '2'])
  assert.deepStrictEqual(r._, ['resolver', '2962-4-NE', '2963-1', '2963-2'])
  assert.strictEqual(r.flags['tipo-produto'], '2')
})

test('valor com espacos e preservado (nome de OM por extenso)', () => {
  const r = parse(['cliente', 'resolver', '6 Regimento de Cavalaria Blindado'])
  assert.strictEqual(r._[2], '6 Regimento de Cavalaria Blindado')
})

test('exigir recusa flag ausente e flag booleana vazia', () => {
  assert.throws(() => exigir({}, 'id', 'id do pedido'), /Falta --id/)
  assert.throws(() => exigir({ id: true }, 'id'), /Falta --id/)
  assert.strictEqual(exigir({ id: '42' }, 'id'), '42')
})

test('numero devolve o padrao quando a flag falta e recusa texto', () => {
  assert.strictEqual(numero({}, 'ano', 2026), 2026)
  assert.strictEqual(numero({ ano: '2025' }, 'ano', 2026), 2025)
  assert.throws(() => numero({ ano: 'passado' }, 'ano', 2026), /precisa ser um numero/)
})

test('lista divide por virgula e ignora espacos e vazios', () => {
  assert.deepStrictEqual(lista('id, prazo ,cliente_nome,'), ['id', 'prazo', 'cliente_nome'])
  assert.strictEqual(lista(undefined), null)
})

test('texto devolve null para flag booleana, nao a string "true"', () => {
  // Sem isso, --descricao sem valor viraria a descricao literal "true" gravada
  // no banco do anexo.
  assert.strictEqual(texto({ descricao: true }, 'descricao'), null)
  assert.strictEqual(texto({}, 'descricao'), null)
  assert.strictEqual(texto({ descricao: 'DIEx do 6 RCB' }, 'descricao'), 'DIEx do 6 RCB')
})
