'use strict'

// O executor de TODA operacao da registry:
//
//   producao <recurso> <operacao> [--param ...] [--filtro ...] [--data '{...}']
//
// Um arquivo so, e nao um por recurso, porque a diferenca entre uma operacao e
// outra ja esta declarada em lib/recursos.js (metodo, caminho, guarda, schema de
// query, de params e de corpo, envelope, colunas, confirmacao). Espalhar isso em
// dez comandos criaria dez lugares para a mesma regra divergir.
//
// Quatro decisoes valem explicar:
//
// 1. Query, params e corpo sao validados LOCALMENTE contra o Joi antes de sair
//    da maquina, no MODO daquele grupo de rota (/api/metas recusa chave
//    desconhecida, /api/rpcmtec a descarta). Corpo torto falha em milissegundos,
//    com o contrato do campo errado impresso junto.
//
// 2. Chave descartada vira aviso explicito. E a diferenca entre "gravei" e
//    "achei que gravei".
//
// 3. Acao irreversivel ou de alto impacto exige --confirmar com o identificador
//    repetido, e a mensagem diz o que ela FAZ, nao so que e perigosa. O
//    guardrail mora na INTERFACE: skill e de um cliente so, a interface serve
//    todos.
//
// 4. Resposta binaria (o PDF do RPCMTec, as planilhas ODS, o anexo assinado) vai
//    para disco, nunca para o stdout: despejar megabytes de binario na saida que
//    o agente le e o jeito mais rapido de queimar a janela de contexto.

const fs = require('fs')
const path = require('path')

const recursos = require('../lib/recursos')
const esquema = require('../lib/schema')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')

// Flags de infraestrutura, que nunca sao filtro de rota nem parametro.
const FLAGS_GLOBAIS = new Set([
  'campos', 'formato', 'json', 'server', 'user', 'senha', 'token', 'insecure',
  'sem-cache', 'dry-run', 'cliente', 'data', 'data-file', 'file', 'saida',
  'confirmar', 'ajuda', 'help'
])

const MIMES = {
  '.pdf': 'application/pdf',
  '.p7s': 'application/pkcs7-signature',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv'
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
      throw new Error(`${flags['data-file']} não contém JSON válido: ${e.message}`)
    }
  }
  if (flags.data && flags.data !== true) {
    try {
      return JSON.parse(flags.data)
    } catch (e) {
      throw new Error(`--data não é JSON válido: ${e.message}`)
    }
  }
  return null
}

/** Ajuda de um recurso: as operacoes que ele tem, sem gastar rede. */
function ajudaDoRecurso (chave, recurso) {
  const linhas = [`${chave} - ${recurso.nome}`, '', 'operações:']
  const largura = Math.max(...Object.keys(recurso.operacoes).map(o => o.length))
  for (const [acao, op] of Object.entries(recurso.operacoes)) {
    const marca = op.confirmar ? '  [exige --confirmar]' : ''
    linhas.push(`  ${acao.padEnd(largura)}  ${op.metodo} /api${op.caminho}${marca}`)
  }
  linhas.push('')
  linhas.push(`contrato completo (campos, tipos, guarda): producao schema ${chave}`)
  return linhas.join('\n')
}

/** Valida os `:param` da rota contra o Joi de params do proprio schema. */
function resolverParams (modulo, operacao, flags) {
  const brutos = recursos.lerParams(operacao, flags)
  if (!operacao.params || !modulo[operacao.params]) return brutos

  const r = esquema.validarQuery(modulo[operacao.params], brutos)
  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(
      modulo[operacao.params], r.erros,
      `flags aceitas: ${Object.keys(brutos).map(n => '--' + recursos.flagDoParam(n)).join(', ')}`,
      'Parâmetro de rota inválido'
    ))
    erro.jaFormatado = true
    throw erro
  }
  return r.valor
}

/** Monta a query string a partir das flags que o listarQuery do schema aceita. */
function resolverQuery (modulo, operacao, flags, chave) {
  if (!operacao.query || !modulo[operacao.query]) {
    return { sufixo: '', avisos: [] }
  }

  const aceitos = esquema.camposDe(modulo[operacao.query]).map(c => c.nome)
  const params = {}
  for (const nome of aceitos) {
    if (flags[nome] !== undefined && flags[nome] !== true) params[nome] = flags[nome]
  }

  const r = esquema.validarQuery(modulo[operacao.query], params)
  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(
      modulo[operacao.query], r.erros,
      `filtros aceitos: ${aceitos.join(', ') || 'nenhum'}   (contrato: producao schema ${chave})`,
      'Filtro de query inválido'
    ))
    erro.jaFormatado = true
    throw erro
  }

  // Reenvia so o que foi passado: o default do Joi ja e aplicado no servidor, e
  // mandar tudo poluiria a URL sem mudar a resposta.
  const enviar = {}
  for (const nome of Object.keys(params)) enviar[nome] = r.valor[nome]
  return { sufixo: http.query(enviar), avisos: [] }
}

