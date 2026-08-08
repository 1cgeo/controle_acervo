'use strict'

// O TIPO DE EQUIPAMENTO, que e CADASTRO e nao domínio:
//
//   equipamento tipo listar
//   equipamento tipo cadastrar --nome "Estação Total" --vida_util_meses 120   (operador)
//   equipamento tipo alterar   --id N --ativo false                           (operador)
//   equipamento tipo apagar    --id N --confirmar N                           (gerente)
//
// Duas coisas que este comando lembra em vez de deixar o agente descobrir:
//
// 1. Nao ha GET por id. Para alterar, o registro sai da LISTA, e por isso
//    `alterar` gasta duas chamadas: uma para ler, outra para reenviar o corpo
//    inteiro (o PUT substitui a linha).
//
// 2. `vida_util_meses` e a vida util do TIPO, que o bem HERDA quando nao declara
//    a propria. Ela e em MESES; a planilha da Secao traz anos.

const { obter } = require('../lib/recursos')
const corpoLib = require('../lib/corpo')
const { lerDaLista } = require('../lib/registro')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')
const { exigirServidor } = require('../lib/config')

const { resumoMudancas } = corpoLib

const RECURSO = 'tipo'

async function executar (args, cfg) {
  const acao = args._[1] || 'listar'
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
      const r = await http.autenticada(cfg, 'GET', recurso.caminho)
      const out = saida.lista(r.dados, opcoesSaida)
      return { texto: out.texto, avisos: out.avisos }
    }

    // -----------------------------------------------------------------------
    case 'cadastrar':
    case 'criar': {
      const { corpo: bruto, avisos } = corpoLib.montarCorpo(modulo.criar, flags)
      if (!Object.keys(bruto).length) {
        throw new Error(
          'cadastrar exige ao menos --nome. Contrato: equipamento schema tipo'
        )
      }
      const { corpo, avisos: todos } = corpoLib.validar(modulo.criar, bruto, RECURSO, avisos)

      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado. A requisição seria:',
            `  POST /api${recurso.caminho}`,
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
        texto: `${r.message || 'Tipo criado.'}${id ? `\nid  ${id}` : ''}`,
        avisos: todos
      }
    }

    // -----------------------------------------------------------------------
    case 'alterar':
    case 'atualizar': {
      exigirServidor(cfg, 'o corpo completo do PUT sai do tipo lido de volta')
      const id = argsLib.exigir(flags, 'id', 'id do tipo a alterar')
      const atual = await lerDaLista(cfg, recurso.caminho, id, 'Tipo de equipamento')
      const { base, ausentesComDefault } = corpoLib.recortar(modulo.atualizar, atual)

      const avisos = []
      if (ausentesComDefault.length) {
        avisos.push(
          'A leitura não trouxe estes campos, e o schema tem default para eles: ' +
          `${ausentesComDefault.join(', ')}. O PUT gravaria o default. Confira antes.`
        )
      }

      const montado = corpoLib.montarCorpo(modulo.atualizar, flags, base)
      avisos.push(...montado.avisos)

      const mudancas = resumoMudancas(base, montado.corpo)
      if (!mudancas.length) {
        return { texto: `Nada a alterar no tipo ${id}.`, avisos }
      }

      const { corpo, avisos: avisosValidacao } = corpoLib.validar(
        modulo.atualizar, montado.corpo, RECURSO, avisos
      )
      avisos.length = 0
      avisos.push(...avisosValidacao)

      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado (o GET da lista FOI feito, para montar o corpo completo).',
            `  PUT /api${recurso.caminho}/${id}`,
            'muda:',
            ...mudancas,
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
        texto: [r.message || 'Tipo atualizado.', 'muda:', ...mudancas].join('\n'),
        avisos
      }
    }

    // -----------------------------------------------------------------------
    case 'apagar':
    case 'deletar': {
      const id = argsLib.exigir(flags, 'id', 'id do tipo a excluir')

      if (flags['dry-run']) {
        return {
          texto: [
            `[dry-run] nada foi enviado. Seria: DELETE /api${recurso.caminho}/${id}`,
            'Para excluir de fato:',
            `  equipamento tipo apagar --id ${id} --confirmar ${id}`
          ].join('\n')
        }
      }

      corpoLib.exigirConfirmacao(flags, id, 'equipamento tipo apagar')

      const r = await http.autenticada(
        cfg, 'DELETE', `${recurso.caminho}/${encodeURIComponent(id)}`
      )
      return {
        texto: r.message || `Tipo ${id} excluído.`,
        avisos: [
          'Apagar tipo é de GERENTE, e o servidor recusa quando há bem cadastrado nele: ' +
          'nesse caso, marque ativo = false com `equipamento tipo alterar --id N --ativo false`.'
        ]
      }
    }

    default:
      throw new Error(
        `Ação desconhecida "${acao}" para tipo. Use: listar, cadastrar, alterar, apagar.`
      )
  }
}

module.exports = { executar, precisaServidor: true }
