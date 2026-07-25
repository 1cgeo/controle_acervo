// Path: comandos\sessao.js
'use strict'

// `mapoteca login`, `mapoteca logout`, `mapoteca status`.
//
// Sem cache, cada invocacao do CLI faz um POST /api/login novo: cadastrar um
// pedido com trinta itens seriam trinta e tantas autenticacoes, e a senha
// precisaria estar no ambiente o tempo todo. Com cache, autentica uma vez.
//
// Isso NAO economiza contexto (o login nunca foi verboso). Economiza latencia,
// reduz a exposicao da credencial e mantem folga no limite de requisicoes por
// minuto, que sao motivos suficientes por si.

const http = require('../lib/http')
const { caminhoSessao } = require('../lib/config')

async function executar (args, cfg) {
  const comando = args._[0]

  if (comando === 'logout') {
    const removeu = http.limparSessao(cfg)
    return {
      texto: removeu
        ? `Sessao encerrada para ${cfg.server}.`
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
    } else {
      linhas.push('sessao     nenhuma em cache (o proximo comando autenticado fara login)')
    }
    linhas.push(`cache em   ${caminhoSessao(cfg.server).arquivo}`)
    linhas.push(`usuario    ${cfg.usuario || '(nao definido; use SCA_USER)'}`)
    return { texto: linhas.join('\n') }
  }

  // login
  const { token, administrador } = await http.autenticar(cfg)
  http.gravarSessao(cfg, token)
  const exp = http.expiracaoDoToken(token)
  const minutos = exp ? Math.floor((exp - Math.floor(Date.now() / 1000)) / 60) : 60

  const avisos = []
  if (!administrador) {
    // O SCA deixa qualquer usuario logado LER a mapoteca, mas toda escrita exige
    // administrador. Dizer isso agora e mais barato que descobrir no 403 depois
    // de montar um plano inteiro.
    avisos.push(
      'Usuario autenticado, porem NAO e administrador: leitura funciona, ' +
      'mas cadastrar, atualizar e excluir vao voltar 403.'
    )
  }

  return {
    texto: `Autenticado em ${cfg.server} como ${cfg.usuario}` +
      `${administrador ? ' (admin)' : ''}. ` +
      `Sessao em cache por ~${minutos} min; os proximos comandos nao pedem senha.`,
    avisos
  }
}

module.exports = { executar, precisaServidor: true }
