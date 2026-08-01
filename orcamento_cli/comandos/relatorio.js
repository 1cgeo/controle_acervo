// Path: comandos\relatorio.js
'use strict'

// O verbo de INTENCAO do dia a dia orcamentario:
//
//   orcamento saldo [--nd 339040] [--ano 2026] [--mes 7] [--extra]
//
// `saldo` existe porque a pergunta mais frequente ("quanto falta empenhar da ND
// X?") custaria um snapshot inteiro para ser respondida em uma linha. Ele deriva
// da MESMA rota que o painel usa: nao ha regra de negocio duplicada aqui, so
// recorte de apresentacao.
//
// O COMANDO `secao3` SAIU em 2026-08-01. Ele gerava a secao do PDR do RPCMTec em
// markdown e em DOCX, e quem montava a edicao mensal colava esse arquivo dentro
// do que o outro CLI gerava. O RPCMTec passou a ser gerado inteiro num lugar so,
// fora dos modulos: use `acervo rpcmtec --ano N --mes M --docx`.

const http = require('../lib/http')
const saida = require('../lib/saida')
const argsLib = require('../lib/args')
const { obter } = require('../lib/recursos')

// A base da rota sai da registry, nunca escrita a mao aqui: ela ganhou o
// prefixo /orcamento na fusao de 2026-07-27, e um caminho literal neste arquivo
// teria sobrevivido em silencio ate o primeiro 404.
const BASE = obter('dashboard').caminho

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

  // A rota do painel devolve a LISTA de linhas por ND direto. Ate 2026-08-01 ela
  // era /orcamento/relatorio/secao3 e vinha embrulhada em { tabela_31 }, junto
  // com as outras seis tabelas da secao 3, que este comando nunca leu.
  const r = await http.autenticada(cfg, 'GET', BASE + '/execucao_nd' + http.query({
    ano, mes
  }))

  const tabela = Array.isArray(r.dados) ? r.dados : []
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

async function executar (args, cfg) {
  const comando = args._[0]
  if (comando === 'saldo') return saldo(args, cfg)
  if (comando === 'secao3') {
    throw new Error(
      'O comando `secao3` saiu em 2026-08-01: o RPCMTec passou a ser gerado ' +
      'inteiro num lugar so, fora dos modulos. Use: acervo rpcmtec --ano N --mes M --docx'
    )
  }
  throw new Error(`Comando de relatorio desconhecido: ${comando}`)
}

module.exports = { executar, precisaServidor: true }
