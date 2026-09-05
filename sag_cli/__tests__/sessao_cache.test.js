'use strict'

// O cache do cookie do SAG (~/.sag/sessao-<servidor>.json) e chaveado so pelo
// SERVIDOR. Ate 2026-09-05 ele nao guardava QUEM autenticou: rodar com
// `SAG_USUARIO=<outro CPF>` logo depois de uma consulta reusava o cookie do CPF
// anterior em silencio, e o SAG respondia como a pessoa errada. E o mesmo
// defeito que o cache dos seis CLIs do ~/.sca tinha.
//   Rodar: cd sag_cli && node --test

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')

const http = require('../lib/http')
const { caminhoSessao } = require('../lib/config')

// Nome de servidor que nao existe e nao resolve: o arquivo desta suite nunca
// colide com o da instalacao de quem roda o teste.
const SERVIDOR_FALSO = 'http://sessao-de-teste.invalido:1'

/** Substituto de Sessao: a lerCache/gravarCache so interessam os cookies. */
const sessaoFalsa = { cookies: new Map([['PHPSESSID', 'abc123']]) }

function apagar () {
  try {
    fs.unlinkSync(caminhoSessao(SERVIDOR_FALSO).arquivo)
  } catch (e) {
    // Nao existir e o estado desejado.
  }
}

test('o cache guarda QUEM autenticou, e recusa o cookie de outro CPF', () => {
  try {
    http.gravarCache({ server: SERVIDOR_FALSO, usuario: '11111111111' }, sessaoFalsa)
    const gravado = JSON.parse(fs.readFileSync(caminhoSessao(SERVIDOR_FALSO).arquivo, 'utf8'))
    assert.strictEqual(gravado.usuario, '11111111111', 'o CPF precisa entrar no arquivo')

    assert.ok(
      http.lerCache({ server: SERVIDOR_FALSO, usuario: '11111111111' }),
      'a propria conta continua reusando o cookie'
    )
    assert.strictEqual(
      http.lerCache({ server: SERVIDOR_FALSO, usuario: '22222222222' }),
      null,
      'outro CPF nao pode herdar a sessao: o SAG responderia como a pessoa errada'
    )
  } finally {
    apagar()
  }
})

test('cache gravado por versao anterior, sem o campo, continua servindo', () => {
  const { dir, arquivo } = caminhoSessao(SERVIDOR_FALSO)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(arquivo, JSON.stringify({ cookies: [['PHPSESSID', 'abc123']] }))
    assert.ok(
      http.lerCache({ server: SERVIDOR_FALSO, usuario: '11111111111' }),
      'o campo novo nao pode invalidar quem ja tinha sessao aberta'
    )
  } finally {
    apagar()
  }
})
