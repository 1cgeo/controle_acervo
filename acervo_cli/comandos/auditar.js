'use strict'

// `acervo auditar` - os invariantes logicos do acervo, rodados no servidor.
//
//   acervo auditar                      todos, resumo por invariante
//   acervo auditar --severidade DEFECT  so o que TEM de dar zero
//   acervo auditar --check 2a,4b        so estes
//   acervo auditar --check 2a --amostra 50   as linhas, para ir consertar
//
// A lista de invariantes NAO mora aqui: mora em server/src/acervo/invariantes.js,
// ao lado do schema que eles descrevem. Este comando so pede, ordena e imprime.

const http = require('../lib/http')
const saida = require('../lib/saida')
const argsLib = require('../lib/args')

const SEVERIDADES = ['DEFECT', 'REVISAR', 'INFO']

// DEFECT primeiro: e o unico que exige acao.
const ORDEM = { DEFECT: 0, REVISAR: 1, INFO: 2 }

const AJUDA = `acervo auditar - invariantes logicos do acervo

  acervo auditar                         todos os invariantes, resumo
  acervo auditar --severidade DEFECT     so o que tem de dar ZERO
  acervo auditar --check 2a,4b           so estes
  acervo auditar --check 2a --amostra 50 as linhas, para ir consertar
  acervo auditar --json                  tudo, para encadear

O que cada severidade quer dizer:
  DEFECT   tem de dar zero. Qualquer linha e um dado errado no acervo.
  REVISAR  lente larga, para triagem humana. Achado NAO e necessariamente erro.
  INFO     estatistica de cobertura; nunca e erro.

Exige perfil de gerente no modulo acervo. E leitura pura (transacao READ ONLY no servidor).`

async function executar (args, cfg) {
  const flags = args.flags
  if (flags.ajuda || flags.help) return { texto: AJUDA }

  const severidade = flags.severidade && flags.severidade !== true
    ? String(flags.severidade).toUpperCase()
    : null
  if (severidade && !SEVERIDADES.includes(severidade)) {
    throw new Error(`--severidade aceita ${SEVERIDADES.join(', ')} (recebi "${flags.severidade}").`)
  }

  const checks = argsLib.lista(flags.check)
  const amostra = argsLib.numero(flags, 'amostra', 10)

  const params = { amostra }
  if (severidade) params.severidade = severidade
  if (checks) params.codigos = checks.join(',')

  const r = await http.autenticada(cfg, 'GET', '/acervo/auditoria' + http.query(params))
  const resultados = Array.isArray(r.dados) ? r.dados : []

  if (flags.json) return { texto: JSON.stringify(resultados, null, 2) }

  const avisos = []

  // Invariante que estourou nao pode se confundir com invariante que deu zero:
  // um diz "esta limpo", o outro diz "nao sei". A diferenca e a resposta.
  const quebrados = resultados.filter(x => x.erro)
  for (const q of quebrados) {
    avisos.push(`Invariante ${q.codigo} NAO RODOU (${q.erro}). Isto nao e "zero achados", e "nao verificado".`)
  }

  const rodaram = resultados.filter(x => !x.erro)

  // Pedido de UM invariante com amostra: mostrar as linhas, que e o que se vai
  // consertar. Pedido amplo: mostrar o placar, que e o que se vai triar.
  if (checks && checks.length === 1 && amostra > 0) {
    const alvo = rodaram[0]
    if (!alvo) return { texto: '(invariante nao rodou)', avisos }
    if (!alvo.total) {
      return { texto: `${alvo.codigo} [${alvo.severidade}] ${alvo.titulo}: 0 achados.`, avisos }
    }
    const out = saida.lista(alvo.amostra, {
      formato: flags.formato || 'tsv',
      campos: argsLib.lista(flags.campos)
    })
    const cabeca = `${alvo.codigo} [${alvo.severidade}] ${alvo.titulo}: ${alvo.total} achado(s)` +
      (alvo.truncada ? `, mostrando ${alvo.amostra.length}. Use --amostra N para mais.` : '.')
    return { texto: cabeca + '\n\n' + out.texto, avisos: [...avisos, ...out.avisos] }
  }

  const linhas = rodaram
    .slice()
    .sort((a, b) => (ORDEM[a.severidade] - ORDEM[b.severidade]) || a.codigo.localeCompare(b.codigo))
    .map(x => ({ codigo: x.codigo, severidade: x.severidade, achados: x.total, titulo: x.titulo }))

  const out = saida.lista(linhas, {
    formato: flags.formato || 'tsv',
    campos: argsLib.lista(flags.campos),
    padrao: ['codigo', 'severidade', 'achados', 'titulo']
  })

  const defeitos = rodaram.filter(x => x.severidade === 'DEFECT' && x.total > 0)
  const rodape = defeitos.length
    ? `\n${defeitos.length} invariante(s) DEFECT com achado: ${defeitos.map(d => d.codigo).join(', ')}.` +
      '\nDEFECT tem de dar zero. Veja as linhas com: acervo auditar --check <codigo> --amostra 50'
    : '\nNenhum DEFECT com achado.' + (quebrados.length ? ' (mas veja os avisos: nem tudo rodou)' : '')

  // Codigo de saida 1 quando ha DEFECT ou invariante que nao rodou: isto entra
  // em rotina, e rotina precisa poder falhar.
  return {
    texto: out.texto + rodape,
    avisos: [...avisos, ...out.avisos],
    codigo: (defeitos.length || quebrados.length) ? 1 : 0
  }
}

// A ajuda nao gasta rede nem credencial: e conhecimento do repositorio.
const precisaServidor = args => !(args.flags.ajuda || args.flags.help)

module.exports = { executar, precisaServidor, ajudaPropria: true }
