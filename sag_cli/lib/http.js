'use strict'

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

const { caminhoSessao } = require('./config')

const TIMEOUT_MS = 180000

// O modulo http do Node NAO le HTTP_PROXY/HTTPS_PROXY do ambiente, e aqui isso
// e o que faz o CLI funcionar. O SAG fica na EBNet: com o proxy Squid da rede
// no caminho, a conexao morre em "503 Tunnel connection failed", que se le como
// "o SAG caiu". Nao acrescente suporte a proxy: seria acrescentar a falha.

/**
 * Decodifica o corpo SEM confiar num charset fixo.
 *
 * O SAG declara UTF-8 no Content-Type e no meta da pagina, e a consulta de 2026
 * decodifica como UTF-8. Mas uma leitura anterior da MESMA rota so fez sentido
 * em ISO-8859-1. As duas medicoes discordaram em 2026-08-07, e enquanto isso
 * nao se explicar, fixar qualquer um dos dois estraga o acento na metade dos
 * casos, calado, e o texto estragado entraria inteiro no SCA.
 *
 * A regra abaixo nao precisa da explicacao para acertar: UTF-8 tem estrutura, e
 * byte alto solto (o caso do latin-1) NAO passa no decode estrito. Entao
 * tentamos UTF-8 estrito e so caimos para latin-1 quando ele reprova. Prosa em
 * portugues valida nos dois e rara ao ponto de nao valer o custo de tratar.
 */
function decodificarCorpo (buffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  try {
    return utf8.decode(buffer)
  } catch (e) {
    return buffer.toString('latin1')
  }
}

class ErroSag extends Error {
  constructor (status, mensagem, corpo) {
    super(`HTTP ${status}: ${mensagem}`)
    this.name = 'ErroSag'
    this.status = status
    this.mensagem = mensagem
    this.corpo = corpo
  }
}

// ---------------------------------------------------------------------------
// Sessao por cookie
// ---------------------------------------------------------------------------

/**
 * Sessao HTTP com cookie, do tamanho exato que o SAG exige.
 *
 * Nao e um cookie jar completo de proposito: o SAG usa um dominio, um caminho e
 * um cookie de sessao do PHP. Guardar dominio, path, expiracao e SameSite seria
 * carregar um jar inteiro para um par nome/valor.
 */
class Sessao {
  constructor (cfg) {
    this.cfg = cfg
    this.cookies = new Map()
  }

  cabecalhoCookie () {
    if (!this.cookies.size) return null
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  guardarCookies (res) {
    const bruto = res.headers['set-cookie'] || []
    for (const linha of bruto) {
      const par = String(linha).split(';')[0]
      const igual = par.indexOf('=')
      if (igual > 0) {
        this.cookies.set(par.slice(0, igual).trim(), par.slice(igual + 1).trim())
      }
    }
  }

  temSessao () {
    return this.cookies.size > 0
  }

  /**
   * Requisicao crua. `caminho` e absoluto a partir da raiz do SAG ('/php/...').
   * Devolve { status, texto }.
   */
  requisitar (metodo, caminho, opcoes = {}) {
    const url = new URL(this.cfg.server + caminho)
    const cliente = url.protocol === 'https:' ? https : http

    const cabecalhos = {
      Accept: 'text/html,application/json,*/*',
      // O SAG serve paginas diferentes para navegador e para XHR em algumas
      // rotas. As consultas (chamadas/*.php) sao XHR no client web, e e assim
      // que elas devem chegar aqui.
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'sag_cli (controle_acervo)'
    }

    let dados = null
    if (opcoes.formulario) {
      // O corpo que ENVIAMOS e sempre ASCII: CPF, senha e datas. Nao ha
      // acento a codificar, entao nao ha decisao de charset a tomar aqui.
      dados = Buffer.from(serializar(opcoes.formulario), 'utf8')
      cabecalhos['Content-Type'] = 'application/x-www-form-urlencoded'
      cabecalhos['Content-Length'] = dados.length
    }

    const cookie = this.cabecalhoCookie()
    if (cookie) cabecalhos.Cookie = cookie

    const opcoesReq = { method: metodo, headers: cabecalhos, timeout: TIMEOUT_MS }
    if (this.cfg.insecure && url.protocol === 'https:') {
      opcoesReq.rejectUnauthorized = false
    }

    return new Promise((resolve, reject) => {
      const req = cliente.request(url, opcoesReq, res => {
        const pedacos = []
        res.on('data', d => pedacos.push(d))
        res.on('end', () => {
          this.guardarCookies(res)
          const texto = decodificarCorpo(Buffer.concat(pedacos))
          if (res.statusCode >= 400) {
            return reject(new ErroSag(res.statusCode, primeiraLinha(texto), texto))
          }
          resolve({ status: res.statusCode, texto })
        })
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error(
          `O SAG nao respondeu em ${TIMEOUT_MS / 1000}s (${metodo} ${caminho}). ` +
          'Consulta de ano inteiro e pesada: reduza o periodo ou os campos.'
        ))
      })
      req.on('error', err => reject(traduzirRede(err, this.cfg.server)))
      if (dados) req.write(dados)
      req.end()
    })
  }
}

