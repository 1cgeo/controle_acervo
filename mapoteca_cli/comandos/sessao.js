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
  const { token, administrador, perfis } = await http.autenticar(cfg)
  http.gravarSessao(cfg, token)
  const exp = http.expiracaoDoToken(token)
  const minutos = exp ? Math.floor((exp - Math.floor(Date.now() / 1000)) / 60) : 60

  // Desde 2026-07-25 o acesso e por PERFIL no modulo mapoteca: consulta ve,
  // operador imprime e da baixa no material, gerente cadastra pedido e exclui.
  // Administrador e global e passa em tudo. Dizer isso agora e mais barato que
  // descobrir no 403 depois de montar um plano inteiro.
  const NIVEL = { 1: 'consulta', 2: 'operador', 3: 'gerente' }
  const nivel = NIVEL[perfis.mapoteca] || null
  const quem = administrador
    ? 'administrador (passa em qualquer modulo)'
    : nivel
      ? `perfil ${nivel} no modulo mapoteca`
      : 'SEM perfil no modulo mapoteca'

  const avisos = []
  if (!administrador && !nivel) {
    avisos.push(
      'Autenticado, porem sem perfil no modulo mapoteca: as rotas vao voltar 403. ' +
      'Peca ao administrador para conceder o perfil.'
    )
  } else if (!administrador && perfis.mapoteca === 1) {
    avisos.push(
      'Perfil de consulta: leitura funciona, mas imprimir exige operador e ' +
      'cadastrar pedido, cliente ou anexo exige gerente.'
    )
  } else if (!administrador && perfis.mapoteca === 2) {
    avisos.push(
      'Perfil de operador: imprimir e dar baixa em material funcionam, mas ' +
      'cadastrar pedido, cliente ou anexo exige gerente.'
    )
  }

  return {
    texto: `Autenticado em ${cfg.server} como ${cfg.usuario}, ${quem}. ` +
      `Sessao em cache por ~${minutos} min; os proximos comandos nao pedem senha.`,
    avisos
  }
}

module.exports = { executar, precisaServidor: true }
