// Path: comandos\relatorio.js
'use strict'

// Os dois verbos de INTENCAO do dia a dia orcamentario:
//
//   orcamento saldo  [--nd 339040] [--ano 2026] [--mes 7] [--extra]
//   orcamento secao3 [--ano 2026] [--mes 7] [--mes-apenas] [--docx arquivo.docx]
//
// `saldo` existe porque a pergunta mais frequente ("quanto falta empenhar da ND
// X?") hoje custa um snapshot inteiro de sete tabelas para ser respondida em uma
// linha. Ele deriva da MESMA rota <base>/secao3 que o resto usa: nao ha
// regra de negocio duplicada aqui, so recorte de apresentacao.
//
// `secao3` delega a renderizacao ao servidor (/secao3/markdown e /secao3/docx),
// que ja sabe montar as sete tabelas. O CLI nao remonta tabela nenhuma.

const fs = require('fs')

const http = require('../lib/http')
const saida = require('../lib/saida')
const argsLib = require('../lib/args')
const { obter } = require('../lib/recursos')

// A base da rota sai da registry, nunca escrita a mao aqui: ela ganhou o
// prefixo /orcamento na fusao de 2026-07-27, e um caminho literal neste arquivo
// teria sobrevivido em silencio ate o primeiro 404.
const BASE = obter('relatorio').caminho

function agora () {
  const d = new Date()
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 }
}

/** Le o campo com split PDR/Extra, caindo no total quando o servidor for antigo. */
function valor (linha, base, faixa) {
  const especifico = linha[`${base}_${faixa}`]
  if (especifico !== undefined && especifico !== null) return Number(especifico) || 0
  // Servidor anterior a 2026-06-15 nao separava PDR de Extra-PDR, e o
  // comportamento de entao era PDR-only: o total equivale ao PDR.
  if (faixa === 'pdr') return Number(linha[base]) || 0
  return 0
}

async function saldo (args, cfg) {
  const flags = args.flags
  const hoje = agora()
  const ano = argsLib.numero(flags, 'ano', hoje.ano)
  const mes = argsLib.numero(flags, 'mes', hoje.mes)
  const faixa = flags.extra ? 'extra' : 'pdr'

  const r = await http.autenticada(cfg, 'GET', BASE + '/secao3' + http.query({
    ano, mes, cumulativo: true
  }))

  const tabela = (r.dados && r.dados.tabela_31) || []
  if (!tabela.length) {
    return { texto: `Sem execucao registrada em ${ano} ate o mes ${String(mes).padStart(2, '0')}.` }
  }

  const filtroNd = flags.nd && flags.nd !== true ? String(flags.nd) : null
  const linhas = filtroNd
    ? tabela.filter(l => String(l.cod_nd) === filtroNd)
    : tabela.filter(l => l.cod_nd === 'TOTAL')

  if (!linhas.length) {
    const disponiveis = tabela.filter(l => l.cod_nd !== 'TOTAL').map(l => l.cod_nd).join(', ')
    return { texto: `ND ${filtroNd} nao aparece na execucao de ${ano}. NDs com movimento: ${disponiveis}` }
  }

  const out = []
  const rotuloFaixa = faixa === 'extra' ? 'Extra-PDR' : 'PDR'
  out.push(`Execucao ${rotuloFaixa} ${ano}, acumulado ate o mes ${String(mes).padStart(2, '0')}`)
  out.push('')

  for (const linha of linhas) {
    const previsto = faixa === 'pdr' ? Number(linha.previsto) || 0 : 0
    const recebido = valor(linha, 'recebido', faixa)
    const recolhido = valor(linha, 'recolhido', faixa)
    const empenhado = valor(linha, 'empenhado', faixa)
    const liquidado = valor(linha, 'liquidado', faixa)

    const aEmpenhar = recebido - empenhado - recolhido
    const aLiquidar = empenhado - liquidado

    const rotulo = linha.cod_nd === 'TOTAL'
      ? 'TOTAL'
      : `ND ${linha.cod_nd}${linha.nd_nome ? ' - ' + linha.nd_nome : ''}`

    const pct = (parte, todo) => todo ? ` (${(100 * parte / todo).toFixed(1)}%)` : ''

    out.push(rotulo)
    if (faixa === 'pdr') out.push(`  previsto      R$ ${saida.moeda(previsto)}`)
    out.push(`  recebido      R$ ${saida.moeda(recebido)}${faixa === 'pdr' ? pct(recebido, previsto) : ''}`)
    if (recolhido) out.push(`  recolhido     R$ ${saida.moeda(recolhido)}`)
    out.push(`  empenhado     R$ ${saida.moeda(empenhado)}${pct(empenhado, recebido)}`)
    out.push(`  liquidado     R$ ${saida.moeda(liquidado)}${pct(liquidado, empenhado)}`)
    out.push(`  A EMPENHAR    R$ ${saida.moeda(aEmpenhar)}   (recebido - empenhado - recolhido)`)
    out.push(`  a liquidar    R$ ${saida.moeda(aLiquidar)}   (empenhado - liquidado)`)
    out.push('')
  }

  if (!filtroNd) {
    out.push('Por ND: orcamento saldo --nd 339040   |   Extra-PDR: orcamento saldo --extra')
  }
  return { texto: out.join('\n').trimEnd() }
}

async function secao3 (args, cfg) {
  const flags = args.flags
  const hoje = agora()
  const ano = argsLib.numero(flags, 'ano', hoje.ano)
  const mes = argsLib.numero(flags, 'mes', hoje.mes)
  const cumulativo = !flags['mes-apenas']

  // DOCX: o formato que o chefe cola no Google Docs. Sai binario, direto para o
  // arquivo; nunca para o stdout (seriam megabytes de lixo na janela do agente).
  if (flags.docx) {
    const destino = flags.docx === true
      ? `orcamento-secao3-${ano}-m${String(mes).padStart(2, '0')}.docx`
      : flags.docx
    const r = await http.autenticada(
      cfg, 'GET', BASE + '/secao3/docx' + http.query({ ano, mes }), { binario: true }
    )
    fs.writeFileSync(destino, r.bytes)
    return { texto: `Secao 3 (${ano}, ate o mes ${mes}) salva em ${destino} (${r.bytes.length} bytes).` }
  }

  if (flags.json) {
    const r = await http.autenticada(cfg, 'GET', BASE + '/secao3' + http.query({ ano, mes, cumulativo }))
    return { texto: JSON.stringify(r.dados, null, 2) }
  }

  // Markdown renderizado pelo proprio servidor: as sete tabelas ja montadas.
  const r = await http.autenticada(
    cfg, 'GET', BASE + '/secao3/markdown' + http.query({ ano, mes, cumulativo })
  )
  const texto = typeof r.dados === 'string'
    ? r.dados
    : (r.dados && (r.dados.markdown || r.dados.conteudo)) || JSON.stringify(r.dados, null, 2)

  const avisos = []
  if (!flags.docx) {
    avisos.push('Para colar no Google Docs, gere o DOCX: orcamento secao3 --ano ' + ano + ' --mes ' + mes + ' --docx')
  }
  return { texto, avisos }
}

async function executar (args, cfg) {
  const comando = args._[0]
  if (comando === 'saldo') return saldo(args, cfg)
  if (comando === 'secao3') return secao3(args, cfg)
  throw new Error(`Comando de relatorio desconhecido: ${comando}`)
}

module.exports = { executar, precisaServidor: true }
