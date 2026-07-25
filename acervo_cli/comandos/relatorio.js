// Path: comandos\relatorio.js
'use strict'

// Os dois verbos do fechamento do mes:
//
//   acervo finalizados [--ano 2026] [--mes 7] [--mes-apenas] [--escala 50k]
//   acervo rpcmtec --ano 2026 --mes 7 [--docx arquivo.docx]
//
// `finalizados` responde "o que a DGEO entregou neste mes?" pela rota PUBLICA de
// integracao (nao gasta login) e ja recorta a saida: a rota devolve uma linha
// por versao com dezoito colunas, das quais seis respondem a pergunta.
//
// `rpcmtec` delega a montagem ao servidor, que ja sabe fazer a secao de acervo,
// em JSON (preview) ou DOCX. O CLI nao remonta tabela nenhuma: se a secao mudar,
// muda no backend e o CLI acompanha sozinho.

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

async function rpcmtec (args, cfg) {
  const flags = args.flags
  const hoje = agora()
  const ano = argsLib.numero(flags, 'ano', hoje.ano)
  const mes = argsLib.numero(flags, 'mes', hoje.mes)

  // DOCX: sai binario, direto para o arquivo; nunca para o stdout (seriam
  // megabytes de lixo na janela do agente).
  if (flags.docx) {
    const destino = flags.docx === true
      ? `RPCMTec-acervo-${ano}-${String(mes).padStart(2, '0')}.docx`
      : flags.docx
    const r = await http.autenticada(
      cfg, 'GET', '/relatorio/rpcmtec/docx' + http.query({ ano, mes }), { binario: true }
    )
    fs.writeFileSync(destino, r.bytes)
    return { texto: `RPCMTec (secao acervo, ${ano}-${String(mes).padStart(2, '0')}) salvo em ${destino} (${r.bytes.length} bytes).` }
  }

  const r = await http.autenticada(cfg, 'GET', '/relatorio/rpcmtec' + http.query({ ano, mes }))
  if (flags.json) return { texto: JSON.stringify(r.dados, null, 2) }

  return {
    texto: saida.registro(r.dados, { formato: 'tsv' }),
    avisos: [`Para o documento pronto: acervo rpcmtec --ano ${ano} --mes ${mes} --docx`]
  }
}

async function executar (args, cfg) {
  const comando = args._[0]
  if (comando === 'finalizados') return finalizados(args, cfg)
  if (comando === 'rpcmtec') return rpcmtec(args, cfg)
  throw new Error(`Comando de relatorio desconhecido: ${comando}`)
}

module.exports = { executar, precisaServidor: true }
