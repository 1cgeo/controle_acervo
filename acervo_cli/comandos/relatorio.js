'use strict'

// Os dois verbos do fechamento do mes:
//
//   acervo finalizados [--ano 2026] [--mes 7] [--mes-apenas] [--escala 50k]
//   acervo rpcmtec --ano 2026 --mes 7 [--pdf arquivo.pdf] [--anuario a.ods]
//
// `finalizados` responde "o que a DGEO entregou neste mes?" pela rota PUBLICA de
// integracao (nao gasta login) e ja recorta a saida: a rota devolve uma linha
// por versao com dezoito colunas, das quais seis respondem a pergunta.
//
// `rpcmtec` delega a montagem ao servidor, que ja sabe fazer o relatorio
// INTEIRO (acervo, mapoteca e orcamento). O CLI nao remonta tabela nenhuma: se
// uma subsecao mudar, muda no backend e o CLI acompanha sozinho. `--anuario`
// baixa o Anuario Estatistico do mesmo mes, que sobe para a DSG no mesmo envio.
//
// O documento pertence a uma EDICAO mensal, e nao ha rota que o gere sob
// demanda: este verbo acha a edicao do ano/mes na listagem e pede o documento
// dela pelo id. Sem edicao criada nao ha relatorio, e a mensagem diz como criar.
// Tudo aqui e ADMIN: o relatorio cruza os tres modulos e traz valor de credito.

const fs = require('fs')

const http = require('../lib/http')
const saida = require('../lib/saida')
const argsLib = require('../lib/args')
const dominios = require('../lib/dominios')

function agora () {
  const d = new Date()
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 }
}

async function finalizados (args, cfg) {
  const flags = args.flags
  const hoje = agora()
  const params = {
    ano: argsLib.numero(flags, 'ano', hoje.ano),
    mes: argsLib.numero(flags, 'mes', hoje.mes),
    cumulativo: !flags['mes-apenas']
  }
  if (flags.escala) params.tipo_escala_id = dominios.resolver('tipo_escala', flags.escala)
  if (flags.tipo) params.tipo_produto_id = dominios.resolver('tipo_produto', flags.tipo)

  const r = await http.requisitar(
    cfg, 'GET', '/integracao/acervo/produtos_finalizados' + http.query(params)
  )
  const dados = r.dados || {}

  if (flags.json) return { texto: JSON.stringify(dados, null, 2) }

  // A rota devolve um agregado alem da lista; qual chave carrega a lista pode
  // variar, entao pegamos o primeiro array que vier em vez de fixar o nome.
  const lista = Array.isArray(dados)
    ? dados
    : (Object.values(dados).find(v => Array.isArray(v)) || [])

  const periodo = params.cumulativo
    ? `${params.ano}, acumulado ate o mes ${String(params.mes).padStart(2, '0')}`
    : `${params.ano}, mes ${String(params.mes).padStart(2, '0')} isolado`

  if (!lista.length) {
    return { texto: `Nenhum produto finalizado em ${periodo}.` }
  }

  const out = saida.lista(lista, {
    formato: flags.formato || 'tsv',
    campos: argsLib.lista(flags.campos),
    padrao: ['mi', 'inom', 'nome', 'versao', 'escala', 'tipo_produto', 'data_edicao', 'lote', 'pit']
  })

  return {
    texto: `Produtos finalizados em ${periodo}\n\n${out.texto}`,
    avisos: [
      'O criterio e data_edicao (finalizacao), nao a data de cadastro no SCA: ' +
      'lote antigo carregado agora nao entra como producao do mes.',
      ...out.avisos
    ]
  }
}

/**
 * Acha o id da edicao mensal do ano/mes pedido.
 *
 * Nao ha rota que aceite (ano, mes): a listagem filtra so por ano, e o mes se
 * casa aqui. Edicao inexistente NAO se cria sozinha, porque abrir a edicao do
 * mes e ato de quem fecha o relatorio, e nao efeito de uma consulta.
 */
async function acharEdicao (cfg, ano, mes) {
  const r = await http.autenticada(cfg, 'GET', '/rpcmtec/' + http.query({ ano }))
  const edicoes = Array.isArray(r.dados) ? r.dados : []
  const achada = edicoes.find(e => Number(e.mes) === Number(mes))

  if (!achada) {
    const existentes = edicoes.length
      ? `Edicoes de ${ano} ja abertas, pelo mes: ${edicoes.map(e => e.mes).sort((a, b) => a - b).join(', ')}.`
      : `Nenhuma edicao de ${ano} foi aberta ainda.`
    throw new Error(
      `Nao ha edicao do RPCMTec para ${ano}-${String(mes).padStart(2, '0')}.\n` +
      existentes + '\n' +
      'O documento pertence a uma edicao mensal, e abrir a do mes e um ato ' +
      'deliberado. Para abrir:\n' +
      `  acervo rpcmtec criar --data '{"ano": ${ano}, "mes": ${mes}}'`
    )
  }
  return achada
}

