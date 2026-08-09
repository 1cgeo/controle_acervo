'use strict'

// As perguntas de acompanhamento da mapoteca, que nao sao CRUD:
//
//   mapoteca pendentes                 a fila em aberto, ordenada pelo prazo
//   mapoteca painel [--ano 2026]       o resumo anual (pedidos, entregas, OMs, custo)
//   mapoteca relatorio [aba] [--ano]   as abas da planilha de controle
//   mapoteca localizador ABCD-EFGH-IJKL   consulta publica de um pedido
//
// `pendentes` existe porque a pergunta proativa do chefe ("o que esta vencendo?")
// hoje custa baixar a lista inteira de pedidos e filtrar do lado de fora. O
// servidor ja calcula atraso e dias ate o prazo: e so pedir a visao certa.
//
// Nenhum relatorio e remontado aqui. O servidor ja sabe montar cada aba, em JSON
// e em CSV; o CLI escolhe a rota, recorta as colunas e, quando pedido, grava o
// CSV em disco (nunca no stdout: sao milhares de linhas na janela do agente).

const fs = require('fs')

const http = require('../lib/http')
const saida = require('../lib/saida')
const argsLib = require('../lib/args')
const esquema = require('../lib/schema')
const { RELATORIOS } = require('../lib/recursos')

function anoCorrente () {
  return new Date().getFullYear()
}

// Nome do mes no nome do arquivo do Anuario, como nos que ja subiram para a DSG.
const NOME_MES = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

// ---------------------------------------------------------------------------

async function pendentes (args, cfg) {
  const flags = args.flags
  const r = await http.autenticada(cfg, 'GET', '/mapoteca/dashboard/pending_orders')
  let linhas = Array.isArray(r.dados) ? r.dados : []

  const dias = argsLib.numero(flags, 'dias', null)
  if (dias !== null) {
    // Recorte de proximidade: "o que vence nos proximos N dias" inclui o que ja
    // venceu (dias_ate_prazo negativo), porque atrasado e mais urgente que a
    // vencer, nunca menos.
    linhas = linhas.filter(l => l.dias_ate_prazo !== null && l.dias_ate_prazo <= dias)
  }

  const out = saida.lista(linhas, {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: [
      'id', 'data_pedido', 'prazo', 'dias_ate_prazo', 'atrasado',
      'cliente_nome', 'situacao_nome', 'documento_solicitacao', 'quantidade_produtos'
    ]
  })

  const atrasados = linhas.filter(l => l.atrasado === true).length
  const semPrazo = linhas.filter(l => l.prazo === null).length
  const rodape = `\n${linhas.length} pedido(s) em aberto; ${atrasados} atrasado(s), ` +
    `${semPrazo} sem prazo registrado.`

  return {
    texto: out.texto + rodape,
    avisos: [
      ...out.avisos,
      'Esta visao traz apenas pedidos de cliente MILITAR e exclui concluidos e cancelados ' +
      '(e o recorte que o servidor faz). Pedido civil ou de LAI nao aparece aqui.'
    ]
  }
}

// ---------------------------------------------------------------------------

async function painel (args, cfg) {
  const flags = args.flags
  const ano = argsLib.numero(flags, 'ano', anoCorrente())

  const r = await http.autenticada(
    cfg, 'GET', '/mapoteca/dashboard/resumo_anual' + http.query({ ano })
  )
  const d = r.dados || {}

  if (flags.json) return { texto: JSON.stringify(d, null, 2) }

  const linhas = [
    `Mapoteca ${ano}`,
    '',
    `  pedidos recebidos      ${d.total_pedidos ?? '-'}`,
    `  produtos entregues     ${d.total_entregas ?? '-'}`,
    `  OMs atendidas          ${d.oms_distintas_count ?? '-'}`,
    `  operacoes apoiadas     ${d.operacoes_distintas_count ?? '-'}`,
    `  custo de manutencao    R$ ${saida.moeda(d.custo_manutencao_total)}`,
    '',
    'A fila de hoje: mapoteca pendentes',
    `Detalhe por aba: mapoteca relatorio detalhado --ano ${ano}`
  ]
  return { texto: linhas.join('\n') }
}

// ---------------------------------------------------------------------------