/**
 * Traduz erro de rede para a causa provavel, que aqui e quase sempre a mesma:
 * a maquina esta fora da EBNet. Sem isto, `getaddrinfo failed` vira "o SAG nao
 * funciona", e a doutrina do vault e explicita em nao gravar isso.
 */
function traduzirRede (err, server) {
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
    return new Error(
      `Nao consegui resolver o nome do SAG (${err.code}). O SAG so responde de dentro ` +
      'da rede do EB. Confira a conexao; a falha e transitoria, nao e do sistema.'
    )
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return new Error(
      `Sem rota ate o SAG (${err.code}). Verifique se esta na rede do EB e se ` +
      'SAG_URL aponta para o endereco certo.'
    )
  }
  if (err.code === 'CERT_HAS_EXPIRED' || String(err.code || '').includes('CERT')) {
    return new Error(
      `Certificado do SAG recusado (${err.code}). Use --insecure para aceitar, ` +
      'ciente de que isso desliga a verificacao.'
    )
  }
  return err
}

function primeiraLinha (texto) {
  const limpo = String(texto).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return limpo.slice(0, 200) || 'sem corpo na resposta'
}

/**
 * Serializa em application/x-www-form-urlencoded aceitando LISTA por chave.
 *
 * Os seletores do SAG sao multiplos e o backend espera `ND[]=x&ND[]=y`. Um
 * objeto plano com o ultimo valor vencendo perderia metade do filtro, e a
 * consulta voltaria certa demais para levantar suspeita.
 */
function serializar (campos) {
  const partes = []
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === undefined || valor === null) continue
    const valores = Array.isArray(valor) ? valor : [valor]
    for (const v of valores) {
      partes.push(encodeURIComponent(chave) + '=' + encodeURIComponent(String(v)))
    }
  }
  return partes.join('&')
}

// ---------------------------------------------------------------------------
// Login e cache
// ---------------------------------------------------------------------------

function lerCache (cfg) {
  if (cfg.semCache) return null
  try {
    const { arquivo } = caminhoSessao(cfg.server)
    const dado = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    if (!dado || !dado.cookies) return null
    return dado
  } catch (e) {
    return null
  }
}

function gravarCache (cfg, sessao) {
  if (cfg.semCache) return
  try {
    const { dir, arquivo } = caminhoSessao(cfg.server)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      arquivo,
      JSON.stringify({ cookies: [...sessao.cookies], em: new Date().toISOString() }),
      // O cookie e credencial: so o dono le.
      { mode: 0o600 }
    )
  } catch (e) {
    // Cache e otimizacao, nunca requisito. Falhar aqui nao pode derrubar a
    // consulta que ja funcionou.
  }
}

function apagarCache (cfg) {
  try {
    fs.unlinkSync(caminhoSessao(cfg.server).arquivo)
    return true
  } catch (e) {
    return false
  }
}

/**
 * Autentica no SAG e devolve a Sessao pronta.
 *
 * O SAG responde ao POST /login.php com o corpo "1" quando aceita, e com
 * qualquer outra coisa quando recusa. Nao ha token nem JSON: quem sustenta a
 * sessao e o cookie do PHP.
 */
async function autenticar (cfg) {
  if (!cfg.usuario || !cfg.senha) {
    throw new Error(
      'Faltam credenciais do SAG. Defina SAG_USUARIO (CPF, 11 digitos) e SAG_SENHA ' +
      'no ambiente. Nunca passe senha na linha de comando.'
    )
  }

  const sessao = new Sessao(cfg)
  // O GET inicial existe para o PHP emitir o cookie de sessao ANTES do POST.
  // Sem ele o login responde 1 e a sessao nasce em outro id, e a primeira
  // consulta volta para a tela de "sem permissao".
  await sessao.requisitar('GET', '/index.php')

  const { texto } = await sessao.requisitar('POST', '/login.php', {
    formulario: { cpf: cfg.usuario, senha: cfg.senha }
  })

  if (texto.trim() !== '1') {
    throw new Error(
      'O SAG recusou o login. Confira SAG_USUARIO e SAG_SENHA. ' +
      `Resposta do servidor: ${primeiraLinha(texto)}`
    )
  }

  gravarCache(cfg, sessao)
  return sessao
}

/**
 * Devolve uma sessao valida, reaproveitando o cookie em cache quando ele ainda
 * serve. O SAG nao diz quando a sessao expira, entao a prova e uma pagina real:
 * pedimos a home autenticada e olhamos se veio a tela de recusa.
 */
async function sessaoValida (cfg) {
  const cache = lerCache(cfg)
  if (cache) {
    const sessao = new Sessao(cfg)
    sessao.cookies = new Map(cache.cookies)
    if (await autenticada(sessao)) return sessao
  }
  return autenticar(cfg)
}

/** A home do SAG responde com "NAO TEM PERMISSAO" quando a sessao morreu. */
async function autenticada (sessao) {
  try {
    const { texto } = await sessao.requisitar('GET', '/php/index.php')
    return !/NÃO TEM PERMISSÃO|NAO TEM PERMISSAO/i.test(texto)
  } catch (e) {
    return false
  }
}

module.exports = {
  decodificarCorpo,
  Sessao,
  ErroSag,
  autenticar,
  sessaoValida,
  autenticada,
  lerCache,
  gravarCache,
  apagarCache,
  serializar
}
