'use strict'

// Executor generico das operacoes da registry:
//   acervo <recurso> <operacao> [--data '{...}' | --data-file corpo.json]
//                              [--<filtro> valor] [--campos a,b] [--json]
//                              [--dry-run] [--confirmar ...]
//
// Uma operacao por rota real. O SCA nao e CRUD uniforme (ver o comentario de
// lib/recursos.js), entao nao ha "listar/obter/criar" generico: ha as operacoes
// que o backend de fato tem.
//
// Tres decisoes que valem explicar:
//
// 1. O corpo e validado LOCALMENTE contra o Joi antes de sair da maquina, e o
//    --dry-run funciona OFFLINE (sem servidor, sem credencial, sem rede). Um
//    corpo torto falha em milissegundos, com o contrato do campo errado impresso
//    junto, em vez de custar um round-trip e um 400 generico.
//
// 2. O servidor valida o corpo com stripUnknown, ou seja, campo com nome errado
//    e DESCARTADO em silencio. Aqui isso vira aviso explicito: e a diferenca
//    entre "gravei" e "achei que gravei".
//
// 3. Operacao irreversivel exige --confirmar repetindo os IDENTIFICADORES que
//    ela vai atingir, nao um "sim". Confirmacao que se digita sem olhar nao e
//    guardrail. O guardrail mora na INTERFACE, nao na skill que a chama: skill e
//    de um cliente so, a interface serve todos.

const fs = require('fs')
const path = require('path')

const { obter, obterOperacao, montarCaminho } = require('../lib/recursos')
const esquema = require('../lib/schema')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')

// Flags do proprio CLI, que nunca viram filtro de query.
const FLAGS_CLI = new Set([
  'campos', 'formato', 'json', 'server', 'user', 'senha', 'token', 'cliente',
  'insecure', 'sem-cache', 'dry-run', 'data', 'data-file', 'confirmar', 'file'
])

// Extensao -> mimetype, para a operacao que sobe BYTES em vez de JSON. A lista e
// a mesma que o `miniatura_upload.js` do server aceita: o CLI recusa aqui o que
// o servidor recusaria la, e o agente descobre em milissegundos, sem round-trip.
const MIME_POR_EXTENSAO = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

/** Le o --file de uma operacao multipart e devolve os bytes com o mimetype. */
function lerArquivo (flags) {
  const caminho = flags.file
  if (!caminho || caminho === true) {
    throw new Error(
      'Esta operacao envia um arquivo: informe --file <imagem>. ' +
      `Aceitos: ${Object.keys(MIME_POR_EXTENSAO).join(', ')}.`
    )
  }
  const ext = path.extname(caminho).toLowerCase()
  const mime = MIME_POR_EXTENSAO[ext]
  if (!mime) {
    throw new Error(
      `Extensao nao aceita (${ext || 'sem extensao'}). ` +
      `Aceitos: ${Object.keys(MIME_POR_EXTENSAO).join(', ')}.`
    )
  }
  const conteudo = fs.readFileSync(caminho)
  return { conteudo, mime, caminho, bytes: conteudo.length }
}

function lerCorpo (flags) {
  if (flags.data && flags['data-file']) {
    throw new Error('Use --data OU --data-file, nunca os dois.')
  }
  if (flags['data-file'] && flags['data-file'] !== true) {
    const conteudo = fs.readFileSync(flags['data-file'], 'utf8')
    try {
      return JSON.parse(conteudo)
    } catch (e) {
      throw new Error(`${flags['data-file']} nao contem JSON valido: ${e.message}`)
    }
  }
  if (flags.data && flags.data !== true) {
    try {
      return JSON.parse(flags.data)
    } catch (e) {
      throw new Error(`--data nao e JSON valido: ${e.message}`)
    }
  }
  return null
}

/** Valida o corpo e devolve o normalizado, ou lanca com o contrato junto. */
function validar (schemaJoi, corpo, chave, acao) {
  const r = esquema.validarCorpo(schemaJoi, corpo)
  const avisos = []

  if (r.descartados.length) {
    // Duas causas possiveis, as duas silenciosas no servidor: nome fora do
    // schema (erro de digitacao) ou descarte por regra condicional. Em ambos o
    // valor NAO grava, e sem este aviso o agente acha que gravou.
    avisos.push(
      'Campos REMOVIDOS do corpo antes do envio (o servidor tambem os descartaria, ' +
      `em silencio): ${r.descartados.join(', ')}.\n` +
      `        Causa: nome fora do schema, ou descarte por regra condicional. ` +
      `Confira em: acervo schema ${chave}`
    )
  }

  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(
      schemaJoi, r.erros, `contrato completo: acervo schema ${chave}   (operacao ${acao})`
    ))
    erro.jaFormatado = true
    if (avisos.length) erro.avisos = avisos
    throw erro
  }

  return { corpo: r.valor, avisos }
}