async function relatorio (args, cfg) {
  const flags = args.flags
  const aba = args._[1]

  if (!aba) {
    const largura = Math.max(...Object.keys(RELATORIOS).map(k => k.length))
    return {
      texto: [
        'Abas disponiveis: mapoteca relatorio <aba> [--ano 2026] [--csv arquivo.csv]',
        '',
        ...Object.entries(RELATORIOS).map(
          ([k, v]) => `  ${k.padEnd(largura)}  ${v.nome}${v.ods ? '  [tem --ods]' : ''}`
        ),
        '',
        'O padrao e TSV recortado no terminal; --csv grava o CSV do proprio servidor',
        'em disco, com os rotulos de coluna da planilha de controle. A aba marcada',
        'com [tem --ods] tambem sai como planilha, no vocabulario da aba do RTM.'
      ].join('\n')
    }
  }

  const alvo = RELATORIOS[aba]
  if (!alvo) {
    throw new Error(
      `Aba desconhecida: "${aba}". Disponiveis: ${Object.keys(RELATORIOS).join(', ')}.`
    )
  }

  const ano = argsLib.numero(flags, 'ano', anoCorrente())

  // O .ods de uma aba tem rota propria, e nao um ?formato=ods: o conteudo nao e
  // o mesmo do CSV. So a aba `impressao` tem essa rota hoje.
  if (flags.ods) {
    if (!alvo.ods) {
      throw new Error(
        `A aba "${aba}" nao tem versao .ods no servidor. Abas com .ods: ` +
        `${Object.keys(RELATORIOS).filter(k => RELATORIOS[k].ods).join(', ')}. ` +
        `Para as demais, use --csv.`
      )
    }
    const destino = flags.ods === true ? `META4_DETALHADA_${ano}.ods` : flags.ods
    const r = await http.autenticada(
      cfg, 'GET', alvo.ods + http.query({ ano }), { binario: true }
    )
    fs.writeFileSync(destino, r.bytes)
    return {
      texto: `Aba "${aba}" de ${ano} salva em ${destino} (${r.bytes.length} bytes).`
    }
  }

  // CSV vai direto para o arquivo, nunca para o stdout: um relatorio detalhado
  // de um ano passa de mil linhas, e despeja-las na janela do agente gasta o
  // contexto inteiro para responder uma pergunta que ele nem fez.
  if (flags.csv) {
    const destino = flags.csv === true ? `mapoteca-${aba}-${ano}.csv` : flags.csv
    const r = await http.autenticada(
      cfg, 'GET', alvo.caminho + http.query({ ano, formato: 'csv' }), { binario: true }
    )
    fs.writeFileSync(destino, r.bytes)
    return {
      texto: `Relatorio "${aba}" de ${ano} salvo em ${destino} (${r.bytes.length} bytes).`
    }
  }

  const r = await http.autenticada(cfg, 'GET', alvo.caminho + http.query({ ano }))
  const dados = Array.isArray(r.dados) ? r.dados : (r.dados ? [r.dados] : [])

  const out = saida.lista(dados, {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    // Sem colunas padrao: o recorte de um relatorio depende da pergunta, e
    // escolher por ele aqui esconderia justamente a coluna que ele foi buscar.
    padrao: null
  })

  const avisos = [...out.avisos]
  if (!flags.campos && dados.length > 30) {
    avisos.push(
      `Saida longa (${dados.length} linhas). Recorte com --campos, ou grave o CSV: ` +
      `mapoteca relatorio ${aba} --ano ${ano} --csv`
    )
  }
  return { texto: out.texto, avisos }
}

// ---------------------------------------------------------------------------

// O Anuario Estatistico (Tabela 5.4.9 do "O Exercito em Numeros"), que sobe
// para a DSG junto com o RTM. Nao entra no catalogo RELATORIOS porque nao e uma
// aba da planilha de controle: e outro documento, com outro destinatario, e
// exige o MES alem do ano.
//
// A rota mora sob /api/rpcmtec, e nao sob /api/mapoteca: o Anuario e o RPCMTec
// sobem no mesmo envio mensal. O DADO e da mapoteca (o `anuario_ctrl` fica la),
// e por isso o verbo vive neste CLI.
//
// A GUARDA E `verifyGerente`, e nao verifyAdmin: mudou em 2026-08-08, junto com
// o resto da LEITURA do RPCMTec. Vale administrador global OU gerente de
// QUALQUER modulo, e nao perfil na mapoteca -- o operador que lanca a impressao
// nao baixa esta planilha.
const CAMINHO_ANUARIO = '/rpcmtec/anuario'

