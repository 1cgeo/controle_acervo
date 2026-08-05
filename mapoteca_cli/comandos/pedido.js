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
//   mapoteca pedido anexo baixar --id 7 --para conferir.pdf
//   mapoteca pedido anexo apagar --ids 7 --confirmar 7
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
const crypto = require('crypto')

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
// anexo baixar / anexo apagar
// ---------------------------------------------------------------------------
//
// Sem o download nao se prova o CONTEUDO do que subiu, so o TAMANHO, e tamanho e
// prova fraca: dois PDF diferentes com o mesmo numero de bytes passam. Por isso
// o baixar imprime o sha256 do que chegou.

/**
 * `mapoteca pedido anexo baixar --id <anexoId> [--para <arquivo>]`
 *
 * Sem `--para`, grava como `anexo_<id>`, sem extensao: o nome original vem no
 * Content-Disposition, e esta camada HTTP nao devolve cabecalho. Use `--para`
 * quando o nome importar. Recusa sobrescrever arquivo que ja existe: baixar
 * para conferir nao pode apagar o original com que se compara.
 */
async function anexoBaixar (args, cfg) {
  const flags = args.flags
  const id = argsLib.exigir(flags, 'id', 'id do ANEXO (nao o do pedido)')
  const destinoPedido = argsLib.texto(flags, 'para', null)

  if (flags['dry-run']) {
    return {
      texto: `[dry-run] nada foi baixado. Seria: GET /api${CAMINHO}/anexo/${id}/download`
    }
  }

  const r = await http.autenticada(
    cfg, 'GET', `${CAMINHO}/anexo/${encodeURIComponent(id)}/download`,
    { binario: true }
  )

  const bytes = r.bytes
  const destino = destinoPedido || `anexo_${id}`

  if (fs.existsSync(destino)) {
    const erro = new Error(
      `"${destino}" ja existe e nao foi sobrescrito. Escolha outro nome com --para.`
    )
    erro.jaFormatado = true
    throw erro
  }

  fs.writeFileSync(destino, bytes)
  const sha = crypto.createHash('sha256').update(bytes).digest('hex')

  return {
    texto: `anexo ${id} gravado em ${destino} (${bytes.length} bytes)\nsha256    ${sha}`,
    avisos: [
      'Compare o sha256 com o do arquivo de origem para provar o CONTEUDO. ' +
      'Tamanho igual nao prova nada: dois PDF diferentes podem ter os mesmos bytes de tamanho.'
    ]
  }
}

/**
 * `mapoteca pedido anexo apagar --ids <a,b> --confirmar <a,b>`
 *
 * Mesma convencao do `deletar` do CRUD: a confirmacao repete a lista INTEIRA,
 * porque confirmar "42" quando se pediu "42,43" e exatamente o acidente que o
 * guardrail existe para impedir.
 */
async function anexoApagar (args, cfg) {
  const flags = args.flags
  const ids = (argsLib.lista(flags.ids) || []).map(v => {
    const n = Number(v)
    if (!Number.isInteger(n) || n <= 0) {
      const erro = new Error(`--ids aceita id inteiro positivo, e veio "${v}".`)
      erro.jaFormatado = true
      throw erro
    }
    return n
  })

  if (!ids.length) {
    const erro = new Error('anexo apagar exige --ids com ao menos um id de anexo.')
    erro.jaFormatado = true
    throw erro
  }

  // O --dry-run nao escreve, entao ele nao exige a confirmacao: e ele que mostra
  // o que a confirmacao autorizaria.
  if (flags['dry-run']) {
    return {
      texto: [
        `[dry-run] nada foi apagado. Seriam ${ids.length}: ` +
          ids.map(i => `DELETE /api${CAMINHO}/anexo/${i}`).join(', '),
        'Para apagar de fato:',
        `  mapoteca pedido anexo apagar --ids ${ids.join(',')} --confirmar ${ids.join(',')}`
      ].join('\n')
    }
  }

  const confirmacao = argsLib.lista(flags.confirmar) || []
  const bate = confirmacao.length === ids.length &&
    confirmacao.every((v, i) => Number(v) === ids[i])

  if (!bate) {
    const erro = new Error([
      `Exclusao de ${ids.length} anexo(s) e IRREVERSIVEL e nao foi confirmada.`,
      'O byte do anexo vive no banco: apagado, nao ha de onde recuperar.',
      'Para apagar de fato, repita a mesma lista em --confirmar:',
      `  mapoteca pedido anexo apagar --ids ${ids.join(',')} --confirmar ${ids.join(',')}`,
      'Para so ver o que aconteceria: acrescente --dry-run.'
    ].join('\n'))
    erro.jaFormatado = true
    throw erro
  }

  const apagados = []
  for (const id of ids) {
    await http.autenticada(cfg, 'DELETE', `${CAMINHO}/anexo/${encodeURIComponent(id)}`)
    apagados.push(id)
  }

  return { texto: `anexo(s) apagado(s): ${apagados.join(', ')}` }
}

