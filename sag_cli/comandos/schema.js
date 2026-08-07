'use strict'

const http = require('../lib/http')
const contrato = require('../lib/contrato')
const { DOCUMENTOS, documento, listarChaves } = require('../lib/documentos')

// `sag schema` e o comando que se roda ANTES de montar uma consulta. Sem
// argumento ele nao gasta rede (o mapa de documentos e local); com um
// documento, ele le a tela viva do SAG e imprime as colunas e os filtros que
// ela oferece HOJE.

async function executar (args, cfg) {
  const alvo = args._[1]
  const formato = args.flags.json ? 'json' : (args.flags.formato || 'tsv')

  if (!alvo) {
    const linhas = Object.entries(DOCUMENTOS).map(([chave, doc]) => ({
      documento: chave,
      nome: doc.nome,
      pagina: doc.pagina + '.php',
      contrato_medido: doc.medido || 'nao medido'
    }))
    if (formato === 'json') return { texto: JSON.stringify(linhas, null, 2) }
    const largura = Math.max(...linhas.map(l => l.documento.length))
    return {
      texto: [
        'Documentos do SAG que este CLI consulta:',
        ...linhas.map(l =>
          `  ${l.documento.padEnd(largura)}  ${l.nome} (${l.pagina}) [${l.contrato_medido}]`
        ),
        '',
        'Detalhe de um deles: sag schema <documento>  (le a tela viva do SAG)'
      ].join('\n')
    }
  }

  const doc = documento(alvo)
  const sessao = await http.sessaoValida(cfg)
  const { texto: html } = await sessao.requisitar('GET', `/php/${doc.pagina}.php`)
  const lido = contrato.ler(html)

  const avisos = []
  if (!doc.medido) {
    avisos.push(
      `O contrato de consulta de "${alvo}" nunca foi exercido contra o SAG. ` +
      'As colunas abaixo sao as que a tela declara; a consulta pode revelar ' +
      'diferencas. Ao medir, atualize lib/documentos.js.'
    )
  }

  if (formato === 'json') {
    return { texto: JSON.stringify({ documento: alvo, ...lido }, null, 2), avisos }
  }

  const partes = []
  partes.push(`${doc.nome} (${doc.pagina}.php)`)
  partes.push('')
  partes.push(`COLUNAS (${lido.colunas.length}) -- use em --campos`)
  const larguraC = Math.max(...lido.colunas.map(c => c.campo.length))
  for (const c of lido.colunas) {
    partes.push(`  ${c.campo.padEnd(larguraC)}  ${c.rotulo}${c.marcada ? '  [padrao da tela]' : ''}`)
  }

  partes.push('')
  partes.push('PERIODO E TEXTO -- use em --de, --ate e --filtro CAMPO=valor')
  for (const t of lido.textos) {
    partes.push(`  ${t.nome.padEnd(larguraC)}  ${t.rotulo}${t.obrigatorio ? '  [obrigatorio]' : ''}`)
  }

  partes.push('')
  partes.push(`SELETORES (${lido.filtros.length}) -- use em --filtro CAMPO=valor`)
  for (const f of lido.filtros) {
    const amostra = f.valores.slice(0, 4).map(v => v.valor).join(', ')
    const resto = f.valores.length > 4 ? `, ... (${f.valores.length} valores)` : ''
    partes.push(`  ${f.campo.padEnd(larguraC)}  ${amostra}${resto}`)
  }

  if (doc.padrao) {
    partes.push('')
    partes.push('CAMPOS PADRAO DESTE CLI: ' + doc.padrao.join(','))
  }

  return { texto: partes.join('\n'), avisos }
}

// `sag schema` (sem documento) responde do mapa local: nao gasta rede nem
// exige SAG_URL. Com um documento, precisa do SAG, porque o contrato e lido da
// tela viva.
module.exports = {
  executar,
  precisaServidor: args => Boolean(args._[1]),
  listarChaves
}
