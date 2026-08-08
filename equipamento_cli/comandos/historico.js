'use strict'

// OS QUATRO HISTORICOS, num comando so:
//
//   equipamento indisponibilidade listar|abrir|fechar|editar|apagar
//   equipamento afastamento       listar|abrir|fechar|editar|apagar
//   equipamento manutencao        listar|abrir|fechar|editar|apagar
//   equipamento transferencia     listar|lancar|editar|apagar
//
// Eles compartilham a forma (pertencem a um bem, sao lancados na ficha dele, tem
// os mesmos dois filtros de lista e o mesmo CRUD por id), e o que muda entre
// eles e DADO, declarado em lib/recursos.js: a lista de campos vem do Joi, as
// colunas e o campo de fim vem da registry. Quatro copias deste arquivo
// divergiriam: bastaria uma esquecer o ciclo ler-mesclar-reenviar para o defeito
// existir num canto e nao no outro.
//
// FECHAR e o verbo que justifica o comando existir. Fechar um lancamento e
// gravar `data_fim`, e o PUT do SCA substitui a linha inteira: mandar so
// {"data_fim": "..."} apagaria motivo, previsao e data de inicio, calado. Por
// isso `fechar` le o lancamento, aplica a data e reenvia o corpo completo.
//
// A transferencia NAO tem `fechar`, e a ausencia e a regra: ela nao tem
// `data_fim` porque nao dura, se resolve. Encerrar uma e mudar a SITUACAO.

const { obter } = require('../lib/recursos')
const corpoLib = require('../lib/corpo')
const { lerDaLista } = require('../lib/registro')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')
const { exigirServidor } = require('../lib/config')

const { resumoMudancas } = corpoLib

/** Le o lancamento, mescla o que muda por cima e devolve o corpo completo. */
async function prepararAlteracao (cfg, chave, recurso, modulo, flags, forcado) {
  exigirServidor(cfg, 'o corpo completo do PUT sai do lançamento lido de volta')
  const id = argsLib.exigir(flags, 'id', `id do lançamento de ${chave}`)

  const atual = await lerDaLista(cfg, recurso.caminho, id, recurso.nome)
  const { base, ausentesComDefault } = corpoLib.recortar(modulo.atualizar, atual)

  const avisos = []
  if (ausentesComDefault.length) {
    // Default NAO e ausencia: num PUT ele GRAVA, e reverte o que estava la.
    avisos.push(
      'A leitura não trouxe estes campos, e o schema tem default para eles: ' +
      `${ausentesComDefault.join(', ')}. O PUT gravaria o default. Confira antes.`
    )
  }

  const montado = corpoLib.montarCorpo(modulo.atualizar, flags, base)
  avisos.push(...montado.avisos)
  const bruto = { ...montado.corpo, ...(forcado || {}) }

  return { id, base, bruto, avisos, atual }
}

