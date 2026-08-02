'use strict'

const path = require('path')
const os = require('os')

// O CLIENTE que o login do SCA aceita. Ele so aceita
// 'sca_qgis' ou 'sca_web' (server/src/login/login_schema.js); o CLI e um cliente
// de API como o client web, entao usa 'sca_web'. Este e o unico lugar do CLI que
// sabe disso.
const CLIENTE_AUTH = 'sca_web'

// Onde o token fica em cache entre invocacoes. Fora do repo e fora do vault:
// e credencial, nunca versionada. Um arquivo por servidor, para nao misturar o
// token da instancia local com o de producao. O diretorio e do SCA (nao da
// mapoteca) de proposito: o token vale para a API inteira, entao um CLI irmao
// que fale com o mesmo servidor reaproveita a mesma sessao em vez de logar de
// novo.
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
 *   SCA_URL    URL do backend do SCA, ex.: http://IP:porta
 *              (SCA_SERVER e alias aceito, igual nos tres CLIs irmaos;
 *              MAPOTECA_SERVER continua aceito como legado)
 *   SCA_USER   login de admin no SCA
 *   SCA_SENHA  senha (preferir esta a passar --senha na linha de comando)
 *   SCA_TOKEN  JWT pronto (pula o login)
 */
function resolver (flags, exigirServidor = true) {
  // A ordem e a mesma dos CLIs irmaos (acervo_cli e orcamento_cli): sem isso o
  // mesmo ambiente serve dois CLIs e falha no terceiro, que foi o que
  // aconteceu em 2026-07-27 com SCA_SERVER exportado.
  const server = flags.server ||
    process.env.SCA_URL ||
    process.env.SCA_SERVER ||
    process.env.MAPOTECA_SERVER

  // Com --dry-run nada sai da maquina: a validacao local contra o Joi roda sem
  // servidor, sem credencial e sem rede. Exigir URL ai seria pedir configuracao
  // para uma operacao offline, e tirar do agente o jeito mais barato de conferir
  // um corpo antes de tentar de verdade.
  if (!server && exigirServidor) {
    throw new Error(
      'Informe --server ou a variavel de ambiente SCA_URL (ex.: http://IP:porta).'
    )
  }

  return {
    server: server ? String(server).replace(/\/+$/, '') : null,
    usuario: flags.user || process.env.SCA_USER || null,
    senha: flags.senha || process.env.SCA_SENHA || null,
    token: flags.token || process.env.SCA_TOKEN || null,
    insecure: flags.insecure === true,
    semCache: flags['sem-cache'] === true,
    cliente: CLIENTE_AUTH
  }
}

module.exports = { resolver, caminhoSessao, CLIENTE_AUTH }
