// Path: comandos\pedido.js
'use strict'

// Os verbos de INTENCAO do pedido. Nao sao espelho do CRUD: cada um existe
// porque a intencao real do chefe custa varias chamadas encadeadas, ou porque a
// forma da API tem uma armadilha que a interface deve tapar.
//
//   mapoteca pedido cadastrar --plano p.json   documento -> pedido completo
//   mapoteca pedido itens     --id 42          so os itens, recortados
//   mapoteca pedido situacao  --id 42 --situacao 5 --data-atendimento 2026-07-24
//   mapoteca pedido anexar    --id 42 --file DIEx_123.pdf
//   mapoteca pedido anexos    --id 42
//   mapoteca imprimir --item 88 --qtd 5        registra a impressao do item
//
// `cadastrar` e o verbo grande: um pedido nasce de um documento, e cadastra-lo
// pela API crua sao tres rotas sem transacao entre elas mais um id que precisa
// atravessar de uma para a outra. Aqui e uma invocacao, com --dry-run que valida
// TUDO offline antes de tocar a rede.
//
// `situacao` existe por um motivo diferente: o PUT da mapoteca SUBSTITUI a linha
// inteira. Fechar um pedido mandando so {id, situacao_pedido_id} apaga o cliente,
// o prazo, o contato e o documento, calado. Este verbo le o pedido, troca so o
// que muda e reenvia o corpo completo, ja com as datas recortadas em
// 'YYYY-MM-DD' (o servidor as devolve como timestamp ISO e as regrava crua, o
// que num fuso a oeste de Greenwich grava o DIA ANTERIOR).

const fs = require('fs')
const path = require('path')

const http = require('../lib/http')
const saida = require('../lib/saida')
const esquema = require('../lib/schema')
const argsLib = require('../lib/args')
const planoLib = require('../lib/plano')
const {
  obter, carregarSchema, EXTENSOES_ANEXO, MAX_BYTES_ANEXO, MIMES
} = require('../lib/recursos')

const CAMINHO = '/mapoteca/pedido'

function opcoesSaida (flags, padrao) {
  return {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao
  }
}

const models = carregarSchema

// ---------------------------------------------------------------------------
// itens
// ---------------------------------------------------------------------------

async function itens (args, cfg) {
  const id = argsLib.exigir(args.flags, 'id', 'id do pedido')
  const r = await http.autenticada(cfg, 'GET', `${CAMINHO}/${encodeURIComponent(id)}`)
  const pedido = r.dados || {}
  const produtos = Array.isArray(pedido.produtos) ? pedido.produtos : []

  const out = saida.lista(produtos, opcoesSaida(args.flags, obter('item').colunas))

  const cabecalho = [
    `pedido ${pedido.id}  ${pedido.cliente_nome || '(sem cliente)'}  ` +
    `situacao: ${pedido.situacao_pedido_nome || '?'}  prazo: ${esquema.soData(pedido.prazo) || '-'}`,
    ''
  ].join('\n')

  const imp = pedido.impressao || {}
  const rodape = produtos.length
    ? `\nimpressao: ${imp.itens_concluidos || 0} de ${imp.total_itens || 0} itens concluidos`
    : ''

  return { texto: cabecalho + out.texto + rodape, avisos: out.avisos }
}

// ---------------------------------------------------------------------------
// situacao (leitura, alteracao pontual, reenvio do corpo completo)
// ---------------------------------------------------------------------------

