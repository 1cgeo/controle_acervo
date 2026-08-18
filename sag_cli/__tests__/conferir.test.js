'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const conferir = require('../comandos/conferir')
const { indexarRecolhimentos, chaveDe, RECURSOS } = conferir

const CHAVE = RECURSOS.nc.recolhimento.chave
const CAMPO = RECURSOS.nc.recolhimento.campoValor

test('a nc declara a segunda tabela, e ela nao casa por ND', () => {
  // As ND 339000 e 449000 da anulacao nao existem no dominio do SCA, entao o
  // recolhimento grava cod_nd nulo. Uma chave com cod_nd nao acharia nenhum.
  assert.deepStrictEqual(CHAVE, ['numero', 'ug_emitente'])
  assert.strictEqual(RECURSOS.nc.recolhimento.caminho, '/orcamento/recolhimentos')
  assert.ok(!CHAVE.includes('cod_nd'))
})

test('a ne nao tem segunda tabela', () => {
  // Empenho nao se anula por recolhimento: quem anula NE e o valor_anulado.
  assert.strictEqual(RECURSOS.ne.recolhimento, undefined)
})

test('documento de rateio soma as parcelas numa chave so', () => {
  // Caso real: a 2026NC401316 abate R$ 0,98 de uma NC e R$ 0,99 de outra, e o
  // SAG declara o documento inteiro em R$ 1,97. Sem a soma, cada parcela
  // pareceria divergencia de valor contra o documento.
  const mapa = indexarRecolhimentos([
    { numero: '2026NC401316', ug_emitente: '160035', valor: '0.98' },
    { numero: '2026NC401316', ug_emitente: '160035', valor: '0.99' }
  ], CHAVE, CAMPO)

  assert.strictEqual(mapa.size, 1)
  const item = mapa.get(chaveDe({ numero: '2026NC401316', ug_emitente: '160035' }, CHAVE))
  assert.strictEqual(item.valor, 1.97)
  assert.strictEqual(item.linhas, 2)
})

test('mesmo numero de UG emitente diferente nao se funde', () => {
  // A numeracao do SIAFI e por UG emitente. Fundir as duas somaria documentos
  // distintos e inventaria divergencia de valor nos dois.
  const mapa = indexarRecolhimentos([
    { numero: '2026NC400412', ug_emitente: '160035', valor: '0.03' },
    { numero: '2026NC400412', ug_emitente: '167035', valor: '0.09' }
  ], CHAVE, CAMPO)

  assert.strictEqual(mapa.size, 2)
})

test('valor ausente entra como zero, e nao quebra a soma', () => {
  const mapa = indexarRecolhimentos([
    { numero: '2026NC400288', ug_emitente: '160035', valor: null },
    { numero: '2026NC400288', ug_emitente: '160035', valor: '0.26' }
  ], CHAVE, CAMPO)

  assert.strictEqual(mapa.get([...mapa.keys()][0]).valor, 0.26)
})

test('le o formato pt-BR que o SCA devolve como string', () => {
  const mapa = indexarRecolhimentos([
    { numero: '2026NC401638', ug_emitente: '160035', valor: '20710.00' }
  ], CHAVE, CAMPO)

  assert.strictEqual(mapa.get([...mapa.keys()][0]).valor, 20710)
})

test('lista vazia devolve mapa vazio, nunca erro', () => {
  assert.strictEqual(indexarRecolhimentos([], CHAVE, CAMPO).size, 0)
})