async function anuario (args, cfg) {
  const flags = args.flags
  const ano = argsLib.numero(flags, 'ano', anoCorrente())
  const mes = argsLib.numero(flags, 'mes', null)
  if (mes === null) {
    throw new Error('Informe o mes: mapoteca anuario --ano 2026 --mes 7')
  }

  if (flags.ods) {
    const mm = String(mes).padStart(2, '0')
    const destino = flags.ods === true
      ? `Anuario_Estatistico_1CGEO_${mm}_${NOME_MES[mes - 1]}_${ano}.ods`
      : flags.ods
    const r = await http.autenticada(
      cfg, 'GET', CAMINHO_ANUARIO + '/ods' + http.query({ ano, mes }),
      { binario: true }
    )
    fs.writeFileSync(destino, r.bytes)
    return { texto: `Anuario de ${String(mes).padStart(2, '0')}/${ano} salvo em ${destino} (${r.bytes.length} bytes).` }
  }

  const r = await http.autenticada(
    cfg, 'GET', CAMINHO_ANUARIO + http.query({ ano, mes })
  )
  const a = r.dados || {}
  if (flags.json) return { texto: JSON.stringify(a, null, 2) }

  const linhas = [
    a.total_convencional, ...(a.convencional || []),
    a.total_digital, ...(a.digital || [])
  ].filter(Boolean)

  const out = saida.lista(linhas, {
    formato: flags.formato || 'tsv',
    campos: argsLib.lista(flags.campos),
    padrao: [
      'rotulo', 'exercito', 'rm', 'ee_exercito', 'outras_forcas',
      'orgao_publico', 'empresa_privada', 'prof_autonomo'
    ]
  })

  // A lacuna vai junto do numero, e nao num rodape que ninguem le: celula vazia
  // aqui quer dizer "o SCA nao tem essa fonte", e nao "nao houve entrega".
  const rodape = ['', 'O que o SCA nao sabe preencher:']
    .concat((a.lacunas || []).map(l => `  - ${l}`))
  return {
    texto: [out.texto].concat(rodape).join('\n'),
    avisos: out.avisos
  }
}

// ---------------------------------------------------------------------------

async function localizador (args, cfg) {
  const flags = args.flags
  const codigo = String(args._[1] || '').toUpperCase()
  if (!codigo) {
    throw new Error('Informe o localizador: mapoteca localizador ABCD-EFGH-IJKL')
  }

  const m = require('../lib/recursos').carregarSchema()
  const v = esquema.validarCorpo(m.pedidoLocalizador, { localizador: codigo })
  if (!v.ok) {
    const erro = new Error(esquema.explicarErro(
      m.pedidoLocalizador, v.erros,
      'O localizador tem a forma XXXX-XXXX-XXXX (letras maiusculas e digitos).'
    ))
    erro.jaFormatado = true
    throw erro
  }

  // Rota publica: nao exige login. E a mesma que o solicitante usa para
  // acompanhar o pedido dele.
  const r = await http.requisitar(cfg, 'GET', `/mapoteca/pedido/localizador/${codigo}`)
  const p = r.dados || {}

  if (flags.json) return { texto: JSON.stringify(p, null, 2) }

  const cabecalho = saida.registro(p, {
    campos: [
      'localizador_pedido', 'data_pedido', 'situacao_pedido_nome', 'cliente_nome',
      'prazo', 'localizador_envio', 'observacao_envio', 'motivo_cancelamento',
      // A forma de entrega e a data de atendimento sao do PEDIDO, nunca do item.
      'forma_entrega_nome', 'data_atendimento'
    ]
  })
  const produtos = Array.isArray(p.produtos) ? p.produtos : []
  const out = saida.lista(produtos, {
    formato: flags.formato || 'tsv',
    padrao: ['mi', 'produto_nome', 'escala', 'quantidade', 'tipo_midia_nome']
  })

  return { texto: `${cabecalho}\n\n${out.texto}`, avisos: out.avisos }
}

// ---------------------------------------------------------------------------

const VERBOS = { pendentes, painel, relatorio, anuario, localizador }

async function executar (args, cfg) {
  const fn = VERBOS[args._[0]]
  if (!fn) throw new Error(`Comando de acompanhamento desconhecido: ${args._[0]}`)
  return fn(args, cfg)
}

// `mapoteca relatorio` sem aba so lista as abas, e isso sai da registry local.
module.exports = {
  executar,
  precisaServidor: args => !(args._[0] === 'relatorio' && !args._[1]),
  VERBOS
}