async function situacao (args, cfg) {
  const flags = args.flags
  const id = Number(argsLib.exigir(flags, 'id', 'id do pedido'))
  const nova = argsLib.numero(flags, 'situacao', null)
  if (nova === null) {
    throw new Error(
      'Falta --situacao com o code novo. Veja os codes em: mapoteca dominio situacao_pedido'
    )
  }

  const m = models()
  const r = await http.autenticada(cfg, 'GET', `${CAMINHO}/${id}`)
  const atual = r.dados || {}

  // Reconstroi o corpo a partir do que o servidor devolveu, mas SO com as chaves
  // que o schema conhece: a leitura traz dezenas de campos resolvidos por JOIN
  // (cliente_nome, situacao_pedido_nome) que o stripUnknown descartaria.
  const chaves = esquema.camposDe(m.pedidoAtualizacao).map(c => c.nome)
  const camposData = new Set(esquema.camposDataDe(m.pedidoAtualizacao))
  const corpo = {}
  for (const chave of chaves) {
    if (!(chave in atual)) continue
    corpo[chave] = camposData.has(chave) ? esquema.soData(atual[chave]) : atual[chave]
  }
  corpo.id = id
  corpo.situacao_pedido_id = nova

  const dataAtendimento = argsLib.texto(flags, 'data-atendimento')
  if (dataAtendimento) corpo.data_atendimento = dataAtendimento
  const motivo = argsLib.texto(flags, 'motivo')
  if (motivo) corpo.motivo_cancelamento = motivo
  const localizador = argsLib.texto(flags, 'localizador-envio')
  if (localizador) corpo.localizador_envio = localizador
  const obsEnvio = argsLib.texto(flags, 'observacao-envio')
  if (obsEnvio) corpo.observacao_envio = obsEnvio

  const v = esquema.validarCorpo(m.pedidoAtualizacao, corpo)
  if (!v.ok) {
    const erro = new Error(esquema.explicarErro(
      m.pedidoAtualizacao, v.erros,
      'A situacao nova exige campos que o pedido ainda nao tem. Contrato: mapoteca schema pedido'
    ))
    erro.jaFormatado = true
    throw erro
  }

  const antes = atual.situacao_pedido_nome || atual.situacao_pedido_id
  if (flags['dry-run']) {
    return {
      texto: [
        `[dry-run] nada foi GRAVADO. O pedido ${id} iria de "${antes}" para o code ${nova}.`,
        `  PUT /api${CAMINHO}`,
        JSON.stringify(v.valor, null, 2)
      ].join('\n'),
      // Este e o unico --dry-run do CLI que nao e totalmente offline, e dize-lo
      // e obrigatorio: o verbo so existe porque LE o pedido antes de reenvia-lo,
      // e um dry-run que nao lesse mostraria um corpo inventado.
      avisos: [
        'Este dry-run fez um GET do pedido (leitura) para montar o corpo completo. ' +
        'Nenhuma escrita ocorreu.'
      ]
    }
  }

  const resp = await http.autenticada(cfg, 'PUT', CAMINHO, { corpo: v.valor })

  // Le de volta: a mensagem de sucesso do servidor nao e prova de gravacao, e
  // "disse OK e nada gravou" e a familia de erro que mais custou tempo aqui.
  await http.pausa()
  const conferencia = await http.autenticada(cfg, 'GET', `${CAMINHO}/${id}`)
  const depois = (conferencia.dados || {}).situacao_pedido_id

  const avisos = []
  if (Number(depois) !== Number(nova)) {
    avisos.push(
      `CONFERENCIA FALHOU: reli o pedido ${id} e a situacao esta ${depois}, nao ${nova}. ` +
      'Nao presuma que gravou.'
    )
  }

  return {
    texto: `${resp.message || 'ok'}\npedido ${id}: "${antes}" -> ` +
      `"${(conferencia.dados || {}).situacao_pedido_nome || nova}" (conferido lendo de volta).`,
    avisos
  }
}

// ---------------------------------------------------------------------------
// anexos
// ---------------------------------------------------------------------------

function conferirArquivo (caminho) {
  if (!fs.existsSync(caminho)) throw new Error(`Arquivo nao encontrado: ${caminho}`)
  const ext = path.extname(caminho).toLowerCase()
  if (!EXTENSOES_ANEXO.includes(ext)) {
    throw new Error(
      `Extensao ${ext || '(sem extensao)'} nao aceita. Aceitas: ${EXTENSOES_ANEXO.join(', ')}`
    )
  }
  const bytes = fs.readFileSync(caminho)
  if (bytes.length > MAX_BYTES_ANEXO) {
    throw new Error(
      `${path.basename(caminho)} tem ${(bytes.length / 1024 / 1024).toFixed(1)} MB; ` +
      `o limite do servidor e ${MAX_BYTES_ANEXO / 1024 / 1024} MB.`
    )
  }
  return { bytes, ext }
}

