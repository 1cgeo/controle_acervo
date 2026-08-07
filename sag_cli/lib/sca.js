'use strict'

const http = require('http')
const https = require('https')
const { URL } = require('url')

// Cliente MINIMO do SCA, so para LER o que o `conferir` compara.
//
// Nao e um segundo orcamento_cli, e nao deve virar um: escrever no SCA continua
// sendo trabalho do orcamento_cli, que tem os guardrails (dry-run contra o Joi
// vivo, confirmacao de exclusao, releitura no destino). O que este arquivo faz
// e uma coisa so: pegar a lista de um recurso para comparar.

const TIMEOUT_MS = 120000

function requisitar (cfg, metodo, caminho, opcoes = {}) {
  const url = new URL(cfg.server + '/api' + caminho)
  const cliente = url.protocol === 'https:' ? https : http
  const cabecalhos = { Accept: 'application/json' }
  let dados = null

  if (opcoes.corpo) {
    dados = Buffer.from(JSON.stringify(opcoes.corpo), 'utf8')
    cabecalhos['Content-Type'] = 'application/json'
    cabecalhos['Content-Length'] = dados.length
  }
  if (opcoes.token) cabecalhos.Authorization = 'Bearer ' + opcoes.token

  const req = { method: metodo, headers: cabecalhos, timeout: TIMEOUT_MS }
  if (cfg.insecure && url.protocol === 'https:') req.rejectUnauthorized = false

  return new Promise((resolve, reject) => {
    const r = cliente.request(url, req, res => {
      const pedacos = []
      res.on('data', d => pedacos.push(d))
      res.on('end', () => {
        const texto = Buffer.concat(pedacos).toString('utf8')
        let payload = null
        try { payload = JSON.parse(texto) } catch (e) { payload = texto }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(payload && typeof payload === 'object' && 'dados' in payload
            ? payload.dados
            : payload)
        }
        const mensagem = (payload && typeof payload === 'object'
          ? payload.message || payload.error
          : null) || String(texto).slice(0, 200)
        reject(new Error(`SCA respondeu HTTP ${res.statusCode}: ${mensagem}`))
      })
    })
    r.on('timeout', () => { r.destroy(); reject(new Error('O SCA nao respondeu a tempo.')) })
    r.on('error', reject)
    if (dados) r.write(dados)
    r.end()
  })
}

/** Token do SCA: o pronto do ambiente, ou um login com usuario e senha. */
async function autenticar (cfg) {
  if (cfg.token) return cfg.token
  if (!cfg.usuario || !cfg.senha) {
    throw new Error(
      'Faltam credenciais do SCA. Defina SCA_TOKEN, ou SCA_USER e SCA_SENHA, no ambiente.'
    )
  }
  const dados = await requisitar(cfg, 'POST', '/login', {
    corpo: { usuario: cfg.usuario, senha: cfg.senha, cliente: cfg.cliente }
  })
  const token = dados && (dados.token || dados.jwt)
  if (!token) throw new Error('O SCA aceitou o login mas nao devolveu token.')
  return token
}

async function listar (cfg, caminho, params = {}) {
  const token = await autenticar(cfg)
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const dados = await requisitar(
    cfg, 'GET', caminho + (query ? '?' + query : ''), { token }
  )
  return Array.isArray(dados) ? dados : []
}

module.exports = { listar, autenticar, requisitar }