/**
 * Guardrail de acao irreversivel. A confirmacao e a lista de identificadores
 * que a operacao vai atingir, lida do proprio corpo: para confirmar, o agente
 * precisa ter olhado o que esta apagando.
 */
function exigirConfirmacao (op, corpo, chave, acao, flags) {
  if (!op.confirmar) return

  // O --dry-run nao toca a rede: ele nao tem o que confirmar, e a propria
  // mensagem de erro abaixo o oferece como saida. Exigi-lo aqui obrigava a
  // confirmar para poder OLHAR, que e o contrario do guardrail.
  if (flags['dry-run']) return

  // O identificador sai do corpo quando a operacao leva corpo, e da flag de
  // rota quando ela nao leva (o fechar do RPCMTec so tem :id no caminho). Sem
  // o segundo caso, `confirmar` numa rota sem corpo nao guardava nada.
  const valor = corpo && op.confirmar.campo in corpo
    ? corpo[op.confirmar.campo]
    : flags[op.confirmar.campo]
  const bruto = Array.isArray(valor) ? valor : (valor === undefined ? [] : [valor])
  // Campo em lote de OBJETOS (uma correcao por linha, e nao um id solto): o
  // identificador esta dentro de cada objeto. Sem isto a confirmacao pediria
  // "[object Object]", que ninguem consegue repetir.
  const alvos = op.confirmar.subcampo
    ? bruto.map(item => (item && typeof item === 'object' ? item[op.confirmar.subcampo] : item))
    : bruto
  const esperado = alvos.join(',')

  if (esperado === '') {
    throw new Error(
      `${chave} ${acao} e irreversivel e o CLI nao achou o identificador em ` +
      `${op.confirmar.campo}. Informe-o antes de confirmar.`
    )
  }

  const dado = flags.confirmar === undefined || flags.confirmar === true
    ? null
    : String(flags.confirmar)

  if (dado === esperado) return

  throw new Error(
    `Operacao irreversivel e nao confirmada: ${op.confirmar.motivo}.\n` +
    `Atinge ${alvos.length} registro(s) via ${op.confirmar.campo}.\n` +
    'Para executar de fato, repita os identificadores em --confirmar:\n' +
    `  acervo ${chave} ${acao} ${op.confirmar.campo === 'id' ? '--id ' + esperado : "--data '...'"} --confirmar ${esperado}\n` +
    'Para so ver a requisicao que sairia: acrescente --dry-run.'
  )
}

