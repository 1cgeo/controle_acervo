'use strict'

const argsLib = require('../lib/args')
const http = require('../lib/http')
const contrato = require('../lib/contrato')
const consulta = require('../lib/consulta')
const saida = require('../lib/saida')
const valores = require('../lib/valores')
const { documento } = require('../lib/documentos')

// `sag <documento> listar` e o unico verbo de consulta, e e de LEITURA.
//
// Este CLI nao escreve no SAG, e a ausencia e deliberada: o SAG e sistema da
// administracao, alimentado pelo SIAFI e pelos agentes da SALC. Escrever daqui
// seria criar uma segunda origem para o mesmo fato. O caminho de escrita do
// nosso lado continua sendo o orcamento_cli, contra o SCA.

/**
 * Descobre como esta tela chama o periodo. Quase toda usa DATAINI/DATAFIM, mas
 * o nome sai do contrato, e nao daqui: tela que use outro par continua
 * funcionando, e tela sem periodo diz isso com todas as letras.
 */
function camposDePeriodo (lido) {
  const nomes = lido.textos.map(t => t.nome)
  const inicio = nomes.find(n => /^DATA.*(INI|INICIAL)$/i.test(n))
  const fim = nomes.find(n => /^DATA.*(FIM|FINAL)$/i.test(n))
  return { inicio: inicio || null, fim: fim || null }
}

async function executar (args, cfg) {
  const doc = documento(args._[0])
  const acao = args._[1] || 'listar'

  if (acao !== 'listar') {
    throw new Error(
      `Acao desconhecida: "${acao}". O sag_cli so LE: use "listar". ` +
      'Para escrever no SCA, o CLI e o orcamento_cli.'
    )
  }

  const formato = args.flags.json ? 'json' : (args.flags.formato || 'tsv')
  const limite = argsLib.numero(args.flags, 'limite', Infinity)

  const sessao = await http.sessaoValida(cfg)
  const { texto: html } = await sessao.requisitar('GET', `/php/${doc.pagina}.php`)
  const lido = contrato.ler(html)

  const avisos = []
  if (!doc.medido) {
    avisos.push(
      `O contrato de "${args._[0]}" nunca foi exercido contra o SAG. ` +
      'Confira o resultado contra a tela antes de confiar nele.'
    )
  }

  // ---- colunas ----
  const pedidas = argsLib.lista(args.flags.campos)
  const campos = pedidas ||
    doc.padrao ||
    (lido.padraoDaPagina.length ? lido.padraoDaPagina : lido.colunas.map(c => c.campo))
  contrato.conferirColunas(lido, campos)

  if (!pedidas && !doc.padrao && !lido.padraoDaPagina.length) {
    avisos.push(
      `Sem --campos e sem padrao conhecido, pedi as ${campos.length} colunas da tela. ` +
      'Isso e caro em contexto: use --campos.'
    )
  }

  // ---- filtros ----
  const filtros = argsLib.filtros(args.flags)
  avisos.push(...contrato.conferirFiltros(lido, filtros))

  const formulario = {}
  for (const [campo, lista] of Object.entries(filtros)) {
    const ehSeletor = lido.filtros.some(f => f.campo === campo)
    formulario[ehSeletor ? `${campo}[]` : campo] = ehSeletor ? lista : lista.join(' ')
  }

  // Atalhos, porque UG favorecida entra em toda consulta e escrever
  // `--filtro UG_FAV=160382` toda vez e atrito sem ganho.
  for (const [flag, campo] of [['ug', 'UG'], ['ug-fav', 'UG_FAV']]) {
    const valor = args.flags[flag]
    if (valor === undefined || valor === true) continue
    if (!lido.filtros.some(f => f.campo === campo)) {
      throw new Error(`Esta tela do SAG nao tem o seletor ${campo}; use --filtro.`)
    }
    formulario[`${campo}[]`] = argsLib.lista(valor)
  }

  // ---- periodo ----
  const { inicio, fim } = camposDePeriodo(lido)
  const de = args.flags.de
  const ate = args.flags.ate
  const ano = argsLib.numero(args.flags, 'ano', null)

  if (ano && (de || ate)) {
    throw new Error('Use --ano OU o par --de/--ate, nunca os dois: eles disputam o mesmo filtro.')
  }

  if (inicio && fim) {
    if (ano) {
      formulario[inicio] = `01/01/${ano}`
      formulario[fim] = `31/12/${ano}`
    } else if (de || ate) {
      if (!de || !ate) {
        throw new Error('O periodo do SAG exige os dois extremos: informe --de e --ate.')
      }
      formulario[inicio] = valores.paraSag(de)
      formulario[fim] = valores.paraSag(ate)
    } else {
      const obrigatorio = lido.textos.find(t => t.nome === inicio && t.obrigatorio)
      if (obrigatorio) {
        throw new Error(
          `A tela ${doc.pagina}.php exige periodo. Informe --ano 2026 ou --de/--ate.`
        )
      }
    }
  } else if (ano || de || ate) {
    avisos.push(
      `A tela ${doc.pagina}.php nao expoe filtro de periodo; --ano/--de/--ate foram ignorados.`
    )
  }

  // ---- consulta ----
  const { linhas, total, truncado } = await consulta.executar(
    sessao, doc, campos, formulario, { limite }
  )

  // Corte NUNCA sai calado.
  if (truncado) {
    avisos.push(
      `--limite cortou ${truncado} registro${truncado === 1 ? '' : 's'} de ${total}. ` +
      'O que voce esta vendo NAO e o conjunto inteiro.'
    )
  }

  const render = saida.lista(linhas, {
    formato,
    campos,
    largura: argsLib.numero(args.flags, 'largura', 40)
  })

  return {
    texto: render.texto,
    avisos: [...avisos, ...render.avisos]
  }
}

module.exports = { executar, precisaServidor: true, camposDePeriodo }
