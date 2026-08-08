'use strict'

// O BEM: o cadastro do parque.
//
//   equipamento listar    [--situacao_id N] [--secao_detentora_id N] [--tipo_id N] [--ativo false]
//   equipamento ver       --id N | --patrimonio 104820700014462
//   equipamento cadastrar --nr_patrimonio ... --modelo ... (gerente)
//   equipamento alterar   --id N --<campo> <valor>         (gerente)
//   equipamento baixar    --id N                           (gerente; grava ativo = false)
//   equipamento apagar    --id N --confirmar N             (gerente)
//
// Duas decisoes que valem explicar:
//
// 1. `alterar` e `baixar` NAO aceitam corpo parcial. O PUT do SCA substitui a
//    linha inteira, entao os dois LEEM o bem, aplicam o que muda e reenviam o
//    corpo completo. Um PUT com {"modelo": "X"} apagaria nr_serie, observacao e
//    data de entrada em carga, e ainda REATIVARIA um bem baixado, porque `ativo`
//    tem default true no schema: o campo que ninguem digitou volta ao default,
//    e default nao e ausencia, e valor.
//
// 2. `ver --patrimonio` custa uma chamada a mais, e e proposital: nao ha filtro
//    por patrimonio na rota de listagem, entao o casamento exato e feito aqui,
//    sobre a lista inteira. Patrimonio que nao casa vira aviso com os parecidos,
//    nunca um chute.

const { obter, historicos, RECURSOS } = require('../lib/recursos')
const corpoLib = require('../lib/corpo')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')
const { exigirServidor } = require('../lib/config')

const RECURSO = 'bem'

const { resumoMudancas } = corpoLib

/** Le a lista inteira e casa o numero de patrimonio por igualdade exata. */
async function porPatrimonio (cfg, patrimonio) {
  exigirServidor(cfg, 'a busca por número de patrimônio lê a lista de bens')
  const alvo = String(patrimonio).trim()
  const r = await http.autenticada(cfg, 'GET', obter(RECURSO).caminho)
  const bens = Array.isArray(r.dados) ? r.dados : []

  const exatos = bens.filter(b => String(b.nr_patrimonio || '').trim() === alvo)
  if (exatos.length === 1) return exatos[0]
  if (exatos.length > 1) {
    throw new Error(
      `Há ${exatos.length} bens com o patrimônio ${alvo} (ids ${exatos.map(b => b.id).join(', ')}). ` +
      'Isso é defeito de cadastro: escolha pelo id com --id.'
    )
  }

  const parecidos = bens
    .filter(b => String(b.nr_patrimonio || '').includes(alvo))
    .slice(0, 5)
    .map(b => `${b.nr_patrimonio} (id ${b.id}, ${b.modelo})`)
  throw new Error(
    `Nenhum bem com o patrimônio ${alvo}.` +
    (parecidos.length ? `\nContêm esse trecho: ${parecidos.join('; ')}` : '')
  )
}

/** Resolve o id do bem a partir de --id ou de --patrimonio. */
async function resolverId (cfg, flags, contexto) {
  if (flags.id !== undefined && flags.id !== true) return flags.id
  const patrimonio = argsLib.texto(flags, 'patrimonio')
  if (patrimonio) {
    const bem = await porPatrimonio(cfg, patrimonio)
    return bem.id
  }
  throw new Error(`Falta --id (${contexto}) ou --patrimonio.`)
}

