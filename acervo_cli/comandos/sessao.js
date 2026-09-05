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
  //
  // `acervo schema` lista `login` entre os RECURSOS, com a operacao `autenticar`
  // e a forma `acervo <recurso> <operacao> [--data '{...}']`. Mas o ROTEADOR e
  // consultado ANTES de RECURSOS (acervo.js), entao
  // `acervo login autenticar --data '{...}' --dry-run` cai AQUI: o corpo e o
  // ensaio nao chegam a lugar nenhum. Sumir com eles em silencio faz a pessoa
  // acreditar que ensaiou; o aviso e o que a manda para o caminho certo.
  const avisos = []
  const ignoradas = ['data', 'data-file', 'dry-run'].filter(f => args.flags[f] !== undefined)
  if (ignoradas.length) {
    avisos.push(
      `acervo login nao usa ${ignoradas.map(f => '--' + f).join(' nem ')}. ` +
      'Ele autentica com SCA_USER/SCA_SENHA (ou --user e --senha) e guarda o token em ' +
      'cache; a operacao "autenticar" que o `acervo schema login` mostra e a MESMA rota, ' +
      'e este comando e o atalho dela.'
    )
  }

  let sessao
  try {
    sessao = await http.autenticar(cfg)
  } catch (err) {
    // O aviso precisa sair mesmo quando o login falha, que e justamente o caso
    // medido: sem credencial no ambiente a resposta e "Faltam credenciais", e
    // sem isto ninguem descobre que o --data foi ignorado.
    if (avisos.length) err.avisos = [...(err.avisos || []), ...avisos]
    throw err
  }
  const { token, administrador, perfis } = sessao
  // --sem-cache pede para NAO tocar o disco. Gravar assim mesmo desmentia a
  // flag e ainda anunciava "sessao em cache" que o usuario tinha recusado.
  if (!cfg.semCache) http.gravarSessao(cfg, token)
  const exp = http.expiracaoDoToken(token)
  const minutos = exp ? Math.floor((exp - Math.floor(Date.now() / 1000)) / 60) : 60

  // O acesso e por PERFIL no modulo: consulta le, operador cataloga, gerente
  // apaga. Administrador e global e passa em tudo.
  const NIVEL = { 1: 'consulta', 2: 'operador', 3: 'gerente' }
  const nivel = NIVEL[perfis.acervo] || null
  const quem = administrador
    ? 'administrador (passa em qualquer modulo)'
    : nivel
      ? `perfil ${nivel} no modulo acervo`
      : 'SEM perfil no modulo acervo'

  if (!administrador && !nivel) {
    avisos.push(
      'Autenticado, porem sem perfil no modulo acervo: as rotas vao voltar 403. ' +
      'Peca ao administrador para conceder o perfil.'
    )
  } else if (!administrador && perfis.acervo === 1) {
    avisos.push(
      'Perfil de consulta: leitura e download funcionam, mas catalogar (criar, ' +
      'editar, mover, carga) exige operador e excluir exige gerente.'
    )
  }

  const cauda = cfg.semCache
    ? '--sem-cache: o token NAO foi gravado, o proximo comando autentica de novo.'
    : `Sessao em cache por ~${minutos} min; os proximos comandos nao pedem senha.`

  return {
    texto: `Autenticado em ${cfg.server} como ${cfg.usuario}, ${quem}, ` +
      `cliente ${cfg.cliente}. ${cauda}`,
    avisos
  }
}

module.exports = { executar, precisaServidor: true }
