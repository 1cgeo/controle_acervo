'use strict'

const path = require('path')
const os = require('os')

const RAIZ_SERVER = path.join(__dirname, '..', '..', 'server', 'src')

// A lista de clientes de auth aceitos NAO e copiada: vem do .valid() do proprio
// login_schema.js do server/. Se o backend aceitar um cliente novo, o CLI aceita
// junto, sem tocar neste arquivo.
function clientesAceitos () {
  try {
    const login = require(path.join(RAIZ_SERVER, 'login', 'login_schema'))
    const desc = login.login.describe()
    const allow = (desc.keys.cliente && desc.keys.cliente.allow) || []
    return allow.filter(v => typeof v === 'string')
  } catch (e) {
    return []
  }
}

// O CLI nao e o QGIS: entre os dois clientes registrados no servico de
// autenticacao, 'sca_web' e o honesto para uma ferramenta que fala com a API
// pela rede, e e o que as skills do vault ja usam para as rotas de acervo.
const CLIENTE_PADRAO = 'sca_web'

// Onde o token fica em cache entre invocacoes. Fora do repo e fora do vault:
// e credencial, nunca versionada. Um arquivo por servidor, para nao misturar
// o token da instancia local com o de producao.
function caminhoSessao (server) {
  const dir = path.join(os.homedir(), '.sca')
  const chave = String(server)
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
  return { dir, arquivo: path.join(dir, `sessao-${chave}.json`) }
}

/**
 * Resolve a configuracao a partir das flags e do ambiente, nesta ordem:
 * flag explicita > variavel de ambiente. Nunca de arquivo versionado.
 *
 * Chaves de ambiente (catalogo em env-guia.md do vault):
 *   SCA_URL     URL do backend, ex.: http://IP:3015 (SCA_SERVER e alias aceito)
 *   SCA_USER    login de admin
 *   SCA_SENHA   senha (preferir esta a passar --senha na linha de comando)
 *   SCA_TOKEN   JWT pronto (pula o login)
 *   SCA_TIMEOUT segundos de espera por resposta (padrao 120)
 */
// O TIMEOUT E DE ROTA, e nao do CLI. As rotas que LEEM BYTE (catalogar,
// atualizar-checksum, renomear-padrao, corrigir-nome-fisico) seguram a conexao
// enquanto o servidor le o volume, e 120 s cobre um punhado de arquivos, nao um
// lote de dezenas de gigabytes. O default fica onde estava; quem sabe que vai
// esperar diz quanto.
//
// O timeout do CLIENTE nao cancela o servidor: desistir aqui deixa a escrita
// correndo la. Por isso o numero e ajustavel em vez de generoso por padrao --
// quem espera de menos numa rota de escrita fica sem saber o que aconteceu.
const TIMEOUT_PADRAO_S = 120

function resolverTimeout (flags) {
  const bruto = flags.timeout !== undefined && flags.timeout !== true
    ? flags.timeout
    : process.env.SCA_TIMEOUT
  if (bruto === undefined || bruto === null || bruto === '') return TIMEOUT_PADRAO_S * 1000
  const segundos = Number(bruto)
  if (!Number.isFinite(segundos) || segundos <= 0) {
    throw new Error(`--timeout precisa ser um numero de SEGUNDOS maior que zero (recebi ${JSON.stringify(bruto)}).`)
  }
  return Math.round(segundos * 1000)
}

function resolver (flags, exigirServidor = true) {
  const server = flags.server || process.env.SCA_URL || process.env.SCA_SERVER

  // Com --dry-run nada sai da maquina: a validacao local contra o Joi roda sem
  // servidor, sem credencial e sem rede. Exigir URL ai seria pedir configuracao
  // para uma operacao offline, e tirar do agente o jeito mais barato de conferir
  // um corpo antes de tentar de verdade.
  if (!server && exigirServidor) {
    throw new Error(
      'Informe --server ou a variavel de ambiente SCA_URL (ex.: http://IP:3015).'
    )
  }

  const cliente = flags.cliente && flags.cliente !== true ? String(flags.cliente) : CLIENTE_PADRAO
  const aceitos = clientesAceitos()
  if (aceitos.length && !aceitos.includes(cliente)) {
    throw new Error(
      `Cliente de auth "${cliente}" nao e aceito pelo SCA. Aceitos: ${aceitos.join(', ')}.`
    )
  }

  return {
    server: server ? String(server).replace(/\/+$/, '') : null,
    usuario: flags.user || process.env.SCA_USER || null,
    senha: flags.senha || process.env.SCA_SENHA || null,
    token: flags.token || process.env.SCA_TOKEN || null,
    insecure: flags.insecure === true,
    semCache: flags['sem-cache'] === true,
    timeoutMs: resolverTimeout(flags),
    cliente
  }
}

module.exports = { resolver, caminhoSessao, clientesAceitos, CLIENTE_PADRAO, RAIZ_SERVER }