async function enviarAnexo (cfg, pedidoId, caminho, meta) {
  const { bytes, ext } = conferirArquivo(caminho)
  const mp = http.multipart(
    { tipo_anexo_id: meta.tipo_anexo_id, descricao: meta.descricao },
    {
      campo: 'arquivo',
      nome: caminho,
      conteudo: bytes,
      mime: MIMES[ext] || 'application/octet-stream'
    }
  )
  const r = await http.autenticada(
    cfg, 'POST', `${CAMINHO}/${pedidoId}/anexos`,
    { bytes: mp.bytes, contentType: mp.contentType }
  )
  return { resposta: r, tamanho: bytes.length }
}

async function anexar (args, cfg) {
  const flags = args.flags
  const id = argsLib.exigir(flags, 'id', 'id do pedido')
  const arquivo = argsLib.exigir(flags, 'file', 'caminho do arquivo a anexar')

  const m = models()
  const meta = esquema.validarCorpo(m.anexoUploadBody, {
    tipo_anexo_id: argsLib.numero(flags, 'tipo-anexo', undefined),
    descricao: argsLib.texto(flags, 'descricao')
  })
  if (!meta.ok) {
    const erro = new Error(esquema.explicarErro(m.anexoUploadBody, meta.erros))
    erro.jaFormatado = true
    throw erro
  }

  if (flags['dry-run']) {
    const { bytes } = conferirArquivo(arquivo)
    return {
      texto: `[dry-run] nada foi enviado. Seria: POST /api${CAMINHO}/${id}/anexos com ` +
        `${path.basename(arquivo)} (${bytes.length} bytes), ` +
        `tipo_anexo_id=${meta.valor.tipo_anexo_id}.`
    }
  }

  const { resposta, tamanho } = await enviarAnexo(cfg, id, arquivo, meta.valor)
  const lista = Array.isArray(resposta.dados) ? resposta.dados : []
  return {
    texto: `${resposta.message || 'anexado'} (${path.basename(arquivo)}, ${tamanho} bytes). ` +
      `O pedido ${id} tem agora ${lista.length} anexo(s).`,
    avisos: [
      'O nome do arquivo e o que fica gravado no banco: e por ele que a mapoteca acha o ' +
      'documento depois. Nome opaco de sistema (uuid.pdf) nao ajuda ninguem.'
    ]
  }
}

async function anexos (args, cfg) {
  const id = argsLib.exigir(args.flags, 'id', 'id do pedido')
  const r = await http.autenticada(cfg, 'GET', `${CAMINHO}/${encodeURIComponent(id)}/anexos`)
  const out = saida.lista(r.dados, opcoesSaida(args.flags, [
    'id', 'tipo_anexo_nome', 'nome_original', 'tamanho_bytes', 'descricao', 'data_cadastramento'
  ]))
  return { texto: out.texto, avisos: out.avisos }
}

// ---------------------------------------------------------------------------
// imprimir (registro da impressao de um item)
// ---------------------------------------------------------------------------

async function imprimir (args, cfg) {
  const flags = args.flags
  const item = Number(argsLib.exigir(flags, 'item', 'id do item do pedido (produto_pedido)'))
  const qtd = argsLib.numero(flags, 'qtd', null)
  if (qtd === null) throw new Error('Falta --qtd com quantas folhas foram impressas.')

  const m = models()
  const corpo = {
    registros: [{
      produto_pedido_id: item,
      quantidade: qtd,
      observacao: argsLib.texto(flags, 'observacao')
    }]
  }

  const v = esquema.validarCorpo(m.registroImpressao, corpo)
  if (!v.ok) {
    const erro = new Error(esquema.explicarErro(
      m.registroImpressao, v.erros,
      'A quantidade e quantas folhas sairam AGORA, nao o total do item: o impresso e a ' +
      'soma dos registros. Progresso do item: mapoteca pedido itens --id <pedido>'
    ))
    erro.jaFormatado = true
    throw erro
  }

  if (flags['dry-run']) {
    return {
      texto: `[dry-run] nada foi enviado. Seria: POST /api/mapoteca/impressao\n` +
        JSON.stringify(v.valor, null, 2)
    }
  }

  const r = await http.autenticada(cfg, 'POST', '/mapoteca/impressao', { corpo: v.valor })

  // O total impresso e a SOMA dos registros: sem ler de volta nao da para saber
  // se o item ficou concluido ou se ainda falta tiragem.
  await http.pausa()
  const hist = await http.autenticada(cfg, 'GET', `/mapoteca/produto_pedido/${item}/impressao`)
  const h = hist.dados || {}

  return {
    texto: `${r.message || 'impressao registrada'}\n` +
      `item ${item}: pedido ${h.quantidade}, impresso ${h.quantidade_impressa}, ` +
      `restante ${h.quantidade_restante}` +
      `${h.impressao_concluida ? ' (concluido)' : ''}`
  }
}

