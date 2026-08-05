'use strict'

// `efetivo login`, `efetivo logout`, `efetivo status`.
//
// O token do SCA vale cerca de 1 hora. Sem cache, cada invocacao do CLI faz um
// POST /api/login novo: numa revisao de trinta cadastros sao trinta
// autenticacoes, e a senha precisa estar no ambiente o tempo todo. Com cache,
// autentica uma vez.
//
// O cache mora em ~/.sca e e o MESMO dos CLIs irmaos: um login serve o acervo, a
// mapoteca, o orcamento e este. Trocar a sessao aqui troca a deles junto, o que
// e o comportamento desejado (o token vale para a API inteira) e vale dizer no
// logout, senao "encerrei a sessao do efetivo" parece um efeito menor do que e.

const http = require('../lib/http')
const { caminhoSessao } = require('../lib/config')

async function executar (args, cfg) {
  const comando = args._[0]

  if (comando === 'logout') {
    const removeu = http.limparSessao(cfg)
    return {
      texto: removeu
        ? `Sessao encerrada para ${cfg.server}.\n` +
          'O cache e compartilhado: os CLIs irmaos (acervo, mapoteca, orcamento)\n' +
          'tambem vao autenticar de novo no proximo comando.'
        : `Nao havia sessao em cache para ${cfg.server}.`
    }
  }

  if (comando === 'status') {
    const linhas = [`servidor   ${cfg.server}`]

    // Probe publico: nao exige credencial, so diz se o SCA esta de pe.
    try {
      const r = await http.requisitar(cfg, 'GET', '')
      const versao = r.dados && r.dados.database_version ? r.dados.database_version : '?'
      linhas.push(`backend    no ar (banco versao ${versao})`)
    } catch (err) {
      linhas.push(`backend    INACESSIVEL (${err.message})`)
      linhas.push('')
      linhas.push('O SCA pode estar fora do ar ou fora de alcance desta maquina.')
      linhas.push('Isso e transitorio: nao registre como "a ferramenta nao funciona".')
      return { texto: linhas.join('\n') }
    }

    const token = http.lerSessao(cfg)
    if (token) {
      const exp = http.expiracaoDoToken(token)
      const restante = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : null
      linhas.push(`sessao     em cache${restante !== null ? `, expira em ${Math.floor(restante / 60)} min` : ''}`)

      // A foto do login envelhece; esta rota le o BANCO. Se alguem tiver sido
      // rebaixado ou desativado desde o login, e aqui que aparece, e nao no
      // token (que nem carrega perfil).
      try {
        const s = await http.autenticada(cfg, 'GET', '/login/sessao')
        const dados = s.dados || {}
        linhas.push(`quem       ${dados.administrador ? 'ADMINISTRADOR (passa em tudo)' : 'usuario comum'}`)
        const perfis = dados.perfis || {}
        const chaves = Object.keys(perfis)
        linhas.push(`perfis     ${chaves.length ? chaves.map(m => `${m}=${perfis[m]}`).join(' ') : '(nenhum modulo)'}`)
        if (!dados.administrador) {
          linhas.push('')
          linhas.push('Sem administrador, /usuarios e /acessos voltam 403. Deste CLI so')
          linhas.push('respondem: efetivo usuario meu-perfil e efetivo usuario trocar-senha.')
        }
      } catch (err) {
        linhas.push(`sessao     o token em cache NAO foi aceito (${err.message})`)
      }
    } else {
      linhas.push('sessao     nenhuma em cache (o proximo comando autenticado fara login)')
    }
    linhas.push(`cache em   ${caminhoSessao(cfg.server).arquivo}`)
    linhas.push(`usuario    ${cfg.usuario || '(nao definido; use SCA_USER)'}`)
    linhas.push(`cliente    ${cfg.cliente}`)
    return { texto: linhas.join('\n') }
  }

  // login
  const { token, administrador, perfis } = await http.autenticar(cfg)
  // --sem-cache pede para NAO tocar o disco. Gravar assim mesmo desmentia a
  // flag e ainda anunciava "sessao em cache" que o usuario tinha recusado.
  if (!cfg.semCache) http.gravarSessao(cfg, token)
  const exp = http.expiracaoDoToken(token)
  const minutos = exp ? Math.floor((exp - Math.floor(Date.now() / 1000)) / 60) : 60

  const chaves = Object.keys(perfis || {})
  const quem = administrador
    ? 'administrador (passa em qualquer modulo)'
    : chaves.length
      ? `usuario comum, com perfil em: ${chaves.map(m => `${m}=${perfis[m]}`).join(' ')}`
      : 'usuario comum, SEM perfil em modulo nenhum'

  // Este CLI e quase todo admin-only, e por isso o aviso e diferente do dos
  // irmaos: la a falta de perfil no modulo e o que barra; aqui e a falta do
  // administrador global, que nao se resolve ganhando perfil em modulo nenhum.
  const avisos = administrador
    ? []
    : ['Autenticado, porem NAO administrador: /api/usuarios e /api/acessos vao voltar ' +
       '403 (sao rotas de plataforma, guardadas por verifyAdmin, e nao existe ' +
       '"administrador de modulo"). Continuam funcionando: efetivo usuario meu-perfil e ' +
       'efetivo usuario trocar-senha.']

  const cauda = cfg.semCache
    ? '--sem-cache: o token NAO foi gravado, o proximo comando autentica de novo.'
    : `Sessao em cache por ~${minutos} min, compartilhada com os CLIs irmaos.`

  return {
    texto: `Autenticado em ${cfg.server} como ${cfg.usuario}, ${quem}, cliente ${cfg.cliente}. ${cauda}`,
    avisos
  }
}

module.exports = { executar, precisaServidor: true }
