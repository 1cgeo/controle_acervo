'use strict'

const http = require('../lib/http')
const { caminhoSessao } = require('../lib/config')

// login, logout e status. O SAG nao emite token: quem sustenta a sessao e o
// cookie do PHP, e por isso `status` prova a sessao pedindo uma pagina real,
// nunca olhando o relogio de um arquivo local.

async function executar (args, cfg) {
  const comando = args._[0]

  if (comando === 'logout') {
    const apagou = http.apagarCache(cfg)
    return {
      texto: apagou
        ? 'Sessao do SAG descartada.'
        : 'Nao havia sessao em cache para descartar.'
    }
  }

  if (comando === 'login') {
    await http.autenticar(cfg)
    const { arquivo } = caminhoSessao(cfg.server)
    return {
      texto: `Autenticado no SAG. Cookie de sessao em cache.\ncache: ${arquivo}`
    }
  }

  // status
  const linhas = []
  const cache = http.lerCache(cfg)
  linhas.push(`servidor   ${cfg.server}`)
  linhas.push(`usuario    ${cfg.usuario ? 'SAG_USUARIO definido' : '(ausente)'}`)
  linhas.push(`senha      ${cfg.senha ? 'SAG_SENHA definida' : '(ausente)'}`)
  linhas.push(`cache      ${cache ? `presente, de ${cache.em}` : 'ausente'}`)

  if (cache) {
    const sessao = new http.Sessao(cfg)
    sessao.cookies = new Map(cache.cookies)
    const viva = await http.autenticada(sessao)
    linhas.push(`sessao     ${viva ? 'valida' : 'expirada (rode: sag login)'}`)
  } else {
    // Sem cache, provar o alcance ainda vale: distingue "falta logar" de
    // "a maquina nao chega no SAG", que sao problemas diferentes.
    const sessao = new http.Sessao(cfg)
    await sessao.requisitar('GET', '/index.php')
    linhas.push('sessao     ausente, mas o SAG respondeu (rode: sag login)')
  }

  return { texto: linhas.join('\n') }
}

module.exports = { executar, precisaServidor: true }