/** Valida o corpo e devolve { corpo, avisos }, ou lanca com o contrato junto. */
function resolverCorpo (modulo, operacao, recurso, flags, chave, acao) {
  if (!operacao.corpo) return { corpo: null, avisos: [] }

  const schemaJoi = modulo[operacao.corpo]
  const bruto = lerCorpo(flags)

  // Corpo AUSENTE num schema que so tem campos opcionais e legitimo: o
  // copiar-mes-anterior sem numero copia todas as digitadas, e o anexo sem
  // descricao e o caso comum.
  const campos = esquema.camposDe(schemaJoi)
  const exigeAlgo = campos.some(c => c.obrigatorio)
  if (!bruto && exigeAlgo) {
    throw new Error(
      `${chave} ${acao} exige --data '{...}' ou --data-file corpo.json. ` +
      `Contrato: producao schema ${chave}`
    )
  }

  const r = esquema.validarCorpo(schemaJoi, bruto || {}, recurso.validacao)
  const avisos = []

  if (r.descartados.length) {
    avisos.push(
      recurso.validacao === recursos.VALIDACAO.STRIP
        ? `Campos DESCARTADOS: ${r.descartados.join(', ')}. O servidor os ignoraria ` +
          `sem reclamar, e eles NÃO seriam gravados. Confira o nome em: producao schema ${chave}`
        : `Campos descartados por REGRA do schema (existem, mas não se aplicam a ` +
          `este caso): ${r.descartados.join(', ')}. Veja a condicional em: producao schema ${chave}`
    )
  }

  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(
      schemaJoi, r.erros, `contrato completo: producao schema ${chave}`
    ))
    erro.jaFormatado = true
    if (avisos.length) erro.avisos = avisos
    throw erro
  }

  return { corpo: r.valor, avisos }
}

/** Guardrail de acao irreversivel, na propria interface. */
function conferirConfirmacao (operacao, params, flags, chave, acao) {
  if (!operacao.confirmar) return

  const alvo = operacao.confirmar.param
  // O valor esperado e o do parametro que identifica o registro, resolvido da
  // rota. Repetir o id e o que separa "quis" de "digitei sem ler".
  const nomeNoCaminho = Object.keys(params).find(
    n => recursos.flagDoParam(n) === alvo
  )
  const esperado = nomeNoCaminho !== undefined ? String(params[nomeNoCaminho]) : null

  if (esperado === null) {
    throw new Error(
      `Esta operação exige --confirmar, e o valor a repetir é o de --${alvo}.`
    )
  }

  if (flags.confirmar === undefined || String(flags.confirmar) !== esperado) {
    throw new Error(
      `Ação não confirmada. O que ela faz:\n` +
      `  ${operacao.confirmar.motivo}.\n` +
      `Para executar de fato, repita o valor em --confirmar:\n` +
      `  producao ${chave} ${acao} --${alvo} ${esperado} --confirmar ${esperado}\n` +
      'Para só ver o que aconteceria: acrescente --dry-run.'
    )
  }
}

/** Le o arquivo do upload e monta o corpo multipart, com os campos junto. */
function montarUpload (operacao, flags, corpo) {
  const arquivo = argsLib.exigir(flags, 'file', 'caminho do arquivo a enviar')
  if (!fs.existsSync(arquivo)) {
    throw new Error(`Arquivo não encontrado: ${arquivo}`)
  }
  const bytes = fs.readFileSync(arquivo)
  const ext = path.extname(arquivo).toLowerCase()
  // A lista de extensoes aceitas vive no multer do servidor e NAO e exportada:
  // copia-la aqui criaria uma segunda fonte de verdade que apodrece calada.
  // Quem recusa e o servidor, com a lista inteira na mensagem.
  const mp = http.multipart(
    operacao.arquivo, arquivo, bytes, MIMES[ext] || 'application/octet-stream', corpo
  )
  return { mp, arquivo, bytes }
}

