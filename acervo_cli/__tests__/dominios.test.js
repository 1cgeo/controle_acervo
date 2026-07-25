// Path: __tests__\dominios.test.js
'use strict'

// Os apelidos de dominio saem do utils/domain_constants.js do server/, lido ao
// vivo, nao de um catalogo copiado. Estes testes provam a derivacao e a
// honestidade sobre o que o offline NAO sabe.

const { test } = require('node:test')
const assert = require('node:assert')

const dominios = require('../lib/dominios')

test('resolve a escala por apelido curto, que e como o chefe escreve', () => {
  assert.strictEqual(dominios.resolver('tipo_escala', '50k'), 2)
  assert.strictEqual(dominios.resolver('tipo_escala', '250k'), 4)
  assert.strictEqual(dominios.resolver('tipo_escala', '25k'), 1)
  assert.strictEqual(dominios.resolver('tipo_escala', '100k'), 3)
})

test('o apelido longo (nome da constante) tambem resolve', () => {
  assert.strictEqual(dominios.resolver('tipo_escala', 'escala-50k'), 2)
  assert.strictEqual(dominios.resolver('tipo_escala', 'escala_50k'), 2)
  assert.strictEqual(dominios.resolver('tipo_produto', 'carta-topografica'), 2)
})

test('code numerico passa direto: quem ja sabe nao e obrigado a usar apelido', () => {
  assert.strictEqual(dominios.resolver('tipo_escala', 2), 2)
  assert.strictEqual(dominios.resolver('tipo_escala', '4'), 4)
})

test('50k e 250k nao colidem', () => {
  // O erro real que este teste tranca: uma auditoria inteira ja rodou na escala
  // errada por 4 (250k) ter sido lido como 50k.
  assert.notStrictEqual(
    dominios.resolver('tipo_escala', '50k'),
    dominios.resolver('tipo_escala', '250k')
  )
})

test('valor desconhecido explica em vez de so recusar', () => {
  assert.throws(
    () => dominios.resolver('tipo_escala', '500k'),
    /nao e um valor conhecido[\s\S]*Apelidos que o CLI resolve offline/
  )
})

test('dominio de subconjunto avisa que a tabela viva esta no servidor', () => {
  // tipo_produto e subtipo_produto so existem parcialmente no domain_constants
  // (o proprio arquivo diz "subconjuntos usados em queries"); esconder isso
  // faria o CLI mentir sobre o que sabe.
  assert.throws(
    () => dominios.resolver('subtipo_produto', 'carta-aeronautica'),
    /SUBCONJUNTO|acervo dominio subtipo_produto/
  )
})

test('campoDe diz em que chave do corpo o dominio entra', () => {
  assert.strictEqual(dominios.campoDe('tipo_escala'), 'tipo_escala_id')
  assert.strictEqual(dominios.campoDe('tipo_status_arquivo'), 'tipo_status_id')
})

test('rotuloDe faz o caminho de volta, do code para o nome', () => {
  assert.strictEqual(dominios.rotuloDe('tipo_versao', 2), 'REGISTRO_HISTORICO')
  assert.strictEqual(dominios.rotuloDe('tipo_arquivo', 9), 'TILESERVER')
  assert.strictEqual(dominios.rotuloDe('tipo_escala', 99), null)
})

test('todo dominio listado tem mapa e campo', () => {
  for (const tabela of dominios.listarTabelas()) {
    assert.ok(dominios.mapaDe(tabela), `${tabela} sem mapa`)
    assert.ok(dominios.campoDe(tabela), `${tabela} sem campo`)
  }
})
