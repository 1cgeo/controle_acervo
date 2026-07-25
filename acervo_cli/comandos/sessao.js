// Path: comandos\sessao.js
'use strict'

// `acervo login`, `acervo logout`, `acervo status`.
//
// O token do SCA vale cerca de 1 hora. Sem cache, cada invocacao do CLI faz um
// POST /api/login novo: numa auditoria de trinta correcoes sao trinta
// autenticacoes, e a senha precisa estar no ambiente o tempo todo. Com cache,
// autentica uma vez.
//
// Isso NAO economiza contexto (o login nunca foi verboso). Economiza latencia,
// folga contra o limite de 200 requisicoes por minuto e exposicao da credencial,
// que sao motivos suficientes por si.

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
      linhas.push('As rotas de leitura publicas (acervo cobertura, acervo finalizados)')
      linhas.push('tambem passam por aqui, entao elas caem junto.')
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
    linhas.push(`cliente    ${cfg.cliente}`)
    return { texto: linhas.join('\n') }
  }

  // login
  const { token, administrador } = await http.autenticar(cfg)
  http.gravarSessao(cfg, token)
  const exp = http.expiracaoDoToken(token)
  const minutos = exp ? Math.floor((exp - Math.floor(Date.now() / 1000)) / 60) : 60

  const avisos = administrador
    ? []
    : [
        'Usuario autenticado, porem NAO e administrador. Toda escrita no SCA ' +
        '(editar, excluir, mover, carga) vai voltar 403; a leitura de acervo funciona.'
      ]

  return {
    texto: `Autenticado em ${cfg.server} como ${cfg.usuario}` +
      `${administrador ? ' (admin)' : ' (nao-admin)'}, cliente ${cfg.cliente}. ` +
      `Sessao em cache por ~${minutos} min; os proximos comandos nao pedem senha.`,
    avisos
  }
}

module.exports = { executar, precisaServidor: true }
