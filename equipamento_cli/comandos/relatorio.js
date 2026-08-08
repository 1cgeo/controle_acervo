'use strict'

// `equipamento relatorio dmt [--para arquivo.ods]` - o Relatório DMT.
//
// A rota responde BINARIO, e nao o envelope da casa: o corpo dela E o arquivo
// .ods. Nao existe ?formato=json ali, e nao e esquecimento: quem quer o dado em
// JSON tem `equipamento listar` e `equipamento ver`, que devolvem o modelo do
// banco em vez das 26 colunas da planilha.
//
// O comando imprime o sha256 do que chegou. Sem ele, o TAMANHO seria a unica
// prova de que o arquivo veio inteiro, e dois .ods diferentes com o mesmo numero
// de bytes passam.

const fs = require('fs')
const crypto = require('crypto')

const { CAMINHOS } = require('../lib/recursos')
const http = require('../lib/http')
const argsLib = require('../lib/args')
const { REGRAS } = require('../lib/regras')

const PADRAO = 'relatorio_dmt.ods'

async function executar (args, cfg) {
  const qual = args._[1]
  const flags = args.flags

  if (!qual) {
    return {
      texto: [
        'Relatórios do módulo equipamento:',
        '  dmt   Relatório DMT, o documento de 26 colunas que a Seção entrega (.ods)',
        '',
        ...REGRAS.relatorio.map(l => '  ' + l),
        '',
        `Uso: equipamento relatorio dmt [--para ${PADRAO}]`
      ].join('\n')
    }
  }

  if (qual !== 'dmt') {
    throw new Error(
      `Relatório desconhecido: "${qual}". O módulo tem um só: dmt.`
    )
  }

  const destino = argsLib.texto(flags, 'para', PADRAO)

  if (flags['dry-run']) {
    return {
      texto: `[dry-run] nada foi baixado. Seria: GET /api${CAMINHOS.relatorioDmt} -> ${destino}`
    }
  }

  if (fs.existsSync(destino)) {
    throw new Error(
      `"${destino}" já existe e não foi sobrescrito. Escolha outro nome com --para.`
    )
  }

  const r = await http.autenticada(cfg, 'GET', CAMINHOS.relatorioDmt, { binario: true })
  fs.writeFileSync(destino, r.bytes)
  const sha = crypto.createHash('sha256').update(r.bytes).digest('hex')

  return {
    texto: `Relatório DMT gravado em ${destino} (${r.bytes.length} bytes)\nsha256    ${sha}`,
    avisos: [
      'O documento é CONTRATO DE SAÍDA: quem o recebe compara com o do mês passado. ' +
      'Antes de entregar, confira a coluna 18, que mostra "solicitado descarga" no ' +
      'lugar da data quando há descarga solicitada para o bem.'
    ]
  }
}

// `equipamento relatorio` sem argumento so lista o que existe: e texto estatico,
// e nao ha por que cobrar SCA_URL para imprimi-lo.
module.exports = { executar, precisaServidor: args => !!args._[1] }
