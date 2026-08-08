'use strict'

// `equipamento dashboard` (ou `painel`) - o retrato do parque HOJE.
//
// Seis blocos numa chamada so. O CLI nao recalcula nada: quem soma e o servidor,
// e a mesma rota que a tela usa. O que ele faz aqui e recorte de apresentacao,
// para o retrato inteiro caber em vinte e poucas linhas em vez de num JSON de
// varios milhares de caracteres.

const { CAMINHOS } = require('../lib/recursos')
const saida = require('../lib/saida')
const http = require('../lib/http')

function bloco (titulo, linhas, colunas) {
  const out = [titulo]
  if (!linhas || !linhas.length) {
    out.push('  (nenhum registro)')
    return out
  }
  const texto = saida.tabela(linhas, colunas.filter(c => c in linhas[0]))
  out.push(...texto.split('\n').map(l => '  ' + l))
  return out
}

async function executar (args, cfg) {
  const flags = args.flags
  const r = await http.autenticada(cfg, 'GET', CAMINHOS.dashboard)
  const d = r.dados || {}

  if (flags.json || flags.formato === 'json') {
    return { texto: JSON.stringify(d, null, 2) }
  }

  const custo = d.custoManutencao || {}
  const linhas = []

  linhas.push('Painel do parque de material - situação de hoje')
  linhas.push('')
  // A situacao com zero bem aparece com zero de proposito: a coluna que some no
  // dia em que ela zera faz quem le achar que ela nunca existiu.
  linhas.push(...bloco('por situação (a derivada de hoje)', d.porSituacao,
    ['situacao_id', 'situacao', 'quantidade']))
  linhas.push('')
  linhas.push(...bloco('por seção detentora', d.porSecao,
    ['secao_detentora_id', 'secao_detentora', 'quantidade']))
  linhas.push('')
  linhas.push(...bloco('por tipo', d.porTipo, ['tipo_id', 'tipo', 'quantidade']))
  linhas.push('')
  // Do parado ha mais tempo para o mais novo, no maximo 10: a pergunta e "o que
  // esta encalhado", e nao "o que quebrou ontem".
  linhas.push(...bloco('parados há mais tempo (indisponibilidade aberta, no máximo 10)',
    d.indisponiveisHa,
    ['id', 'nr_patrimonio', 'tipo', 'modelo', 'data_inicio', 'dias', 'motivo']))
  linhas.push('')
  linhas.push(`custo de manutenção em ${custo.ano !== undefined ? custo.ano : '?'}`)
  linhas.push(`  ${custo.quantidade !== undefined ? custo.quantidade : 0} manutenção(ões), R$ ${saida.moeda(custo.valor)}`)
  linhas.push('  (soma a coluna `valor` das manutenções que COMEÇARAM no ano; o orçado e o')
  linhas.push('   previsto em PDR não entram)')
  linhas.push('')
  linhas.push(`descargas solicitadas   ${d.descargasSolicitadas !== undefined ? d.descargasSolicitadas : 0}`)
  linhas.push('  (transferência de tipo Descarga em situação Solicitada; é o que manda sobre a')
  linhas.push('   previsão de retorno na coluna 18 do Relatório DMT)')

  return { texto: linhas.join('\n') }
}

module.exports = { executar, precisaServidor: true }
