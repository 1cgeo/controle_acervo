'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const valores = require('../lib/valores')

test('numero le o formato pt-BR do SAG', () => {
  assert.strictEqual(valores.numero('20.710,00'), 20710)
  assert.strictEqual(valores.numero('1.234.567,89'), 1234567.89)
  assert.strictEqual(valores.numero('0,26'), 0.26)
  assert.strictEqual(valores.numero('R$ 6.349,10'), 6349.1)
})

test('numero nao confunde separador de milhar com decimal', () => {
  // O erro classico: trocar a virgula antes do ponto faria "20.710,00" virar
  // 20.71, um valor plausivel e errado por mil vezes.
  assert.notStrictEqual(valores.numero('20.710,00'), 20.71)
})

test('numero devolve null para vazio, e nunca zero', () => {
  // Zero e uma afirmacao ("nao houve movimento"); null e ausencia. Trocar um
  // pelo outro faz uma NC sem valor somar como se valesse zero.
  assert.strictEqual(valores.numero(''), null)
  assert.strictEqual(valores.numero(null), null)
  assert.strictEqual(valores.numero(undefined), null)
  assert.strictEqual(valores.numero('-'), null)
})

test('paraIso resolve o ano de dois digitos do SAG', () => {
  assert.strictEqual(valores.paraIso('05/02/26'), '2026-02-05')
  assert.strictEqual(valores.paraIso('13/04/2026'), '2026-04-13')
  assert.strictEqual(valores.paraIso('01/12/99'), '1999-12-01')
})

test('paraIso aceita o que ja e ISO e recusa lixo', () => {
  assert.strictEqual(valores.paraIso('2026-04-13'), '2026-04-13')
  assert.strictEqual(valores.paraIso('abril'), null)
  assert.strictEqual(valores.paraIso(''), null)
})

test('paraSag devolve o formato que o filtro da tela espera', () => {
  assert.strictEqual(valores.paraSag('2026-01-01'), '01/01/2026')
  assert.strictEqual(valores.paraSag('31/12/2026'), '31/12/2026')
  assert.throws(() => valores.paraSag('01-01-2026'), /formato desconhecido/)
})

test('documentoCurto tira o prefixo de UG e gestao', () => {
  // Sem isto o `conferir` nao casaria NENHUM registro, e diria que o SCA esta
  // vazio quando o problema e so a representacao do numero.
  assert.strictEqual(valores.documentoCurto('160382000012026NE000153'), '2026NE000153')
  assert.strictEqual(valores.documentoCurto('2026NC400134'), '2026NC400134')
  assert.strictEqual(valores.documentoCurto(null), null)
})

test('mesmoValor tolera o centavo e nada alem dele', () => {
  assert.ok(valores.mesmoValor('20.710,00', 20710))
  assert.ok(valores.mesmoValor('6.349,10', 6349.1))
  assert.ok(!valores.mesmoValor('20.710,00', 20710.5))
})

const { decodificarCorpo } = require('../lib/http')

test('decodificarCorpo acerta o acento vindo em UTF-8', () => {
  assert.strictEqual(decodificarCorpo(Buffer.from('diárias', 'utf8')), 'diárias')
})

test('decodificarCorpo acerta o acento vindo em ISO-8859-1', () => {
  // Byte alto solto (E1) nao e UTF-8 valido: o decode estrito reprova e a
  // queda para latin-1 devolve o texto certo, em vez de mojibake.
  assert.strictEqual(decodificarCorpo(Buffer.from('diárias', 'latin1')), 'diárias')
})

test('decodificarCorpo nao estraga ASCII puro', () => {
  assert.strictEqual(decodificarCorpo(Buffer.from('2026NC400134', 'utf8')), '2026NC400134')
})

test('numero le o decimal com ponto que o SCA devolve', () => {
  // O NUMERIC do Postgres chega como "20710.00". Tratado como milhar viraria
  // 2071000, e a conferencia acusaria divergencia em toda linha certa.
  assert.strictEqual(valores.numero('20710.00'), 20710)
  assert.strictEqual(valores.numero('6349.10'), 6349.1)
  assert.strictEqual(valores.numero('0.26'), 0.26)
})

test('numero distingue milhar de decimal quando nao ha virgula', () => {
  assert.strictEqual(valores.numero('1.234'), 1234)
  assert.strictEqual(valores.numero('1.23'), 1.23)
  assert.strictEqual(valores.numero('18422.14'), 18422.14)
})

test('mesmoValor casa os dois lados da conferencia', () => {
  // O caso exato que falhou na primeira execucao real contra os dois sistemas.
  assert.ok(valores.mesmoValor('20.710,00', '20710.00'))
  assert.ok(valores.mesmoValor('864,00', '864.00'))
  assert.ok(valores.mesmoValor('1.727,48', '1727.48'))
  assert.ok(!valores.mesmoValor('20.710,00', '20711.00'))
})
