// Path: lib\plano.js
'use strict'

// O PLANO de um pedido: um JSON unico com o cliente, o pedido, os itens e os
// anexos, que o comando `mapoteca pedido cadastrar` executa de ponta a ponta.
//
// Existe porque cadastrar um pedido pela API crua sao tres rotas distintas, sem
// transacao entre elas, e o agente tem de carregar o id criado de uma para a
// outra. O plano deixa a INTENCAO inteira num arquivo revisavel, e a execucao
// vira uma invocacao.
//
// Este modulo so VALIDA e NORMALIZA, sempre offline: ele nao fala com a rede.
// E o que torna o --dry-run honesto (valida contra o Joi vivo sem servidor,
// sem credencial e sem token) e o que torna o guardrail testavel.

const fs = require('fs')
const path = require('path')

const esquema = require('./schema')
const mi = require('./mi')
const { EXTENSOES_ANEXO, MAX_BYTES_ANEXO } = require('./recursos')

// Chaves que o plano carrega para o agente e para o log, mas que NAO pertencem
// ao corpo enviado ao servidor. Sem separa-las, o validador as acusaria como
// "campo descartado em silencio", que e um aviso verdadeiro para um erro de
// digitacao e um falso alarme para estas.
const CHAVES_LOCAIS_ITEM = new Set(['mi', 'nome', 'nome_documento', 'linhas_documento'])

// Sentinelas para os campos que so existem depois de uma chamada ao servidor.
// Validar com eles permite conferir TODO o resto offline, em vez de deixar o
// corpo passar sem validacao ate a hora de gravar.
const CLIENTE_ID_PENDENTE = -1
const PEDIDO_ID_PENDENTE = -1

function ler (caminho) {
  let conteudo
  try {
    conteudo = fs.readFileSync(caminho, 'utf8')
  } catch (e) {
    throw new Error(`Nao consegui ler o plano em ${caminho}: ${e.message}`)
  }
  try {
    return JSON.parse(conteudo)
  } catch (e) {
    throw new Error(`${caminho} nao contem JSON valido: ${e.message}`)
  }
}

/**
 * Agrupa itens que colapsam no MESMO MI (ou no mesmo uuid_versao).
 *
 * Regra do dominio, registrada pelo chefe em 2026-07-24: duas linhas do
 * documento com o mesmo MI sao UM item, com a quantidade de UMA linha, nunca a
 * soma. A duplicata e erro de copia do solicitante, e o erro caro esta do lado
 * do gasto (imprimir o dobro), nao do lado da falta.
 *
 * O CLI nao soma e nao apaga em silencio: ele funde, mantem a MAIOR quantidade
 * pedida entre as linhas repetidas e devolve o aviso para o agente conferir.
 */
function fundirDuplicatas (itens) {
  const porChave = new Map()
  const avisos = []

  for (const item of itens) {
    const chave = item.uuid_versao || (item.mi ? 'mi:' + mi.normalizar(item.mi) : null)
    if (!chave || chave === 'mi:null') {
      // Sem chave de identidade nao ha como detectar duplicata; o item segue e a
      // validacao do Joi reclama do uuid_versao faltando.
      porChave.set(Symbol('sem-chave'), item)
      continue
    }

    if (!porChave.has(chave)) {
      porChave.set(chave, { ...item })
      continue
    }

    const anterior = porChave.get(chave)
    const qtdAnterior = Number(anterior.quantidade) || 0
    const qtdAtual = Number(item.quantidade) || 0
    const rotulo = item.mi || item.uuid_versao

    avisos.push(
      `Duas linhas do plano casam no mesmo item (${rotulo}): quantidades ${qtdAnterior} e ` +
      `${qtdAtual}. Fundidas em UM item com quantidade ${Math.max(qtdAnterior, qtdAtual)} ` +
      '(a regra do dominio manda ficar com uma linha, nao somar). Confira o documento.'
    )
    anterior.quantidade = Math.max(qtdAnterior, qtdAtual)
    // A observacao guarda o rastro das duas linhas, para quem for conferir
    // depois nao ter que voltar ao PDF.
    const nota = `linha repetida no documento (quantidades ${qtdAnterior} e ${qtdAtual})`
    anterior.observacao = anterior.observacao
      ? `${anterior.observacao}; ${nota}`
      : nota
  }

  return { itens: [...porChave.values()], avisos }
}

/** Separa as chaves locais do corpo que vai ao servidor. */
function partirItem (item) {
  const corpo = {}
  const local = {}
  for (const [k, v] of Object.entries(item || {})) {
    if (CHAVES_LOCAIS_ITEM.has(k)) local[k] = v
    else corpo[k] = v
  }
  return { corpo, local }
}

function conferirAnexo (anexo) {
  const erros = []
  const caminho = anexo && (anexo.arquivo || anexo.caminho)

  if (!caminho) {
    erros.push('anexo sem a chave "arquivo" (caminho do arquivo a subir)')
    return { erros }
  }
  if (!fs.existsSync(caminho)) {
    erros.push(`anexo nao encontrado no disco: ${caminho}`)
    return { erros }
  }

  const ext = path.extname(caminho).toLowerCase()
  if (!EXTENSOES_ANEXO.includes(ext)) {
    erros.push(
      `extensao ${ext || '(sem extensao)'} nao aceita em ${path.basename(caminho)}. ` +
      `Aceitas: ${EXTENSOES_ANEXO.join(', ')}`
    )
  }

  const tamanho = fs.statSync(caminho).size
  if (tamanho > MAX_BYTES_ANEXO) {
    erros.push(
      `${path.basename(caminho)} tem ${(tamanho / 1024 / 1024).toFixed(1)} MB e o limite ` +
      `do servidor e ${MAX_BYTES_ANEXO / 1024 / 1024} MB`
    )
  }

  return { erros, caminho, tamanho }
}

