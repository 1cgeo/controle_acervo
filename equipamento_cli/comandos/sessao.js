'use strict'

// `equipamento login`, `equipamento logout`, `equipamento status`.
//
// O token do SCA vale 1 hora. Sem cache, cada invocacao do CLI faz um POST
// /api/login novo: numa sessao de oito lancamentos sao oito autenticacoes, e a
// senha precisa estar no ambiente o tempo todo. Com cache, autentica uma vez.
//
// O cache e o MESMO dos CLIs irmaos (~/.sca/sessao-<servidor>.json): o token
// vale para a API inteira, e quem ja logou pelo orcamento nao loga de novo aqui.

const http = require('../lib/http')
const { caminhoSessao } = require('../lib/config')

const NIVEL = { 1: 'consulta', 2: 'operador', 3: 'gerente' }

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

  const nivel = NIVEL[perfis.equipamento] || null
  const quem = administrador
    ? 'administrador (passa em qualquer módulo)'
    : nivel
      ? `perfil ${nivel} no módulo equipamento`
      : 'SEM perfil no módulo equipamento'

  // O perfil e lido do BANCO a cada requisicao pelo verifyPerfil, e nao do
  // token: este aviso vale para o instante do login, e um rebaixamento passa a
  // valer na hora seguinte sem novo login.
  const avisos = administrador || nivel
    ? []
    : ['Autenticado, porém sem perfil no módulo equipamento: as rotas vão voltar 403. ' +
       'Peça ao administrador para conceder o perfil.']

  if (nivel === 'consulta') {
    avisos.push('Perfil de consulta lê tudo, mas não lança nada: abrir, fechar, editar e apagar voltarão 403.')
  }
  if (nivel === 'operador') {
    avisos.push('Perfil de operador lança indisponibilidade, afastamento e manutenção, e cadastra tipo. ' +
      'Mexer na carga (cadastrar, alterar, baixar e apagar o bem, e transferência) é de gerente.')
  }

  const cauda = cfg.semCache
    ? '--sem-cache: o token NÃO foi gravado, o próximo comando autentica de novo.'
    : `Sessão em cache por ~${minutos} min; os próximos comandos não pedem senha.`

  return {
    texto: `Autenticado em ${cfg.server} como ${cfg.usuario}, ${quem}. ${cauda}`,
    avisos
  }
}

module.exports = { executar, precisaServidor: true }
