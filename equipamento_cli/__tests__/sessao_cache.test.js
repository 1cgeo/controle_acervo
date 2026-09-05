'use strict'

// O cache de sessao (~/.sca/sessao-<servidor>.json) e chaveado so pelo SERVIDOR,
// e e o MESMO arquivo para os seis CLIs do ~/.sca. Duas coisas dependiam disso e
// estavam erradas ate 2026-09-05:
//
// 1. Ele nao guardava QUEM autenticou. `SCA_USER=souza <cli> ...` logo depois de
//    `SCA_USER=silva <cli> ...` reusava o token de SILVA em silencio, e
//    `auditoria.evento`, que e append-only, gravava a pessoa errada.
// 2. Um 403 era tratado como token velho: o CLI apagava o cache, refazia o login
//    e repetia a chamada, que responde 403 de novo. Neste sistema um 403 e falta
//    de PERFIL (o `verifyPerfil` le o BANCO a cada requisicao, e nao o token), e
//    nenhum login o resolve. O preco eram duas viagens, um login e o cache
//    perdido para as chamadas SEGUINTES, que a pessoa TEM direito de fazer.
//
//   Rodar: cd equipamento_cli && node --test

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const nodeHttp = require('node:http')

const http = require('../lib/http')
const { caminhoSessao } = require('../lib/config')

// Nome de servidor que nao existe e nao resolve: o arquivo de cache desta suite
// nunca colide com o da instalacao de quem roda o teste.
const SERVIDOR_FALSO = 'http://sessao-de-teste.invalido:1'

/** JWT de mentira: so o `exp` do payload interessa a quem le o cache. */
function tokenFalso (segundos) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + segundos })
  ).toString('base64url')
  return `cabeca.${payload}.assinatura`
}

function apagar (server) {
  try {
    fs.unlinkSync(caminhoSessao(server).arquivo)
  } catch (e) {
    // Nao existir e o estado desejado.
  }
}

test('o cache guarda QUEM autenticou, e recusa o token de outra conta', () => {
  const cfg = { server: SERVIDOR_FALSO, usuario: 'silva' }
  try {
    http.gravarSessao(cfg, tokenFalso(3600))
    const gravado = JSON.parse(fs.readFileSync(caminhoSessao(SERVIDOR_FALSO).arquivo, 'utf8'))
    assert.strictEqual(gravado.usuario, 'silva', 'o login precisa entrar no arquivo')

    assert.ok(http.lerSessao(cfg), 'a propria conta continua reusando o cache')
    assert.strictEqual(
      http.lerSessao({ server: SERVIDOR_FALSO, usuario: 'souza' }),
      null,
      'outra conta nao pode herdar o token: a trilha de auditoria e append-only'
    )
  } finally {
    apagar(SERVIDOR_FALSO)
  }
})

test('cache gravado por versao anterior, sem o campo, continua servindo', () => {
  const { dir, arquivo } = caminhoSessao(SERVIDOR_FALSO)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(arquivo, JSON.stringify({
      token: tokenFalso(3600),
      exp: Math.floor(Date.now() / 1000) + 3600
    }))
    assert.ok(
      http.lerSessao({ server: SERVIDOR_FALSO, usuario: 'silva' }),
      'o campo novo nao pode invalidar quem ja tinha sessao aberta'
    )
  } finally {
    apagar(SERVIDOR_FALSO)
  }
})

test('403 nao vira relogin: uma chamada so, e o cache continua la', async () => {
  let chamadas = 0
  const servidor = nodeHttp.createServer((req, res) => {
    chamadas += 1
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: false, message: 'Usuario nao possui permissao' }))
  })
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve))
  const server = `http://127.0.0.1:${servidor.address().port}`
  const cfg = { server, usuario: 'silva', senha: 'x', cliente: 'sca_web', timeoutMs: 5000 }

  try {
    http.gravarSessao(cfg, tokenFalso(3600))
    await assert.rejects(
      () => http.autenticada(cfg, 'GET', '/qualquer'),
      err => err.status === 403
    )
    assert.strictEqual(chamadas, 1, 'um 403 de PERFIL nao se conserta com login novo')
    assert.ok(
      fs.existsSync(caminhoSessao(server).arquivo),
      'apagar o cache faz a proxima chamada, que a pessoa PODE fazer, pagar login outra vez'
    )
  } finally {
    apagar(server)
    await new Promise(resolve => servidor.close(resolve))
  }
})
