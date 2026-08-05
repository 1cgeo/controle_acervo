'use strict'

// `producao login`, `producao logout`, `producao status`.
//
// O token do SCA vale 1 hora. Sem cache, cada invocacao do CLI faz um POST
// /api/login novo: numa sessao de doze lancamentos de execucao sao doze
// autenticacoes, e a senha precisa estar no ambiente o tempo todo. Com cache,
// autentica uma vez.
//
// Isso NAO economiza contexto (o login nunca foi verboso). Economiza latencia e
// reduz a exposicao da credencial, que sao motivos suficientes por si.

const http = require('../lib/http')
const { caminhoSessao } = require('../lib/config')

// dominio.tipo_perfil: os niveis sao hierarquicos.
const NIVEL = { 1: 'consulta', 2: 'operador', 3: 'gerente' }

/**
 * O que a pessoa alcanca NESTA area, em uma frase. O CLI nao decide acesso (quem
 * decide e o servidor a cada requisicao), mas dizer isso no login evita o 403
 * que o agente leria como "a rota esta quebrada".
 */
function alcance (administrador, perfis) {
  if (administrador) {
    return 'administrador global: alcança tudo, inclusive escrever o PIT e o RPCMTec inteiro'
  }
  const gerenteEm = Object.entries(perfis || {})
    .filter(([, nivel]) => Number(nivel) >= 3)
    .map(([modulo]) => modulo)

  if (gerenteEm.length) {
    return `gerente em ${gerenteEm.join(', ')}: lê a meta e a EXECUÇÃO mensal do PIT. ` +
      'Escrever o PIT e alcançar o RPCMTec exigem administrador'
  }
  return 'sem gerência em módulo nenhum: lê a meta, o Extra-PIT, a mídia e a revisão. ' +
    'A execução mensal exige gerente, e o RPCMTec exige administrador'
}

async function executar (args, cfg) {
  const comando = args._[0]

  if (comando === 'logout') {
    const removeu = http.limparSessao(cfg)
    return {
      texto: removeu
        ? `Sessão encerrada para ${cfg.server}.`
        : `Não havia sessão em cache para ${cfg.server}.`
    }
  }

  if (comando === 'status') {
    const linhas = [`servidor   ${cfg.server}`]

    // Probe publico: nao exige credencial, so diz se o SCA esta de pe.
    try {
      const r = await http.requisitar(cfg, 'GET', '')
      const versao = r.dados && r.dados.database_version ? r.dados.database_version : '?'
      linhas.push(`backend    no ar (banco versão ${versao})`)
    } catch (err) {
      linhas.push(`backend    INACESSÍVEL (${err.message})`)
      linhas.push('')
      linhas.push('O SCA pode estar fora do ar ou fora de alcance desta máquina.')
      linhas.push('Isso é transitório: não registre como "a ferramenta não funciona".')
      return { texto: linhas.join('\n') }
    }

    const token = http.lerSessao(cfg)
    if (token) {
      const exp = http.expiracaoDoToken(token)
      const restante = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : null
      linhas.push(`sessão     em cache${restante !== null ? `, expira em ${Math.floor(restante / 60)} min` : ''}`)
    } else {
      linhas.push('sessão     nenhuma em cache (o próximo comando autenticado fará login)')
    }
    linhas.push(`cache em   ${caminhoSessao(cfg.server).arquivo}`)
    linhas.push(`usuário    ${cfg.usuario || '(não definido; use SCA_USER)'}`)
    return { texto: linhas.join('\n') }
  }

  // login
  const { token, administrador, perfis } = await http.autenticar(cfg)
  // --sem-cache pede para NAO tocar o disco. Gravar assim mesmo desmentia a flag
  // e ainda anunciava "sessao em cache" que o usuario tinha recusado.
  if (!cfg.semCache) http.gravarSessao(cfg, token)
  const exp = http.expiracaoDoToken(token)
  const minutos = exp ? Math.floor((exp - Math.floor(Date.now() / 1000)) / 60) : 60

  const perfilTexto = Object.entries(perfis || {})
    .map(([m, n]) => `${m}=${NIVEL[n] || n}`)
    .join(', ') || 'nenhum'

  const cauda = cfg.semCache
    ? '--sem-cache: o token NÃO foi gravado, o próximo comando autentica de novo.'
    : `Sessão em cache por ~${minutos} min; os próximos comandos não pedem senha.`

  return {
    texto: [
      `Autenticado em ${cfg.server} como ${cfg.usuario}.`,
      `perfis     ${perfilTexto}`,
      `alcance    ${alcance(administrador, perfis)}.`,
      cauda
    ].join('\n')
  }
}

module.exports = { executar, precisaServidor: true, alcance }
