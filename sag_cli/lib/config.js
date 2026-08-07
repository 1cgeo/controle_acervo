'use strict'

const path = require('path')
const os = require('os')

// NENHUM ENDERECO LITERAL NESTE ARQUIVO, e a ausencia e a regra: o repositorio
// e publico (ver CLAUDE.md). A URL do SAG vive na chave SAG_URL do
// server/config.env, que e gitignored. O catalogo sem valor esta em
// .env.example.

/**
 * Onde o cookie de sessao do SAG fica em cache entre invocacoes.
 *
 * Fora do repo e fora do vault: e credencial. Um arquivo por servidor, para o
 * cookie de um ambiente nao vazar para o outro. Diretorio proprio (~/.sag), e
 * nao o ~/.sca dos CLIs irmaos, porque a sessao e de OUTRO sistema: misturar as
 * duas faria um logout aqui derrubar a sessao do SCA.
 */
function caminhoSessao (server) {
  const dir = path.join(os.homedir(), '.sag')
  const chave = String(server)
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
  return { dir, arquivo: path.join(dir, `sessao-${chave}.json`) }
}

/**
 * Resolve a configuracao a partir das flags e do ambiente, nesta ordem:
 * flag explicita > variavel de ambiente. Nunca de arquivo versionado.
 *
 * Chaves de ambiente (catalogo em .env.example e no env-guia.md do vault):
 *   SAG_URL       URL do SAG
 *   SAG_USUARIO   CPF, 11 digitos, so numeros
 *   SAG_SENHA     senha do SAG, 6 digitos
 *
 * O comando `conferir` fala tambem com o SCA e usa as chaves dele, as mesmas
 * do orcamento_cli: SCA_URL, SCA_USER, SCA_SENHA, SCA_TOKEN.
 */
function resolver (flags = {}, exigirServidor = true) {
  const server = flags.server || process.env.SAG_URL

  if (!server && exigirServidor) {
    throw new Error(
      'Informe --server ou a variavel de ambiente SAG_URL. ' +
      'O endereco nao mora no codigo: o repositorio e publico.'
    )
  }

  const usuario = flags.usuario || process.env.SAG_USUARIO || null
  const senha = flags.senha || process.env.SAG_SENHA || null

  // O SAG valida CPF de 11 digitos e senha de 6 no proprio formulario. Cobrar
  // aqui poupa uma ida a rede que voltaria com "usuario ou senha invalidos",
  // que e a mensagem menos util possivel para diagnosticar um dado truncado.
  if (usuario && !/^\d{11}$/.test(String(usuario))) {
    throw new Error(
      'SAG_USUARIO precisa ser o CPF com 11 digitos, so numeros, sem ponto nem traco.'
    )
  }
  if (senha && String(senha).length !== 6) {
    throw new Error('SAG_SENHA precisa ter 6 caracteres, como no formulario do SAG.')
  }

  return {
    server: server ? String(server).replace(/\/+$/, '') : null,
    usuario,
    senha,
    insecure: flags.insecure === true,
    semCache: flags['sem-cache'] === true
  }
}

/** Configuracao do SCA, para o comando `conferir`. Reusa as chaves do orcamento_cli. */
function resolverSca (flags = {}) {
  const server = flags['sca-url'] || process.env.SCA_URL || process.env.SCA_SERVER
  if (!server) {
    throw new Error(
      'Informe --sca-url ou a variavel de ambiente SCA_URL: `conferir` compara o SAG com o SCA.'
    )
  }
  return {
    server: String(server).replace(/\/+$/, ''),
    usuario: flags['sca-user'] || process.env.SCA_USER || null,
    senha: flags['sca-senha'] || process.env.SCA_SENHA || null,
    token: flags['sca-token'] || process.env.SCA_TOKEN || null,
    cliente: 'sca_web',
    insecure: flags.insecure === true
  }
}

module.exports = { resolver, resolverSca, caminhoSessao }
