'use strict'

const http = require('http')
const https = require('https')
const fs = require('fs')
const { URL } = require('url')

const { caminhoSessao } = require('./config')

const TIMEOUT_MS = 120000

// Margem de seguranca antes da expiracao do JWT. O SCA assina com validade de
// 1h; renovamos com 3 min de folga para nao estourar no meio de um encadeamento
// (ler a listagem de usuarios e mandar o reset logo em seguida, por exemplo).
const FOLGA_EXPIRACAO_S = 180

// O modulo http do Node NAO le HTTP_PROXY/HTTPS_PROXY do ambiente (ao contrario
// do requests do Python e do urllib). Isso e proposital aqui: o proxy Squid da
// rede interna devolve 503 para IP interno, e ja houve caso de isso ser lido
// como "o SCA esta fora do ar". Nao acrescente suporte a proxy sem necessidade.

class ErroHttp extends Error {
  constructor (status, mensagem, payload) {
    super(`HTTP ${status}: ${mensagem}`)
    this.name = 'ErroHttp'
    this.status = status
    this.mensagem = mensagem
    this.payload = payload
  }
}

// ---------------------------------------------------------------------------
// Requisicao
// ---------------------------------------------------------------------------

/**
 * Faz uma requisicao ao backend e desembrulha o envelope padrao do SCA
 * ({ version, success, message, dados, error }).
 *
 * Devolve { status, message, dados } no sucesso; lanca ErroHttp no erro, ja com
 * a mensagem que o backend produz. Aqui isso importa MAIS do que nos CLIs
 * irmaos: as frases desta feature dizem o que fazer ("Usuário já possui
 * registros no sistema e não pode ser excluído. Desative-o.", "Operação
 * bloqueada: este é o último administrador ativo do sistema", "Usuário sem
 * senha cadastrada no sistema. Procure um administrador."). Reembrulhar
 * qualquer uma delas numa mensagem generica seria trocar a instrucao pelo
 * codigo de status.
 */