/** Roteia `pedido anexo <baixar|apagar>`. */
async function anexo (args, cfg) {
  const acao = args._[2]
  if (acao === 'baixar') return anexoBaixar(args, cfg)
  if (acao === 'apagar') return anexoApagar(args, cfg)
  throw new Error(
    `Acao desconhecida "${acao || ''}" para anexo. Use: baixar, apagar. ` +
    'Para enviar, o verbo e `pedido anexar`; para listar, `pedido anexos`.'
  )
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

/** Ano de calendario de uma data 'YYYY-MM-DD', sem passar por Date (que muda o dia no fuso). */
function anoDaData (valor) {
  const casa = String(valor || '').match(/^(\d{4})-\d{2}-\d{2}/)
  return casa ? Number(casa[1]) : null
}

async function acharPedidoExistente (cfg, pedido, clienteId) {
  const nup = pedido.documento_solicitacao_nup
  const doc = pedido.documento_solicitacao
  if (!nup && !doc) return null

  // A listagem do servidor e de UM ano so, e sem `ano` na query ela cai no ano
  // corrente. Procurar a duplicata de um pedido de 2025 na lista de 2026 nunca
  // acha nada, e o comando recria o pedido em silencio. O ano sai da data do
  // proprio pedido que se vai cadastrar.
  const ano = anoDaData(pedido.data_pedido)
  const r = await http.autenticada(cfg, 'GET', CAMINHO + http.query({ ano }))
  const todos = Array.isArray(r.dados) ? r.dados : []

  // A deduplicacao e por (documento, CLIENTE), nunca so pelo documento. Um DIEx
  // que encaminha a demanda de varias OM gera um pedido POR CLIENTE, sob o mesmo
  // NUP: sem o recorte por cliente, o 2o pedido cairia dentro do 1o e os itens de
  // todas as OM virariam um pedido so, em silencio.
  // O cliente_id da listagem volta como STRING; comparar como texto.
  const pedidos = clienteId == null
    ? todos
    : todos.filter(p => String(p.cliente_id) === String(clienteId))
  const escopo = clienteId == null ? '' : ` + cliente ${clienteId}`

  // O NUP e a chave pratica de deduplicacao; o numero do documento e a segunda.
  if (nup) {
    const porNup = pedidos.find(p => p.documento_solicitacao_nup === nup)
    if (porNup) return { pedido: porNup, chave: `NUP ${nup}${escopo}` }
  }
  if (doc) {
    const porDoc = pedidos.find(p => p.documento_solicitacao === doc)
    if (porDoc) return { pedido: porDoc, chave: `documento ${doc}${escopo}` }
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
  // O diretorio do PLANO resolve o caminho relativo do anexo: eles andam
  // juntos, e o comando pode ser chamado de qualquer pasta.
  const validado = planoLib.validar(bruto, m, path.dirname(path.resolve(caminhoPlano)))

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
    const existente = await acharPedidoExistente(cfg, corpoPedido, clienteId)
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
// corrigir (leitura, alteracao de campos avulsos, reenvio do corpo completo)
// ---------------------------------------------------------------------------

/**
 * Converte 'campo=valor' da linha de comando para o tipo que o Joi espera.
 *
 * So tres conversoes, e todas explicitas: 'null' vira null, 'true'/'false'
 * viram booleano, e o resto fica string. Numero NAO se adivinha: o unico campo
 * numerico editavel aqui e cliente_id, e passar '65' como string faria o Joi
 * reclamar em vez de gravar o pedido na OM errada calado.
 */
function valorDoSet (bruto) {
  if (bruto === 'null') return null
  if (bruto === 'true') return true
  if (bruto === 'false') return false
  return bruto
}

async function corrigir (args, cfg) {
  const flags = args.flags
  const id = Number(argsLib.exigir(flags, 'id', 'id do pedido'))
  // Os pares campo=valor vao POSICIONAIS, depois do verbo: uma flag repetida
  // sobrescreveria a anterior e a correcao sairia pela metade, sem aviso.
  const pares = args._.slice(2)
  if (pares.length === 0) {
    throw new Error(
      'Falta o que corrigir. Use pares campo=valor depois do verbo, por exemplo:\n' +
      '  mapoteca pedido corrigir --id 29 documento_solicitacao="PIT 07" previsto_pit=true meta_pit_id=8'
    )
  }

  const m = models()
  const chaves = esquema.camposDe(m.pedidoAtualizacao).map(c => c.nome)
  const camposData = new Set(esquema.camposDataDe(m.pedidoAtualizacao))

  const mudancas = {}
  for (const par of pares) {
    const igual = par.indexOf('=')
    if (igual === -1) {
      throw new Error(`"${par}" nao e um par campo=valor.`)
    }
    const campo = par.slice(0, igual)
    if (!chaves.includes(campo)) {
      throw new Error(
        `O pedido nao tem o campo "${campo}". Campos: ${chaves.join(', ')}.\n` +
        'Contrato completo: mapoteca schema pedido'
      )
    }
    mudancas[campo] = valorDoSet(par.slice(igual + 1))
  }
  if ('id' in mudancas) throw new Error('O id nao se corrige: ele identifica a linha.')

  const r = await http.autenticada(cfg, 'GET', `${CAMINHO}/${id}`)
  const atual = r.dados || {}
  if (!atual.id) throw new Error(`Pedido ${id} nao encontrado.`)

  // O PUT da mapoteca SUBSTITUI a linha. Reenviar so o campo que muda apaga o
  // cliente, o prazo e o documento, calado. Por isso o corpo se remonta inteiro
  // a partir da leitura, com as chaves que o schema conhece (a leitura traz
  // dezenas de campos de JOIN que o stripUnknown descartaria).
  const corpo = {}
  for (const chave of chaves) {
    if (!(chave in atual)) continue
    corpo[chave] = camposData.has(chave) ? esquema.soData(atual[chave]) : atual[chave]
  }
  corpo.id = id
  const antes = {}
  for (const [campo, valor] of Object.entries(mudancas)) {
    antes[campo] = corpo[campo] === undefined ? null : corpo[campo]
    corpo[campo] = camposData.has(campo) ? esquema.soData(valor) : valor
  }

  const v = esquema.validarCorpo(m.pedidoAtualizacao, corpo)
  if (!v.ok) {
    const erro = new Error(esquema.explicarErro(
      m.pedidoAtualizacao, v.erros,
      'A correcao deixou o pedido invalido. Contrato: mapoteca schema pedido'
    ))
    erro.jaFormatado = true
    throw erro
  }

  const diff = Object.keys(mudancas).map(campo =>
    `  ${campo}: ${JSON.stringify(antes[campo])} -> ${JSON.stringify(corpo[campo])}`
  )
  const inertes = Object.keys(mudancas).filter(c =>
    JSON.stringify(antes[c]) === JSON.stringify(corpo[c])
  )

  if (flags['dry-run']) {
    return {
      texto: [
        `[dry-run] nada foi GRAVADO. O pedido ${id} mudaria assim:`,
        ...diff,
        '',
        `  PUT /api${CAMINHO}  (corpo completo, ${Object.keys(v.valor).length} campos)`
      ].join('\n'),
      avisos: [
        'Este dry-run fez um GET do pedido (leitura) para montar o corpo completo. ' +
        'Nenhuma escrita ocorreu.',
        ...(inertes.length ? [`Sem efeito (ja estava assim): ${inertes.join(', ')}.`] : [])
      ]
    }
  }

  const resp = await http.autenticada(cfg, 'PUT', CAMINHO, { corpo: v.valor })

  // Le de volta: a resposta do servidor e eco dela mesma, nunca prova.
  await http.pausa()
  const conferencia = await http.autenticada(cfg, 'GET', `${CAMINHO}/${id}`)
  const depois = conferencia.dados || {}

  const avisos = []
  const naoConferidos = []
  for (const [campo, esperado] of Object.entries(mudancas)) {
    if (!(campo in depois)) {
      // O campo existe no schema mas a rota de leitura nao o devolve: nao da
      // para provar a gravacao por aqui, e dizer isso e melhor que calar.
      naoConferidos.push(campo)
      continue
    }
    const lido = camposData.has(campo) ? esquema.soData(depois[campo]) : depois[campo]
    if (JSON.stringify(lido) !== JSON.stringify(corpo[campo])) {
      avisos.push(
        `CONFERENCIA FALHOU em "${campo}": reli o pedido ${id} e o valor e ` +
        `${JSON.stringify(lido)}, nao ${JSON.stringify(corpo[campo])}. Nao presuma que gravou.`
      )
    }
  }
  if (naoConferidos.length) {
    avisos.push(
      `Nao consegui conferir ${naoConferidos.join(', ')}: a rota de leitura do pedido ` +
      'nao devolve esse(s) campo(s) nesta versao do servidor. Confira por outro caminho ' +
      'antes de dar por gravado.'
    )
  }

  return {
    texto: [`${resp.message || 'ok'}`, `pedido ${id} corrigido (conferido lendo de volta):`, ...diff].join('\n'),
    avisos
  }
}

// ---------------------------------------------------------------------------
// mover (item de um pedido para outro, sem apagar e recriar)
// ---------------------------------------------------------------------------

/**
 * Move itens de um pedido para outro trocando `pedido_id`.
 *
 * Existe porque a carga historica prendeu os itens de um documento no pedido de
 * OUTRO documento, e o conserto obvio (apagar la e cadastrar aqui) perderia
 * quantidade_fornecida e observacao, alem de ser irreversivel. O
 * PUT do produto_pedido aceita pedido_id, entao mover e uma ATUALIZACAO.
 */
async function mover (args, cfg) {
  const flags = args.flags
  const de = Number(argsLib.exigir(flags, 'de', 'id do pedido de origem'))
  const para = Number(argsLib.exigir(flags, 'para', 'id do pedido de destino'))
  if (de === para) throw new Error('Origem e destino sao o mesmo pedido.')

  const m = models()
  const origem = (await http.autenticada(cfg, 'GET', `${CAMINHO}/${de}`)).dados || {}
  if (!origem.id) throw new Error(`Pedido de origem ${de} nao encontrado.`)
  const destino = (await http.autenticada(cfg, 'GET', `${CAMINHO}/${para}`)).dados || {}
  if (!destino.id) throw new Error(`Pedido de destino ${para} nao encontrado.`)

  const todos = Array.isArray(origem.produtos) ? origem.produtos : []
  // lista() devolve null quando a flag falta; aqui "sem --ids" significa todos.
  const filtro = argsLib.lista(flags.ids) || []
  const alvo = filtro.length
    ? todos.filter(i => filtro.includes(String(i.id)))
    : todos
  if (!alvo.length) {
    throw new Error(
      filtro.length
        ? `Nenhum dos ids ${filtro.join(', ')} esta no pedido ${de}.`
        : `O pedido ${de} nao tem itens para mover.`
    )
  }
  if (filtro.length && alvo.length !== filtro.length) {
    const achados = new Set(alvo.map(i => String(i.id)))
    throw new Error(
      `Estes ids nao estao no pedido ${de}: ${filtro.filter(x => !achados.has(x)).join(', ')}. ` +
      'Nada foi movido.'
    )
  }

  const chaves = esquema.camposDe(m.produtoPedidoAtualizacao).map(c => c.nome)
  const camposData = new Set(esquema.camposDataDe(m.produtoPedidoAtualizacao))
  const corpos = []
  for (const item of alvo) {
    // Mesmo cuidado do pedido: o PUT substitui a linha inteira, entao o corpo
    // se remonta a partir da leitura e so pedido_id muda.
    const corpo = {}
    for (const chave of chaves) {
      if (!(chave in item)) continue
      corpo[chave] = camposData.has(chave) ? esquema.soData(item[chave]) : item[chave]
    }
    corpo.id = item.id
    corpo.pedido_id = para
    const v = esquema.validarCorpo(m.produtoPedidoAtualizacao, corpo)
    if (!v.ok) {
      const erro = new Error(esquema.explicarErro(
        m.produtoPedidoAtualizacao, v.erros,
        `O item ${item.id} (${item.mi || item.produto_nome}) nao passa no contrato. Nada foi movido.`
      ))
      erro.jaFormatado = true
      throw erro
    }
    corpos.push({ item, corpo: v.valor })
  }

  const linhas = corpos.map(({ item }) =>
    `  item ${item.id}  ${item.mi || item.produto_nome || '-'}  ${item.escala || ''}  ` +
    `q=${item.quantidade}  forn=${item.quantidade_fornecida === null ? '-' : item.quantidade_fornecida}`
  )
  const cabecalho =
    `${alvo.length} item(ns) de #${de} "${origem.documento_solicitacao || '-'}" ` +
    `-> #${para} "${destino.documento_solicitacao || '-'}"`

  if (flags['dry-run']) {
    return {
      texto: [`[dry-run] nada foi GRAVADO. ${cabecalho}`, ...linhas].join('\n'),
      avisos: [
        'Este dry-run leu os dois pedidos para montar os corpos completos. Nenhuma escrita ocorreu.',
        'As rotas nao tem transacao entre si: se a execucao parar no meio, parte dos itens ' +
        'fica no destino. Rodar de novo com os ids que sobraram completa o movimento.'
      ]
    }
  }

  let gravados = 0
  const avisos = []
  for (const { item, corpo } of corpos) {
    try {
      await http.autenticada(cfg, 'PUT', '/mapoteca/produto_pedido', { corpo })
      gravados++
    } catch (e) {
      avisos.push(
        `PAROU no item ${item.id}: ${e.message}. ${gravados} item(ns) ja foram movidos; ` +
        'os demais seguem na origem. Rode de novo com --ids dos que faltam.'
      )
      break
    }
    await http.pausa()
  }

  // Conferencia independente: reler os DOIS pedidos e contar.
  const origemDepois = (await http.autenticada(cfg, 'GET', `${CAMINHO}/${de}`)).dados || {}
  const destinoDepois = (await http.autenticada(cfg, 'GET', `${CAMINHO}/${para}`)).dados || {}
  const nOrigem = (origemDepois.produtos || []).length
  const nDestino = (destinoDepois.produtos || []).length
  const esperadoOrigem = todos.length - gravados
  if (nOrigem !== esperadoOrigem) {
    avisos.push(
      `CONFERENCIA: o pedido ${de} ficou com ${nOrigem} itens, e eu esperava ${esperadoOrigem}.`
    )
  }

  return {
    texto: [
      `${gravados} de ${alvo.length} item(ns) movidos (conferido lendo os dois pedidos).`,
      cabecalho,
      `  #${de} agora tem ${nOrigem} itens`,
      `  #${para} agora tem ${nDestino} itens`
    ].join('\n'),
    avisos
  }
}

// ---------------------------------------------------------------------------

const VERBOS = { cadastrar, itens, situacao, corrigir, mover, anexar, anexos, anexo, imprimir }

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

module.exports = {
  executar, precisaServidor: true, VERBOS, resumoDoPlano, valorDoSet, acharPedidoExistente
}