async function rpcmtec (args, cfg) {
  const flags = args.flags
  const hoje = agora()
  const ano = argsLib.numero(flags, 'ano', hoje.ano)
  const mes = argsLib.numero(flags, 'mes', hoje.mes)
  const periodo = `${ano}-${String(mes).padStart(2, '0')}`

  // O Anuario Estatistico sai da planilha-semente da DSG, entao o arquivo ja e
  // o que sobe: nao ha o que reformatar depois. E o unico dos tres que nao passa
  // pela edicao mensal, porque a rota dele recebe ano e mes direto.
  if (flags.anuario) {
    const destino = flags.anuario === true
      ? `Anuario_Estatistico_1CGEO_${String(mes).padStart(2, '0')}_${ano}.ods`
      : flags.anuario
    const r = await http.autenticada(
      cfg, 'GET', '/rpcmtec/anuario/ods' + http.query({ ano, mes }), { binario: true }
    )
    fs.writeFileSync(destino, r.bytes)
    return { texto: `Anuario Estatistico ${periodo} salvo em ${destino} (${r.bytes.length} bytes).` }
  }

  const edicao = await acharEdicao(cfg, ano, mes)

  // PDF: sai binario, direto para o arquivo; nunca para o stdout (seriam
  // megabytes de lixo na janela do agente).
  if (flags.pdf) {
    const destino = flags.pdf === true ? `RPCMTec-${periodo}.pdf` : flags.pdf
    const r = await http.autenticada(
      cfg, 'GET', `/rpcmtec/${encodeURIComponent(edicao.id)}/pdf`, { binario: true }
    )
    fs.writeFileSync(destino, r.bytes)
    return { texto: `RPCMTec ${periodo} salvo em ${destino} (${r.bytes.length} bytes).` }
  }

  const r = await http.autenticada(
    cfg, 'GET', `/rpcmtec/${encodeURIComponent(edicao.id)}/documento`
  )
  if (flags.json) return { texto: JSON.stringify(r.dados, null, 2) }

  const dados = r.dados || {}

  // Uma tabela por subsecao, na numeracao do documento da Divisao. As celulas ja
  // vem em TEXTO do servidor; o CLI so as desenha, e por isso nao pode divergir
  // do PDF no arredondamento. Subsecao de TEXTO nao tem cabecalho nem linhas.
  const blocos = [`RPCMTec ${periodo}   edicao ${edicao.id}   ${dados.fechada ? 'FECHADA' : 'aberta'}`, '']
  for (const secao of (dados.secoes || [])) {
    blocos.push(secao.titulo)
    for (const sub of (secao.subsecoes || [])) {
      const titulo = `\n${sub.numero}. ${sub.titulo || ''}`.trimEnd()
      if (!sub.cabecalhos) {
        blocos.push(`${titulo}\n${sub.texto || '(nao preenchida)'}`)
        continue
      }
      const linhas = (sub.linhas && sub.linhas.length)
        ? sub.linhas
        : [sub.cabecalhos.map(() => '-')]
      blocos.push(`${titulo}\n` + [sub.cabecalhos, ...linhas].map(l => l.join('\t')).join('\n'))
    }
    blocos.push('')
  }

  const avisos = [
    `Para o documento pronto: acervo rpcmtec --ano ${ano} --mes ${mes} --pdf`,
    `Para o Anuario Estatistico: acervo rpcmtec --ano ${ano} --mes ${mes} --anuario`
  ]
  if (Array.isArray(dados.pendentes) && dados.pendentes.length) {
    avisos.push(
      `${dados.pendentes.length} subsecao(oes) ainda sem preenchimento: ` +
      `${dados.pendentes.join(', ')}.`
    )
  }

  return { texto: blocos.join('\n'), avisos }
}

async function executar (args, cfg) {
  const comando = args._[0]
  if (comando === 'finalizados') return finalizados(args, cfg)
  if (comando === 'rpcmtec') return rpcmtec(args, cfg)
  throw new Error(`Comando de relatorio desconhecido: ${comando}`)
}

module.exports = { executar, precisaServidor: true }