// ---------------------------------------------------------------------------
// cadastrar (o verbo grande)
// ---------------------------------------------------------------------------

function resumoDoPlano (validado) {
  const linhas = []
  if (validado.cliente) {
    linhas.push(`cliente   ${validado.cliente.nome} (tipo ${validado.cliente.tipo_cliente_id})`)
  } else {
    linhas.push(`cliente   id ${validado.pedido.cliente_id} (fixado no plano)`)
  }
  linhas.push(
    `pedido    ${esquema.soData(validado.pedido.data_pedido)}  ` +
    `situacao ${validado.pedido.situacao_pedido_id}  ` +
    `doc ${validado.pedido.documento_solicitacao || '-'}  ` +
    `NUP ${validado.pedido.documento_solicitacao_nup || '-'}  ` +
    `prazo ${esquema.soData(validado.pedido.prazo) || '-'}`
  )
  linhas.push(`itens     ${validado.itens.length}`)
  for (const item of validado.itens) {
    linhas.push(
      `  ${String(item.rotulo).padEnd(14)} qtd ${String(item.corpo.quantidade).padStart(4)}  ` +
      `midia ${item.corpo.tipo_midia_id}  ${item.corpo.uuid_versao || '(SEM VERSAO)'}`
    )
  }
  linhas.push(`anexos    ${validado.anexos.length}`)
  for (const a of validado.anexos) {
    linhas.push(`  ${path.basename(a.caminho)} (${a.tamanho} bytes, tipo ${a.meta.tipo_anexo_id})`)
  }
  return linhas.join('\n')
}

async function acharOuCriarCliente (cfg, cliente, avisos) {
  const r = await http.autenticada(cfg, 'GET', '/mapoteca/cliente')
  const existentes = Array.isArray(r.dados) ? r.dados : []
  const alvo = String(cliente.nome).trim().toLowerCase()
  const achado = existentes.find(c => String(c.nome).trim().toLowerCase() === alvo)

  if (achado) return { id: achado.id, criado: false }

  // Nao ha busca no servidor e o nome tem de bater exato para reusar. Antes de
  // criar, avisa: e aqui que a mesma OM entra duas vezes na base.
  avisos.push(
    `Nenhum cliente com o nome exato "${cliente.nome}" entre os ${existentes.length} ` +
    'cadastrados: vou CRIAR um novo. Se a OM ja existir com outra grafia, isso duplica o ' +
    `cadastro. Confira antes com: mapoteca cliente resolver "${cliente.nome}"`
  )

  await http.pausa()
  await http.autenticada(cfg, 'POST', '/mapoteca/cliente', { corpo: cliente })

  // O POST de cliente nao devolve o id: a unica forma de descobri-lo e reler a
  // lista. Nao e elegante, e a alternativa (adivinhar) e pior.
  await http.pausa()
  const depois = await http.autenticada(cfg, 'GET', '/mapoteca/cliente')
  const novo = (Array.isArray(depois.dados) ? depois.dados : [])
    .find(c => String(c.nome).trim().toLowerCase() === alvo)

  if (!novo) {
    throw new Error(
      `Criei o cliente "${cliente.nome}" mas nao o encontrei ao reler a lista. ` +
      'Nao vou seguir cadastrando o pedido as cegas.'
    )
  }
  return { id: novo.id, criado: true }
}

async function acharPedidoExistente (cfg, pedido) {
  const nup = pedido.documento_solicitacao_nup
  const doc = pedido.documento_solicitacao
  if (!nup && !doc) return null

  const r = await http.autenticada(cfg, 'GET', CAMINHO)
  const pedidos = Array.isArray(r.dados) ? r.dados : []

  // O NUP e a chave pratica de deduplicacao; o numero do documento e a segunda.
  if (nup) {
    const porNup = pedidos.find(p => p.documento_solicitacao_nup === nup)
    if (porNup) return { pedido: porNup, chave: `NUP ${nup}` }
  }
  if (doc) {
    const porDoc = pedidos.find(p => p.documento_solicitacao === doc)
    if (porDoc) return { pedido: porDoc, chave: `documento ${doc}` }
  }
  return null
}