async function executar (args, cfg) {
  const chave = args._[0]
  const acao = args._[1]
  const flags = args.flags

  if (!acao) {
    const r = obter(chave)
    return {
      texto: [
        `${chave} - ${r.nome}`,
        '',
        'operacoes:',
        ...Object.entries(r.operacoes).map(
          ([n, o]) => `  ${n.padEnd(28)} ${o.metodo} /api${o.caminho}`
        ),
        '',
        `contrato completo: acervo schema ${chave}`
      ].join('\n')
    }
  }

  const { recurso, operacao } = obterOperacao(chave, acao)
  const modulo = recurso.schema()

  const opcoesSaida = {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: operacao.colunas
  }

  const avisos = []
  if (operacao.pesado) avisos.push(`Operacao pesada: ${operacao.pesado}.`)
  // Avisa antes de enviar, e tambem no --dry-run. E o unico guardrail possivel
  // para a operacao que muda ou apaga SEM levar corpo: o --confirmar pede os
  // identificadores atingidos, e a rota de limpeza nao os tem para oferecer.
  if (operacao.destrutivo) avisos.push(`Operacao destrutiva: ${operacao.destrutivo}.`)

  // ---- arquivo (multipart) ----------------------------------------------
  // Antes do corpo JSON, e as duas coisas se excluem. Esta operacao nao tem
  // schema Joi de corpo para validar offline; o que da para conferir sem rede e
  // a extensao e a existencia do arquivo, e e o que `lerArquivo` faz.
  let envio = null
  if (operacao.arquivo) {
    const img = lerArquivo(flags)
    const parte = http.multipart(operacao.arquivo, img.caminho, img.conteudo, img.mime)
    envio = { bytes: parte.bytes, contentType: parte.contentType, resumo: img }
  }

  // ---- corpo -------------------------------------------------------------
  let corpo = null
  if (operacao.corpo) {
    const bruto = lerCorpo(flags)
    if (bruto === null) {
      throw new Error(
        `${chave} ${acao} exige --data '...' ou --data-file corpo.json` +
        `${esquema.ehArrayNoTopo(modulo[operacao.corpo]) ? ' (um ARRAY de objetos)' : ' (um objeto JSON)'}.\n` +
        `Contrato: acervo schema ${chave}`
      )
    }
    const r = validar(modulo[operacao.corpo], bruto, chave, acao)
    corpo = r.corpo
    avisos.push(...r.avisos)
  } else if (flags.data || flags['data-file']) {
    avisos.push(`${chave} ${acao} nao leva corpo; --data foi ignorado.`)
  }

  // Fora do bloco acima: a operacao irreversivel que nao leva corpo (o fechar do
  // RPCMTec identifica o alvo pelo :id da rota) tambem precisa do guardrail.
  exigirConfirmacao(operacao, corpo, chave, acao, flags)

  // ---- query -------------------------------------------------------------
  let sufixo = ''
  if (operacao.query) {
    const aceitos = esquema.camposDe(modulo[operacao.query]).map(c => c.nome)
    const params = {}
    for (const nome of aceitos) {
      if (flags[nome] !== undefined && flags[nome] !== true) params[nome] = flags[nome]
    }
    const r = esquema.validarQuery(modulo[operacao.query], params)
    if (!r.ok) {
      const erro = new Error(esquema.explicarErro(
        modulo[operacao.query], r.erros,
        `filtros aceitos: ${aceitos.join(', ')}`,
        'Filtro de query invalido'
      ))
      erro.jaFormatado = true
      throw erro
    }
    // Filtros nao aceitos viram aviso: sem isso um --escala 50k errado sai como
    // "listou tudo" e o agente conclui coisa errada sobre o acervo.
    const usadas = Object.keys(flags).filter(f => !aceitos.includes(f) && !FLAGS_CLI.has(f))
    if (usadas.length) {
      avisos.push(
        `Filtros ignorados (esta operacao aceita ${aceitos.join(', ') || 'nenhum'}): ${usadas.join(', ')}`
      )
    }
    // Reenvia so o que o usuario passou: o default do Joi ja e aplicado no
    // servidor, e mandar tudo poluiria a URL.
    const enviar = {}
    for (const k of Object.keys(params)) enviar[k] = r.valor[k]
    sufixo = http.query(enviar)
  }

  const caminho = montarCaminho(operacao, flags) + sufixo

  // ---- dry-run (offline) -------------------------------------------------
  if (flags['dry-run']) {
    const linhas = [
      '[dry-run] nada foi enviado. A requisicao seria:',
      `  ${operacao.metodo} /api${caminho}   (${operacao.acesso})`
    ]
    if (corpo !== null) {
      linhas.push('  corpo (ja validado contra o schema vivo do server/):')
      linhas.push(JSON.stringify(corpo, null, 2))
    }
    if (envio !== null) {
      linhas.push(
        `  multipart campo "${operacao.arquivo}": ${envio.resumo.caminho} ` +
        `(${envio.resumo.mime}, ${(envio.resumo.bytes / 1024).toFixed(1)} KB)`
      )
    }
    return { texto: linhas.join('\n'), avisos }
  }

  // ---- envio -------------------------------------------------------------
  const opcoes = envio !== null
    ? { bytes: envio.bytes, contentType: envio.contentType }
    : (corpo !== null ? { corpo } : {})
  const r = operacao.acesso === 'publico'
    ? await http.requisitar(cfg, operacao.metodo, caminho, opcoes)
    : await http.autenticada(cfg, operacao.metodo, caminho, opcoes)

  return { texto: formatar(r, operacao, opcoesSaida, avisos), avisos }
}

function formatar (r, operacao, opcoesSaida, avisos) {
  const dados = r.dados

  if (operacao.envelope === 'mensagem' || dados === undefined || dados === null) {
    return r.message || 'ok'
  }

  // O busca do acervo devolve { total, page, limit, dados: [...] }: a lista de
  // verdade esta um nivel abaixo do envelope.
  if (operacao.envelope === 'paginado' && dados && Array.isArray(dados.dados)) {
    const out = saida.lista(dados.dados, opcoesSaida)
    avisos.push(...out.avisos)
    return `${out.texto}\n(pagina ${dados.page} de ${Math.ceil((dados.total || 0) / (dados.limit || 1))}, ${dados.total} no total)`
  }

  if (operacao.envelope === 'lista' || Array.isArray(dados)) {
    const out = saida.lista(dados, opcoesSaida)
    avisos.push(...out.avisos)
    return out.texto
  }

  return saida.registro(dados, opcoesSaida)
}

/**
 * Quando esta invocacao vai de fato falar com o servidor. Listar as operacoes de
 * um recurso, errar o nome da operacao e o --dry-run sao conhecimento local: nao
 * podem exigir SCA_URL.
 */
function precisaServidor (args) {
  if (args.flags['dry-run'] === true) return false
  if (args._.length < 2) return false
  try {
    obterOperacao(args._[0], args._[1])
  } catch (e) {
    return false
  }
  return true
}

// `formatar` sai daqui para o teste poder medir a escolha de envelope sem rede:
// e ela que decide se a resposta vira contador legivel ou so a prosa do servidor.
module.exports = { executar, precisaServidor, formatar }
