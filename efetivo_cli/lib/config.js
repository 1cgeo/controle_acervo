'use strict'

const path = require('path')
const os = require('os')

const RAIZ_SERVER = path.join(__dirname, '..', '..', 'server', 'src')

// A lista de clientes de auth aceitos NAO e copiada: vem do .valid() do proprio
// login_schema.js do server/. Se o backend aceitar um cliente novo, o CLI aceita
// junto, sem tocar neste arquivo.
//
// Esse `.valid()` e a UNICA lista de clientes que existe no sistema: nao ha
// catalogo de aplicacao, e `dgeo.login.cliente` e VARCHAR. Ler daqui e o que
// impede este CLI de virar a segunda fonte de verdade de uma lista de duas
// linhas.
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

// O CLI nao e o QGIS: entre os dois clientes aceitos, 'sca_web' e o honesto para
// uma ferramenta que fala com a API pela rede, e e o que os CLIs irmaos
// (acervo, mapoteca, orcamento) ja usam. O valor entra em `dgeo.login.cliente`
// e aparece no proprio `efetivo acessos logins clientes`.
const CLIENTE_PADRAO = 'sca_web'

// Onde o token fica em cache entre invocacoes. Fora do repo e fora do vault:
// e credencial, nunca versionada. Um arquivo por servidor, para nao misturar o
// token da instancia local com o de producao. O diretorio e do SCA (nao deste
// CLI) de proposito: o token vale para a API inteira, entao um CLI irmao que
// fale com o mesmo servidor reaproveita a mesma sessao em vez de logar de novo.
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
 *   SCA_URL     URL do backend, ex.: http://IP:porta (SCA_SERVER e alias aceito)
 *   SCA_USER    login de admin
 *   SCA_SENHA   senha (preferir esta a passar --senha na linha de comando)
 *   SCA_TOKEN   JWT pronto (pula o login)
 */
function resolver (flags, exigirServidor = true) {
  const server = flags.server || process.env.SCA_URL || process.env.SCA_SERVER

  // Com --dry-run nada sai da maquina: a validacao local contra o Joi roda sem
  // servidor, sem credencial e sem rede. Exigir URL ai seria pedir configuracao
  // para uma operacao offline, e tirar do agente o jeito mais barato de conferir
  // um corpo antes de tentar de verdade.
  if (!server && exigirServidor) {
    throw new Error(
      'Informe --server ou a variavel de ambiente SCA_URL (ex.: http://IP:porta).'
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
    cliente
  }
}

module.exports = { resolver, caminhoSessao, clientesAceitos, CLIENTE_PADRAO, RAIZ_SERVER }
