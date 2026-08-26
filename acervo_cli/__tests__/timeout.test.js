'use strict'

// O tempo de espera da chamada.
//
// Ele era uma constante de 120 s dentro do lib/http.js, e as rotas que LEEM
// BYTE no volume (catalogar, atualizar-checksum, renomear-padrao,
// corrigir-nome-fisico) passam disso com lote grande: o servidor segura a
// conexao enquanto le o arquivo. Desistir do lado do cliente NAO cancela o
// servidor, entao o timeout curto numa rota de escrita produz o pior estado
// possivel, que e nao saber se a escrita aconteceu.

const { test } = require('node:test')
const assert = require('node:assert')

const { resolver } = require('../lib/config')

const semAmbiente = (fn) => {
  const antes = process.env.SCA_TIMEOUT
  delete process.env.SCA_TIMEOUT
  try { fn() } finally {
    if (antes === undefined) delete process.env.SCA_TIMEOUT
    else process.env.SCA_TIMEOUT = antes
  }
}

test('o padrao continua em 120 s quando ninguem pede outra coisa', () => {
  semAmbiente(() => {
    assert.strictEqual(resolver({ server: 'http://exemplo' }).timeoutMs, 120000)
  })
})

test('a flag --timeout vem em SEGUNDOS e vira milissegundos', () => {
  semAmbiente(() => {
    assert.strictEqual(resolver({ server: 'http://exemplo', timeout: '1800' }).timeoutMs, 1800000)
    assert.strictEqual(resolver({ server: 'http://exemplo', timeout: 90 }).timeoutMs, 90000)
  })
})

test('a flag manda sobre a variavel de ambiente', () => {
  const antes = process.env.SCA_TIMEOUT
  process.env.SCA_TIMEOUT = '300'
  try {
    assert.strictEqual(resolver({ server: 'http://exemplo' }).timeoutMs, 300000)
    assert.strictEqual(resolver({ server: 'http://exemplo', timeout: '600' }).timeoutMs, 600000)
  } finally {
    if (antes === undefined) delete process.env.SCA_TIMEOUT
    else process.env.SCA_TIMEOUT = antes
  }
})

// Valor torto vira espera de 0 ms ou NaN se ninguem conferir, e o Node com
// timeout 0 nunca expira: o comando ficaria pendurado para sempre.
test('recusa valor que nao e numero positivo, em vez de esperar para sempre', () => {
  semAmbiente(() => {
    for (const torto of ['abc', '0', '-5']) {
      assert.throws(
        () => resolver({ server: 'http://exemplo', timeout: torto }),
        /SEGUNDOS maior que zero/,
        `deveria recusar ${JSON.stringify(torto)}`
      )
    }
  })
})

// `--timeout` sem valor cai como `true` no parser de flags, e `Number(true)` e
// 1: um segundo de espera passaria calado e derrubaria toda chamada.
test('--timeout sem valor cai no padrao, e nao em 1 segundo', () => {
  semAmbiente(() => {
    assert.strictEqual(resolver({ server: 'http://exemplo', timeout: true }).timeoutMs, 120000)
  })
})