/**
 * Valida o plano inteiro contra os schemas Joi VIVOS do server/, sem rede.
 *
 * Devolve { ok, erros[], avisos[], cliente, pedido, itens[], anexos[] } com os
 * corpos ja normalizados pelo proprio Joi (defaults aplicados, tipos coeridos),
 * que e exatamente o que sera enviado depois.
 */
function validar (plano, models) {
  const erros = []
  const avisos = []

  if (!plano || typeof plano !== 'object') {
    throw new Error('O plano precisa ser um objeto JSON.')
  }

  // --- cliente -------------------------------------------------------------
  let cliente = null
  const clienteBruto = plano.cliente || null
  const clienteIdFixo = plano.pedido && plano.pedido.cliente_id

  if (!clienteBruto && (clienteIdFixo === undefined || clienteIdFixo === null)) {
    erros.push(
      'O plano precisa de "cliente" (para achar ou criar a OM pelo nome) ou de ' +
      '"pedido.cliente_id" (quando o id ja e conhecido).'
    )
  }

  if (clienteBruto) {
    const r = esquema.validarCorpo(models.cliente, clienteBruto)
    if (!r.ok) {
      erros.push(...r.erros.map(e => `cliente: ${e.mensagem}`))
    }
    if (r.descartados.length) {
      avisos.push(`cliente: campos fora do schema, descartados: ${r.descartados.join(', ')}`)
    }
    cliente = r.valor
  }

  // --- pedido --------------------------------------------------------------
  const pedidoBruto = { ...(plano.pedido || {}) }
  if (pedidoBruto.cliente_id === undefined || pedidoBruto.cliente_id === null) {
    pedidoBruto.cliente_id = CLIENTE_ID_PENDENTE
  }

  const rp = esquema.validarCorpo(models.pedido, pedidoBruto)
  if (!rp.ok) {
    erros.push(...rp.erros.map(e => `pedido: ${e.mensagem}`))
  }
  if (rp.descartados.length) {
    avisos.push(
      `pedido: campos fora do schema, DESCARTADOS em silencio pelo servidor: ` +
      `${rp.descartados.join(', ')}. Confira em: mapoteca schema pedido`
    )
  }
  const pedido = rp.valor

  // --- itens ---------------------------------------------------------------
  const itensBrutos = Array.isArray(plano.itens) ? plano.itens : []
  if (!itensBrutos.length) {
    avisos.push('O plano nao tem itens: o pedido sera criado vazio.')
  }

  const fundidos = fundirDuplicatas(itensBrutos)
  avisos.push(...fundidos.avisos)

  const itens = []
  for (const [i, bruto] of fundidos.itens.entries()) {
    const { corpo, local } = partirItem(bruto)
    const rotulo = local.mi || corpo.nome_avulso || corpo.uuid_versao || `item ${i + 1}`

    // Um destino, e exatamente um: acervo (uuid_versao) OU avulso (nome_avulso).
    // O .xor() do Joi ja recusa os dois juntos; o que se cobre aqui e o item SEM
    // destino nenhum, para a mensagem dizer o que fazer em vez de sair um 400
    // generico depois do round-trip.
    if (!corpo.uuid_versao && !corpo.nome_avulso) {
      erros.push(
        `${rotulo}: sem destino. O item aponta uma versao do acervo (uuid_versao) ou ` +
        `descreve um impresso avulso (nome_avulso). ` +
        `Para o acervo, resolva antes: mapoteca resolver ${local.mi || '<MI>'}`
      )
    }
    if (corpo.pedido_id === undefined || corpo.pedido_id === null) {
      corpo.pedido_id = PEDIDO_ID_PENDENTE
    }

    const ri = esquema.validarCorpo(models.produtoPedido, corpo)
    if (!ri.ok) {
      erros.push(...ri.erros.map(e => `${rotulo}: ${e.mensagem}`))
    }
    if (ri.descartados.length) {
      avisos.push(
        `${rotulo}: campos fora do schema, descartados: ${ri.descartados.join(', ')}`
      )
    }
    itens.push({ corpo: ri.valor, local, rotulo })
  }

  // --- anexos --------------------------------------------------------------
  const anexos = []
  for (const bruto of (Array.isArray(plano.anexos) ? plano.anexos : [])) {
    const r = conferirAnexo(bruto)
    if (r.erros.length) {
      erros.push(...r.erros.map(e => `anexo: ${e}`))
      continue
    }
    const meta = esquema.validarCorpo(models.anexoUploadBody, {
      tipo_anexo_id: bruto.tipo_anexo_id,
      descricao: bruto.descricao
    })
    if (!meta.ok) {
      erros.push(...meta.erros.map(e => `anexo ${path.basename(r.caminho)}: ${e.mensagem}`))
    }
    anexos.push({ caminho: r.caminho, tamanho: r.tamanho, meta: meta.valor })
  }

  return { ok: erros.length === 0, erros, avisos, cliente, pedido, itens, anexos }
}

module.exports = {
  ler,
  validar,
  fundirDuplicatas,
  partirItem,
  conferirAnexo,
  CHAVES_LOCAIS_ITEM,
  CLIENTE_ID_PENDENTE,
  PEDIDO_ID_PENDENTE
}