async function executar (args, cfg) {
  const acao = args._[0]
  const flags = args.flags
  const recurso = obter(RECURSO)
  const modulo = recurso.schema()

  const opcoesSaida = {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: recurso.colunas
  }

  switch (acao) {
    // -----------------------------------------------------------------------
    case 'listar': {
      const { params, avisos } = corpoLib.montarFiltros(modulo, flags)
      const r = await http.autenticada(cfg, 'GET', recurso.caminho + http.query(params))
      const out = saida.lista(r.dados, opcoesSaida)
      return { texto: out.texto, avisos: [...avisos, ...out.avisos] }
    }

    // -----------------------------------------------------------------------
    case 'ver': {
      const id = await resolverId(cfg, flags, 'id do bem')
      const r = await http.autenticada(
        cfg, 'GET', `${recurso.caminho}/${encodeURIComponent(id)}`
      )
      const dados = r.dados || {}

      if (opcoesSaida.formato === 'json') {
        return { texto: JSON.stringify(dados, null, 2) }
      }

      // A ficha separa o BEM dos quatro historicos: os quatro sao listas, e uma
      // lista impressa como par chave/valor viraria um JSON de uma linha so.
      const chavesHistorico = historicos().map(h => RECURSOS[h].chaveFicha)
      const soBem = {}
      for (const [chave, valor] of Object.entries(dados)) {
        if (!chavesHistorico.includes(chave)) soBem[chave] = valor
      }

      const linhas = [saida.registro(soBem, { formato: 'tsv', campos: opcoesSaida.campos })]
      if (soBem.vida_util_meses !== null && soBem.vida_util_meses !== undefined) {
        linhas.push('')
        linhas.push(
          `vida útil: ${soBem.vida_util_meses} MESES` +
          (soBem.vida_util_herdada ? ' (herdada do tipo; o bem não declara a própria)' : '')
        )
      }

      for (const chave of historicos()) {
        const sub = RECURSOS[chave]
        const lista = dados[sub.chaveFicha] || []
        linhas.push('')
        linhas.push(`${sub.chaveFicha} (${lista.length})`)
        const out = saida.lista(lista, { formato: 'tabela', padrao: sub.colunas })
        linhas.push(out.texto.split('\n').map(l => '  ' + l).join('\n'))
      }

      return { texto: linhas.join('\n') }
    }

    // -----------------------------------------------------------------------
    case 'cadastrar': {
      const { corpo: bruto, avisos } = corpoLib.montarCorpo(modulo.criar, flags)
      if (!Object.keys(bruto).length) {
        throw new Error(
          'cadastrar exige os campos do bem, por --<campo> <valor> ou por ' +
          "--data '{...}'. Contrato: equipamento schema bem"
        )
      }
      const { corpo, avisos: todos } = corpoLib.validar(modulo.criar, bruto, RECURSO, avisos)

      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado. A requisição seria:',
            `  POST /api${recurso.caminho}`,
            '  corpo (já validado contra o schema):',
            JSON.stringify(corpo, null, 2)
          ].join('\n'),
          avisos: todos
        }
      }

      const r = await corpoLib.comAvisos(
        http.autenticada(cfg, 'POST', recurso.caminho, { corpo }), todos
      )
      const id = r.dados && r.dados.id
      return {
        texto: `${r.message || 'Equipamento criado.'}${id ? `\nid  ${id}` : ''}` +
          (id ? `\nConfira lendo de volta: equipamento ver --id ${id}` : ''),
        avisos: todos
      }
    }

    // -----------------------------------------------------------------------
    // Ler, aplicar o que muda e reenviar INTEIRO. O --dry-run daqui faz o GET
    // (nao ha como montar o corpo completo sem ele) e avisa isso; nenhuma
    // escrita ocorre.
    case 'alterar':
    case 'baixar': {
      if (acao === 'baixar' && flags.para !== undefined) {
        throw new Error(
          '`baixar` aqui é dar BAIXA no bem (grava ativo = false), e não baixar arquivo.\n' +
          'O download do Relatório DMT é: equipamento relatorio dmt --para relatorio_dmt.ods'
        )
      }

      exigirServidor(cfg, 'o corpo completo do PUT sai do bem lido de volta')
      const id = await resolverId(cfg, flags, `id do bem a ${acao}`)
      const atual = await http.autenticada(
        cfg, 'GET', `${recurso.caminho}/${encodeURIComponent(id)}`
      )
      const { base, ausentesComDefault } = corpoLib.recortar(modulo.atualizar, atual.dados || {})

      const avisos = []
      if (ausentesComDefault.length) {
        avisos.push(
          'A leitura não trouxe estes campos, e o schema tem default para eles: ' +
          `${ausentesComDefault.join(', ')}. O PUT gravaria o default. Confira antes.`
        )
      }

      // A LEITURA DEVOLVE A VIDA UTIL JA RESOLVIDA, e reenvia-la seria mudar o
      // dado sem ninguem pedir.
      //
      // `vida_util_meses` sai do GET por COALESCE(bem, tipo), e
      // `vida_util_herdada` diz quando o numero veio do TIPO e a coluna do bem
      // esta nula. Reenviar esse numero MATERIALIZA a heranca: a partir dali o
      // bem passa a declarar a propria vida util, e mudar a do tipo deixa de
      // alcanca-lo. Nada acusaria isso, porque o valor gravado seria igual ao
      // que a tela ja mostrava.
      //
      // Entao a heranca e preservada como NULO, e so um --vida_util_meses
      // explicito a rompe.
      if ((atual.dados || {}).vida_util_herdada === true &&
          flags.vida_util_meses === undefined) {
        base.vida_util_meses = null
        avisos.push(
          `A vida útil deste bem é HERDADA do tipo (${(atual.dados || {}).vida_util_meses} meses). ` +
          'Ela é reenviada como nula para a herança continuar valendo. Para o bem passar a ' +
          'declarar a própria, use --vida_util_meses <meses> explicitamente.'
        )
      }

      let montado
      if (acao === 'baixar') {
        if (base.ativo === false) {
          return {
            texto: `O bem ${id} já está baixado (ativo = false). Nada a fazer.\n` +
              `Para reativá-lo: equipamento alterar --id ${id} --ativo true`
          }
        }
        montado = { corpo: { ...base, ativo: false }, mudou: ['ativo'], avisos: [] }
      } else {
        montado = corpoLib.montarCorpo(modulo.atualizar, flags, base)
      }
      avisos.push(...montado.avisos)

      const mudancas = resumoMudancas(base, montado.corpo)
      if (!mudancas.length) {
        return {
          texto: `Nada a alterar no bem ${id}: o corpo montado é igual ao que já está gravado.`,
          avisos
        }
      }

      const { corpo, avisos: avisosValidacao } = corpoLib.validar(
        modulo.atualizar, montado.corpo, RECURSO, avisos
      )
      avisos.length = 0
      avisos.push(...avisosValidacao)

      const cabecalho = [
        acao === 'baixar'
          ? `Baixa do bem ${id} (ativo = false; a situação derivada passa a "Baixado")`
          : `Alteração do bem ${id}`,
        'muda:',
        ...mudancas
      ]

      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado (o GET do bem FOI feito, para montar o corpo completo).',
            ...cabecalho,
            `  PUT /api${recurso.caminho}/${id}`,
            JSON.stringify(corpo, null, 2)
          ].join('\n'),
          avisos
        }
      }

      const r = await corpoLib.comAvisos(
        http.autenticada(cfg, 'PUT', `${recurso.caminho}/${encodeURIComponent(id)}`, { corpo }),
        avisos
      )
      return {
        texto: [
          r.message || 'Equipamento atualizado.',
          ...cabecalho.slice(1),
          `Confira lendo de volta: equipamento ver --id ${id}`
        ].join('\n'),
        avisos
      }
    }

    // -----------------------------------------------------------------------
    case 'apagar': {
      const id = await resolverId(cfg, flags, 'id do bem a excluir')

      // O --dry-run nao escreve, entao ele NAO exige a confirmacao: e ele que
      // mostra o que a confirmacao autorizaria.
      if (flags['dry-run']) {
        return {
          texto: [
            `[dry-run] nada foi enviado. Seria: DELETE /api${recurso.caminho}/${id}`,
            'Para excluir de fato:',
            `  equipamento apagar --id ${id} --confirmar ${id}`
          ].join('\n')
        }
      }

      corpoLib.exigirConfirmacao(flags, id, 'equipamento apagar')

      const r = await http.autenticada(
        cfg, 'DELETE', `${recurso.caminho}/${encodeURIComponent(id)}`
      )
      return {
        texto: r.message || `Bem ${id} excluído.`,
        avisos: [
          'Bem que saiu da carga se BAIXA (equipamento baixar --id N), não se apaga: ' +
          'o histórico dele é o que responde onde o dinheiro foi parar. O servidor ' +
          'recusa a exclusão quando há lançamento no bem.'
        ]
      }
    }

    default:
      throw new Error(
        `Ação desconhecida "${acao}" para o bem. ` +
        'Use: listar, ver, cadastrar, alterar, baixar, apagar.'
      )
  }
}

module.exports = { executar, precisaServidor: true }