function requisitar (cfg, metodo, caminho, opcoes = {}) {
  const { corpo, bytes, contentType, token, binario } = opcoes
  const url = new URL(cfg.server + '/api' + caminho)
  const cliente = url.protocol === 'https:' ? https : http

  const cabecalhos = { Accept: 'application/json' }
  let dados = null

  if (corpo !== undefined && corpo !== null) {
    dados = Buffer.from(JSON.stringify(corpo), 'utf8')
    cabecalhos['Content-Type'] = 'application/json'
  } else if (bytes) {
    dados = bytes
    if (contentType) cabecalhos['Content-Type'] = contentType
  }
  if (dados) cabecalhos['Content-Length'] = dados.length
  if (token) cabecalhos.Authorization = 'Bearer ' + token

  const opcoesReq = {
    method: metodo,
    headers: cabecalhos,
    timeout: TIMEOUT_MS
  }
  // Servidor HTTPS com certificado self-signed na rede interna.
  if (cfg.insecure && url.protocol === 'https:') {
    opcoesReq.rejectUnauthorized = false
  }

  return new Promise((resolve, reject) => {
    const req = cliente.request(url, opcoesReq, res => {
      const pedacos = []
      res.on('data', d => pedacos.push(d))
      res.on('end', () => {
        const bruto = Buffer.concat(pedacos)

        if (binario && res.statusCode >= 200 && res.statusCode < 300) {
          return resolve({ status: res.statusCode, bytes: bruto })
        }

        const texto = bruto.toString('utf8')
        let payload = null
        try {
          payload = JSON.parse(texto)
        } catch (e) {
          payload = texto
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          const message = payload && typeof payload === 'object' ? payload.message : null
          const conteudo = payload && typeof payload === 'object' && 'dados' in payload
            ? payload.dados
            : payload
          return resolve({ status: res.statusCode, message, dados: conteudo })
        }

        // 429: o SCA limita 200 requisicoes por minuto (app.js). Num lote longo
        // isso aparece no meio do caminho, e sem esta mensagem parece falha da
        // rota. Nao e: e so esperar a janela virar.
        if (res.statusCode === 429) {
          return reject(new ErroHttp(
            429,
            'limite de 200 requisicoes por minuto atingido. Espere a janela de 1 min ' +
            'virar e retome do ponto de parada (nao reenvie o lote inteiro).',
            payload
          ))
        }

        const mensagem = (payload && typeof payload === 'object'
          ? payload.message || payload.error
          : null) || texto.slice(0, 300) || 'sem corpo na resposta'
        reject(new ErroHttp(res.statusCode, mensagem, payload))
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error(`tempo esgotado (${TIMEOUT_MS} ms)`))
    })
    req.on('error', err => {
      reject(new Error(
        `Nao foi possivel falar com ${cfg.server}: ${err.message}. ` +
        'O SCA pode estar fora do ar ou inacessivel desta maquina (verifique o alcance de rede). ' +
        'E transitorio: nao registre como "a ferramenta nao funciona".'
      ))
    })

    if (dados) req.write(dados)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Sessao (cache do token entre invocacoes)
// ---------------------------------------------------------------------------

/** Le o `exp` do JWT sem validar assinatura: so queremos saber quando expira. */
function expiracaoDoToken (token) {
  try {
    const parte = String(token).split('.')[1]
    if (!parte) return null
    const json = Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      .toString('utf8')
    const payload = JSON.parse(json)
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch (e) {
    return null
  }
}

function lerSessao (cfg) {
  const { arquivo } = caminhoSessao(cfg.server)
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    const agora = Math.floor(Date.now() / 1000)
    if (!dados.token || !dados.exp || dados.exp - FOLGA_EXPIRACAO_S <= agora) {
      return null
    }
    return dados.token
  } catch (e) {
    return null
  }
}

function gravarSessao (cfg, token) {
  const { dir, arquivo } = caminhoSessao(cfg.server)
  const exp = expiracaoDoToken(token) || Math.floor(Date.now() / 1000) + 3300
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    // mode 0600: credencial e so do dono. No Windows o modo e ignorado pelo SO,
    // mas o arquivo fica no perfil do usuario, que ja e o escopo dele.
    fs.writeFileSync(arquivo, JSON.stringify({ token, exp }), { mode: 0o600 })
  } catch (e) {
    // Cache e otimizacao, nunca requisito: se nao der para gravar, seguimos
    // autenticando a cada chamada (comportamento antigo) em vez de falhar.
  }
}

function limparSessao (cfg) {
  const { arquivo } = caminhoSessao(cfg.server)
  try {
    fs.unlinkSync(arquivo)
    return true
  } catch (e) {
    return false
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function autenticar (cfg) {
  if (!cfg.usuario || !cfg.senha) {
    throw new Error(
      'Faltam credenciais. Defina SCA_USER e SCA_SENHA no ambiente ' +
      '(preferido, mantem a senha fora da linha de comando), ou passe --user e --senha, ' +
      'ou um --token pronto.'
    )
  }

  let resposta
  try {
    resposta = await requisitar(cfg, 'POST', '/login', {
      corpo: { usuario: cfg.usuario, senha: cfg.senha, cliente: cfg.cliente }
    })
  } catch (err) {
    if (err instanceof ErroHttp) {
      // A mensagem do servidor vem PRIMEIRO e inteira: quem valida a senha e o
      // proprio SCA, e ele distingue tres casos que a frase generica juntaria
      // num so ("usuario ou senha invalida"): conta inativa, senha errada e
      // senha AINDA NAO CADASTRADA. O ultimo nao se resolve tentando de novo.
      throw new Error(
        `Falha no login (HTTP ${err.status}): ${err.mensagem}. ` +
        'Confira o usuario e a senha; se a resposta fala em senha nao cadastrada, ' +
        'o caminho e um administrador rodar: efetivo usuario resetar-senha.'
      )
    }
    throw err
  }

  const dados = resposta.dados || {}
  if (!dados.token) {
    throw new Error('O login respondeu sem token.')
  }
  return {
    token: dados.token,
    administrador: dados.administrador === true,
    uuid: dados.uuid || null,
    perfis: dados.perfis || {},
    modulos: dados.modulos || []
  }
}

/**
 * Devolve um token valido, reusando o cache quando possivel.
 * Ordem: --token/SCA_TOKEN > cache em disco > login novo.
 */
async function obterToken (cfg) {
  if (cfg.token) return cfg.token

  if (!cfg.semCache) {
    const emCache = lerSessao(cfg)
    if (emCache) return emCache
  }

  const { token } = await autenticar(cfg)
  if (!cfg.semCache) gravarSessao(cfg, token)
  return token
}

/** Requisicao autenticada: resolve o token (cache ou login) e chama. */
async function autenticada (cfg, metodo, caminho, opcoes = {}) {
  const token = await obterToken(cfg)
  try {
    return await requisitar(cfg, metodo, caminho, { ...opcoes, token })
  } catch (err) {
    // Token em cache rejeitado (expirou antes da folga, ou o servidor reiniciou
    // com outro JWT_SECRET): descarta e tenta uma vez com token novo.
    //
    // Cuidado com o 403 aqui: nesta feature ele tambem significa "voce nao e
    // administrador", e ai reautenticar nao muda nada. Repetir uma vez custa um
    // login e devolve o mesmo 403, com a mensagem do servidor intacta, que e o
    // que quem le precisa ver.
    if (err instanceof ErroHttp && (err.status === 401 || err.status === 403) && !cfg.token) {
      limparSessao(cfg)
      const { token: novo } = await autenticar(cfg)
      if (!cfg.semCache) gravarSessao(cfg, novo)
      return requisitar(cfg, metodo, caminho, { ...opcoes, token: novo })
    }
    throw err
  }
}

/** Monta a query string, omitindo chaves nulas/indefinidas. */
function query (params) {
  const partes = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  return partes.length ? '?' + partes.join('&') : ''
}

module.exports = {
  ErroHttp,
  requisitar,
  autenticada,
  autenticar,
  obterToken,
  limparSessao,
  lerSessao,
  gravarSessao,
  expiracaoDoToken,
  query
}