async function executar (args, cfg) {
  const chave = args._[0]
  const acao = args._[1]
  const flags = args.flags
  const recurso = recursos.obter(chave)

  if (!acao) return { texto: ajudaDoRecurso(chave, recurso) }

  const { operacao } = recursos.obterOperacao(chave, acao)
  const modulo = recurso.schema()

  const opcoesSaida = {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: operacao.colunas
  }

  const params = resolverParams(modulo, operacao, flags)
  const { sufixo, avisos: avisosQuery } = resolverQuery(modulo, operacao, flags, chave)
  const { corpo, avisos: avisosCorpo } = resolverCorpo(
    modulo, operacao, recurso, flags, chave, acao
  )
  const avisos = [...avisosQuery, ...avisosCorpo]

  // Flag passada que a operacao nao usa: aviso, nunca silencio. Um --ano num
  // recurso que filtra por outro nome sairia como "trouxe tudo".
  const aceitos = new Set([
    ...(operacao.query ? esquema.camposDe(modulo[operacao.query]).map(c => c.nome) : []),
    ...recursos.paramsDaRota(operacao.caminho),
    ...recursos.paramsDaRota(operacao.caminho).map(recursos.flagDoParam)
  ])
  const ignoradas = Object.keys(flags).filter(
    f => !aceitos.has(f) && !FLAGS_GLOBAIS.has(f)
  )
  if (ignoradas.length) {
    avisos.push(
      `Flags ignoradas por ${chave} ${acao}: ${ignoradas.join(', ')}. ` +
      `Veja o que esta operação aceita em: producao schema ${chave}`
    )
  }

  // O --dry-run nao envia nada, entao nao ha o que confirmar: cobrar
  // --confirmar aqui tornaria impossivel seguir a propria instrucao da mensagem
  // de recusa, que manda usar o --dry-run para ver o que aconteceria.
  if (!flags['dry-run']) {
    conferirConfirmacao(operacao, params, flags, chave, acao)
  }

  const caminho = recursos.montarCaminho(operacao, params) + sufixo

  // ---- upload ------------------------------------------------------------
  if (operacao.arquivo) {
    const { mp, arquivo, bytes } = montarUpload(operacao, flags, corpo)

    if (flags['dry-run']) {
      return {
        texto: [
          '[dry-run] nada foi enviado. A requisição seria:',
          `  ${operacao.metodo} /api${caminho}`,
          `  multipart, campo "${operacao.arquivo}": ${path.basename(arquivo)} (${bytes.length} bytes)`,
          corpo && Object.keys(corpo).length
            ? '  campos junto: ' + JSON.stringify(corpo)
            : '  (sem campos de corpo)'
        ].join('\n'),
        avisos
      }
    }

    const r = await http.autenticada(cfg, operacao.metodo, caminho, {
      bytes: mp.bytes, contentType: mp.contentType
    })
    const texto = r.dados && typeof r.dados === 'object'
      ? `${r.message || 'enviado'}\n${saida.registro(r.dados, { ...opcoesSaida, padrao: null })}`
      : (r.message || 'enviado')
    return { texto: `${texto}\n(${path.basename(arquivo)}, ${bytes.length} bytes)`, avisos }
  }

  // ---- dry-run -----------------------------------------------------------
  if (flags['dry-run']) {
    const linhas = [
      '[dry-run] nada foi enviado. A requisição seria:',
      `  ${operacao.metodo} /api${caminho}   (${esquema.ACESSO[operacao.acesso]})`
    ]
    if (corpo) {
      linhas.push('  corpo (já validado contra o Joi vivo do server/):')
      linhas.push(JSON.stringify(corpo, null, 2))
    }
    return { texto: linhas.join('\n'), avisos }
  }

  // ---- download binario --------------------------------------------------
  if (operacao.envelope === 'binario') {
    const r = await http.autenticada(cfg, operacao.metodo, caminho, { binario: true })
    const nomeServidor = http.nomeDoCabecalho(r.cabecalhos)
    const destino = flags.saida && flags.saida !== true
      ? String(flags.saida)
      : (nomeServidor || `${chave}-${acao}.bin`)

    fs.writeFileSync(destino, r.bytes)
    if (!nomeServidor && !(flags.saida && flags.saida !== true)) {
      avisos.push(
        'O servidor não mandou nome no Content-Disposition; usei um nome genérico. ' +
        'Passe --saida para escolher.'
      )
    }
    return {
      texto: `Gravado: ${path.resolve(destino)} (${r.bytes.length} bytes)`,
      avisos
    }
  }

  // ---- chamada normal ----------------------------------------------------
  const r = await http.autenticada(cfg, operacao.metodo, caminho, {
    corpo: corpo || undefined
  })

  if (operacao.envelope === 'mensagem') {
    return { texto: r.message || 'ok', avisos }
  }
  if (operacao.envelope === 'registro') {
    const cabeca = operacao.metodo === 'GET' ? '' : (r.message || 'ok') + '\n'
    return {
      texto: cabeca + saida.registro(r.dados, { ...opcoesSaida, padrao: null }),
      avisos
    }
  }

  const out = saida.lista(r.dados, opcoesSaida)
  return { texto: out.texto, avisos: [...avisos, ...out.avisos] }
}

/**
 * `producao <recurso>` sozinho lista as operacoes, e errar o nome da operacao
 * tambem se responde sem sair da maquina: os dois sao conhecimento do repo e nao
 * podem exigir SCA_URL. Pedir configuracao para dizer "essa operacao nao existe"
 * seria trocar uma resposta util por uma exigencia. O --dry-run idem, porque a
 * validacao ja rodou contra o Joi local.
 */
function precisaServidor (args) {
  if (args.flags['dry-run'] === true) return false
  if (!args._[1]) return false
  try {
    recursos.obterOperacao(args._[0], args._[1])
  } catch (e) {
    return false
  }
  return true
}

module.exports = { executar, precisaServidor, ajudaDoRecurso }