async function cadastrar (args, cfg) {
  const flags = args.flags
  const caminhoPlano = argsLib.texto(flags, 'plano')
  if (!caminhoPlano) {
    throw new Error(
      'cadastrar exige --plano pedido.json (cliente, pedido, itens e anexos num arquivo so).\n' +
      'Formato e regras: mapoteca schema pedido  e  mapoteca schema item'
    )
  }

  const m = models()
  const bruto = planoLib.ler(caminhoPlano)
  const validado = planoLib.validar(bruto, m)

  if (!validado.ok) {
    const erro = new Error([
      'Plano invalido (validado localmente, nada foi enviado):',
      '',
      ...validado.erros.map(e => '  ' + e),
      '',
      'contrato: mapoteca schema pedido | mapoteca schema item'
    ].join('\n'))
    erro.jaFormatado = true
    erro.avisos = validado.avisos
    throw erro
  }

  if (flags['dry-run']) {
    return {
      texto: [
        '[dry-run] nada foi enviado, nenhuma credencial foi usada, a rede nao foi tocada.',
        'O plano abaixo passou na validacao contra os schemas vivos do server/.',
        '',
        resumoDoPlano(validado),
        '',
        'Sequencia que seria executada:',
        `  1. GET  /api/mapoteca/cliente            (achar${validado.cliente ? ' ou criar' : ''} o cliente)`,
        '  2. GET  /api/mapoteca/pedido             (procurar duplicata por NUP)',
        '  3. POST /api/mapoteca/pedido',
        `  4. POST /api/mapoteca/produto_pedido     x ${validado.itens.length}`,
        `  5. POST /api/mapoteca/pedido/<id>/anexos x ${validado.anexos.length}`,
        '  6. GET  /api/mapoteca/pedido/<id>        (conferencia lendo de volta)'
      ].join('\n'),
      avisos: validado.avisos
    }
  }

  const avisos = [...validado.avisos]
  const relato = []

  // --- cliente -------------------------------------------------------------
  let clienteId = validado.pedido.cliente_id
  if (clienteId === planoLib.CLIENTE_ID_PENDENTE) {
    const r = await acharOuCriarCliente(cfg, validado.cliente, avisos)
    clienteId = r.id
    relato.push(`cliente   ${validado.cliente.nome} -> id ${clienteId}${r.criado ? ' (criado agora)' : ''}`)
  } else {
    relato.push(`cliente   id ${clienteId} (fixado no plano)`)
  }

  // --- pedido (idempotente por NUP) ---------------------------------------
  const corpoPedido = { ...validado.pedido, cliente_id: clienteId }
  let pedidoId = null

  if (!flags.novo) {
    await http.pausa()
    const existente = await acharPedidoExistente(cfg, corpoPedido)
    if (existente) {
      pedidoId = existente.pedido.id
      relato.push(
        `pedido    ja existia (${existente.chave}) -> id ${pedidoId}. ` +
        'Nao recriei; vou completar o que falta.'
      )
      avisos.push(
        `Este pedido ja estava cadastrado (${existente.chave}). Os campos do pedido NAO foram ` +
        'atualizados (um PUT substituiria a linha inteira). Se a intencao era corrigir o ' +
        `pedido, use: mapoteca pedido atualizar --id ${pedidoId} --data '{...}' com o corpo completo. ` +
        'Para forcar um pedido novo mesmo assim, use --novo.'
      )
    }
  }

  if (pedidoId === null) {
    await http.pausa()
    const criado = await http.autenticada(cfg, 'POST', CAMINHO, { corpo: corpoPedido })
    const dados = criado.dados || {}
    pedidoId = dados.id
    if (!pedidoId) {
      throw new Error(
        'O POST do pedido respondeu sem id. Nao vou criar os itens as cegas: ' +
        'confira em mapoteca pedido listar se o pedido entrou e complete com o mesmo plano.'
      )
    }
    relato.push(`pedido    criado id ${pedidoId}, localizador ${dados.localizador_pedido || '-'}`)
  }

  // --- itens (idempotentes por uuid_versao) -------------------------------
  await http.pausa()
  const atual = await http.autenticada(cfg, 'GET', `${CAMINHO}/${pedidoId}`)
  const jaTem = new Set(
    ((atual.dados && atual.dados.produtos) || []).map(p => p.uuid_versao)
  )

  let criados = 0
  let pulados = 0
  for (const item of validado.itens) {
    if (jaTem.has(item.corpo.uuid_versao)) {
      pulados++
      continue
    }
    await http.pausa()
    try {
      await http.autenticada(cfg, 'POST', '/mapoteca/produto_pedido', {
        corpo: { ...item.corpo, pedido_id: pedidoId }
      })
      criados++
    } catch (err) {
      // Nao aborta o lote: um item que falha nao deve impedir os outros, e o
      // agente precisa saber exatamente qual folha ficou de fora.
      avisos.push(`item ${item.rotulo}: FALHOU (${err.message}). Os demais seguiram.`)
    }
  }
  relato.push(`itens     ${criados} criado(s), ${pulados} ja existiam`)

  // --- anexos (idempotentes por nome de arquivo) ---------------------------
  let anexados = 0
  if (validado.anexos.length) {
    await http.pausa()
    const jaAnexados = await http.autenticada(cfg, 'GET', `${CAMINHO}/${pedidoId}/anexos`)
    const nomes = new Set(
      (Array.isArray(jaAnexados.dados) ? jaAnexados.dados : []).map(a => a.nome_original)
    )

    for (const anexo of validado.anexos) {
      const nome = path.basename(anexo.caminho)
      if (nomes.has(nome)) {
        avisos.push(`anexo ${nome}: ja estava no pedido, nao reenviei.`)
        continue
      }
      await http.pausa()
      try {
        await enviarAnexo(cfg, pedidoId, anexo.caminho, anexo.meta)
        anexados++
      } catch (err) {
        // O pedido JA existe: nunca repita o cadastro inteiro por causa do anexo.
        avisos.push(
          `anexo ${nome}: FALHOU (${err.message}). O pedido ${pedidoId} JA esta gravado; ` +
          `NAO repita o cadastrar. Reenvie so o anexo:\n` +
          `  mapoteca pedido anexar --id ${pedidoId} --file ${anexo.caminho}`
        )
      }
    }
  }
  relato.push(`anexos    ${anexados} enviado(s)`)

  // --- conferencia lendo de volta -----------------------------------------
  if (!flags['sem-verificacao']) {
    await http.pausa()
    const fim = await http.autenticada(cfg, 'GET', `${CAMINHO}/${pedidoId}`)
    const p = fim.dados || {}
    const totalItens = Array.isArray(p.produtos) ? p.produtos.length : 0
    relato.push(
      `conferido pedido ${pedidoId}: ${totalItens} item(ns) no servidor, ` +
      `esperados ${validado.itens.length}`
    )
    if (totalItens !== validado.itens.length) {
      avisos.push(
        `CONFERENCIA: o servidor tem ${totalItens} itens e o plano tinha ` +
        `${validado.itens.length}. Rode o mesmo plano de novo para completar (e idempotente).`
      )
    }
  }

  relato.push('')
  relato.push(`detalhe: mapoteca pedido itens --id ${pedidoId}`)
  return { texto: relato.join('\n'), avisos }
}

// ---------------------------------------------------------------------------

const VERBOS = { cadastrar, itens, situacao, anexar, anexos, imprimir }

async function executar (args, cfg) {
  // `mapoteca imprimir` e verbo de topo; os demais sao subcomandos de pedido.
  const verbo = args._[0] === 'imprimir' ? 'imprimir' : args._[1]
  const fn = VERBOS[verbo]
  if (!fn) {
    throw new Error(
      `Verbo desconhecido "${verbo}" para pedido. Verbos de intencao: ` +
      `${Object.keys(VERBOS).join(', ')}. CRUD: listar, obter, criar, atualizar, deletar.`
    )
  }
  return fn(args, cfg)
}

module.exports = { executar, precisaServidor: true, VERBOS, resumoDoPlano }