async function executar (args, cfg) {
  const chave = args._[0]
  const acao = args._[1] || 'listar'
  const flags = args.flags
  const recurso = obter(chave)
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

      // `aberta` quer dizer coisas diferentes nos quatro, e a diferenca e
      // invisivel na resposta: dizer qual regra valeu evita a leitura errada de
      // uma lista curta.
      if (params.aberta === true) {
        avisos.push(recurso.campoFim
          ? `--aberta trouxe só os lançamentos sem ${recurso.campoFim}.`
          : '--aberta aqui é a SITUAÇÃO que não terminou (nem Concluída nem Cancelada): ' +
            'transferência não tem data_fim.')
      }
      return { texto: out.texto, avisos: [...avisos, ...out.avisos] }
    }

    // -----------------------------------------------------------------------
    case 'abrir':
    case 'lancar':
    case 'criar': {
      const { corpo: bruto, avisos } = corpoLib.montarCorpo(modulo.criar, flags)
      if (!Object.keys(bruto).length) {
        throw new Error(
          `${acao} exige os campos do lançamento, por --<campo> <valor> ou por ` +
          `--data '{...}'. Contrato: equipamento schema ${chave}`
        )
      }
      const { corpo, avisos: todos } = corpoLib.validar(modulo.criar, bruto, chave, avisos)

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
      const bem = corpo.equipamento_id
      return {
        texto: `${r.message || 'Lançamento criado.'}${id ? `\nid  ${id}` : ''}` +
          (bem ? `\nConfira lendo de volta: equipamento ver --id ${bem}` : ''),
        avisos: todos
      }
    }

    // -----------------------------------------------------------------------
    case 'fechar': {
      if (!recurso.campoFim) {
        throw new Error(
          `Transferência não tem data de fim, e isso não é esquecimento: ela não dura, ` +
          'ela se resolve.\n' +
          'Para encerrá-la, mude a SITUAÇÃO (Concluída ou Cancelada):\n' +
          `  equipamento dominio situacao_transferencia\n` +
          `  equipamento transferencia editar --id N --situacao_id <code>`
        )
      }

      const { id, base, bruto, avisos } = await prepararAlteracao(
        cfg, chave, recurso, modulo, flags
      )

      if (bruto[recurso.campoFim] === undefined || bruto[recurso.campoFim] === null) {
        const hoje = new Date().toISOString().slice(0, 10)
        throw new Error(
          `fechar precisa da data: --${recurso.campoFim} AAAA-MM-DD (hoje seria ${hoje}).\n` +
          'A data não é assumida: quem fecha um lançamento sabe o dia em que ele terminou, ' +
          'e o dia de hoje raramente é o dia em que o bem voltou.'
        )
      }
      if (base[recurso.campoFim]) {
        avisos.push(
          `Este lançamento JÁ estava fechado em ${saida.celula(recurso.campoFim, base[recurso.campoFim])}. ` +
          'A data abaixo substitui a anterior.'
        )
      }

      const mudancas = resumoMudancas(base, bruto)
      const { corpo, avisos: avisosValidacao } = corpoLib.validar(
        modulo.atualizar, bruto, chave, avisos
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
        texto: [
          r.message || 'Lançamento fechado.',
          'muda:',
          ...mudancas,
          corpo.equipamento_id
            ? `Confira lendo de volta: equipamento ver --id ${corpo.equipamento_id}`
            : ''
        ].filter(Boolean).join('\n'),
        avisos
      }
    }

    // -----------------------------------------------------------------------
    case 'editar':
    case 'atualizar': {
      const { id, base, bruto, avisos } = await prepararAlteracao(
        cfg, chave, recurso, modulo, flags
      )

      const mudancas = resumoMudancas(base, bruto)
      if (!mudancas.length) {
        return {
          texto: `Nada a editar no lançamento ${id}: o corpo montado é igual ao gravado.`,
          avisos
        }
      }

      const { corpo, avisos: avisosValidacao } = corpoLib.validar(
        modulo.atualizar, bruto, chave, avisos
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
        texto: [r.message || 'Lançamento atualizado.', 'muda:', ...mudancas].join('\n'),
        avisos
      }
    }

    // -----------------------------------------------------------------------
    case 'apagar':
    case 'deletar': {
      const id = argsLib.exigir(flags, 'id', `id do lançamento de ${chave} a excluir`)

      if (flags['dry-run']) {
        return {
          texto: [
            `[dry-run] nada foi enviado. Seria: DELETE /api${recurso.caminho}/${id}`,
            'Para excluir de fato:',
            `  equipamento ${chave} apagar --id ${id} --confirmar ${id}`
          ].join('\n')
        }
      }

      corpoLib.exigirConfirmacao(flags, id, `equipamento ${chave} apagar`)

      const r = await http.autenticada(
        cfg, 'DELETE', `${recurso.caminho}/${encodeURIComponent(id)}`
      )
      const avisos = recurso.campoFim
        ? ['Apagar um lançamento MUDA a situação derivada do bem: o degrau que ele ' +
           'sustentava deixa de valer. Lançamento errado costuma se consertar por ' +
           `\`equipamento ${chave} editar\`, que preserva o histórico.`]
        : []
      return { texto: r.message || `Lançamento ${id} excluído.`, avisos }
    }

    default: {
      const verbos = recurso.campoFim
        ? 'listar, abrir, fechar, editar, apagar'
        : 'listar, lancar, editar, apagar'
      throw new Error(`Ação desconhecida "${acao}" para ${chave}. Use: ${verbos}.`)
    }
  }
}

module.exports = { executar, precisaServidor: true }
