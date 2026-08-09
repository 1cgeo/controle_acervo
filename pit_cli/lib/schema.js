'use strict'

// Le o contrato direto dos schemas Joi do server/ e o imprime em forma compacta,
// alem de validar o corpo LOCALMENTE antes de gastar uma requisicao.
//
// O ponto do arquivo: nao existe copia do contrato em lugar nenhum. O texto que
// o agente le e derivado, em tempo de execucao, do mesmo objeto Joi que o
// Express usa para validar. Se o schema mudar, o texto muda no mesmo commit; nao
// ha artefato gerado para apodrecer nem documentacao para desatualizar.
//
// Limite conhecido e deliberado: joi.describe() nao enxerga os COMENTARIOS do
// arquivo de schema nem os invariantes do controlador, e e neles que mora boa
// parte da regra (por que omitir um campo da celula vale "nao mexer", por
// exemplo). Por isso o comando `schema` tambem imprime o bloco curado de
// regras.js. A FORMA vem do Joi vivo; o PORQUE vem da prosa curta ao lado.

const { REGRAS } = require('./regras')
const { VALIDACAO, paramsDaRota, flagDoParam } = require('./recursos')

// AS OPCOES SAO DUAS, e nao uma, porque o servidor tem DOIS middlewares:
//
//   /api/metas                 utils/schema_validation_estrito.js: chave
//                              desconhecida no corpo vira 400 com sugestao.
//   /api/rpcmtec, /api/efetivo utils/schema_validation.js: chave desconhecida e
//                              descartada (stripUnknown) e volta em "avisos".
//
// Validar os dois grupos do mesmo jeito produziria um CLI que aprova no
// --dry-run o que a rota real recusa, ou o contrario, que e pior que nao validar.
const OPCOES_CORPO = {
  [VALIDACAO.ESTRITO]: { abortEarly: false },
  [VALIDACAO.STRIP]: { stripUnknown: true, abortEarly: false }
}
const OPCOES_QUERY = { abortEarly: false }

// Ate onde descer nos aninhamentos ao imprimir. As linhas de uma subsecao sao
// array de array de string, e os militares de uma capacitacao sao array de uuid.
const PROFUNDIDADE_MAX = 3

// ---------------------------------------------------------------------------
// Formatacao do contrato
// ---------------------------------------------------------------------------

function regraPor (desc, nome) {
  return (desc.rules || []).find(r => r.name === nome)
}

/** Um limite pode ser numero literal ou uma referencia a campo irmao. */
function limite (args, chave) {
  if (!args) return null
  const v = args[chave !== undefined ? chave : 'limit']
  if (v === undefined || v === null) return null
  if (typeof v === 'object' && v.ref && v.ref.path) return 'ref:' + v.ref.path.join('.')
  if (typeof v === 'object') return null
  return String(v)
}

/** Renderiza o tipo de um campo em notacao curta: uuid, string(<=20), int 1..12. */
function tipoDe (desc) {
  if (!desc || !desc.type) return 'any'

  switch (desc.type) {
    case 'string': {
      if (regraPor(desc, 'guid') || regraPor(desc, 'uuid')) return 'uuid'
      const padrao = regraPor(desc, 'pattern')
      if (padrao && padrao.args && padrao.args.regex) return `string ${padrao.args.regex}`
      const max = limite(regraPor(desc, 'max') && regraPor(desc, 'max').args)
      const min = limite(regraPor(desc, 'min') && regraPor(desc, 'min').args)
      if (max) return `string(<=${max})`
      if (min) return `string(>=${min})`
      return 'string'
    }
    case 'number': {
      const base = regraPor(desc, 'integer') ? 'int' : 'number'
      const sinal = regraPor(desc, 'sign')
      if (sinal && sinal.args && sinal.args.sign === 'positive') return `${base}>0`
      if (sinal && sinal.args && sinal.args.sign === 'negative') return `${base}<0`
      const min = limite(regraPor(desc, 'min') && regraPor(desc, 'min').args)
      const max = limite(regraPor(desc, 'max') && regraPor(desc, 'max').args)
      if (min && max) return `${base} ${min}..${max}`
      if (min) return `${base}>=${min}`
      if (max) return `${base}<=${max}`
      return base
    }
    case 'boolean': return 'bool'
    case 'date': return 'date'
    case 'array': {
      const min = limite(regraPor(desc, 'min') && regraPor(desc, 'min').args)
      const itens = desc.items && desc.items.length ? desc.items[0] : null
      const dentro = itens ? tipoDe(itens) : 'any'
      const unico = regraPor(desc, 'unique') ? ' único' : ''
      return `array<${dentro}>${min ? `(>=${min})` : ''}${unico}`
    }
    case 'object': return 'object'
    case 'binary': return 'binary'
    case 'alternatives': return 'condicional'
    default: return desc.type
  }
}

function formatarValor (v) {
  if (v === null) return 'null'
  if (v === '') return "''"
  return JSON.stringify(v)
}

// O Joi injeta o sentinela { override: true } no inicio de um allow que
// SUBSTITUI a lista anterior (e o que .valid() faz). Ele e detalhe interno do
// describe, nunca um valor aceito: se vazar para a saida, o agente le
// `origem_id={"override":true}|1` e conclui que ha um valor a mais.
function semSentinela (allow) {
  return (allow || []).filter(
    v => !(v && typeof v === 'object' && 'override' in v)
  )
}

/** Sufixo de valores aceitos: " =1|3" para .valid(), " |null|''" para .allow(). */
function sufixoValores (desc) {
  if (!desc || !Array.isArray(desc.allow)) return ''
  const aceitos = semSentinela(desc.allow)
  if (!aceitos.length) return ''
  const valores = aceitos.map(formatarValor).join('|')
  // flags.only significa .valid(): a lista e exaustiva, nao aditiva.
  if (desc.flags && desc.flags.only) return ' =' + valores
  return ' |' + valores
}

/** Anotacoes extras: default, strict, o .raw() das datas, FK. */
function anotacoes (desc, nomeCampo) {
  const notas = []
  const flags = (desc && desc.flags) || {}

  if ('default' in flags) {
    notas.push(`default ${formatarValor(flags.default)}`)
  }
  // .raw() nas datas preserva a string 'AAAA-MM-DD' em vez de converter para
  // Date UTC. Sem isso o Postgres (sessao em UTC-3) gravaria o dia anterior, e
  // numa passagem pela DGEO isso ainda esbarra no EXCLUDE do ano anterior.
  if (desc && desc.type === 'date' && flags.result === 'raw') {
    notas.push("'AAAA-MM-DD' literal")
  }
  // .strict() desliga a coercao: "1" (texto) e recusado onde se espera 1. Como o
  // corpo entra por JSON na linha de comando, a distincao e real.
  if (desc && desc.preferences && desc.preferences.convert === false) {
    notas.push('strict (sem coerção de tipo)')
  }
  if (nomeCampo && /_id$/.test(nomeCampo)) {
    notas.push('FK')
  }
  return notas
}

/**
 * Renderiza `alternatives().conditional()`. Nao ha nenhum nesta area hoje, e o
 * codigo fica porque o formatador e o mesmo dos CLIs irmaos: divergir aqui
 * criaria dois renderizadores de contrato com defeitos diferentes.
 */
function renderCondicional (desc) {
  const casos = []
  for (const m of desc.matches || []) {
    const refPath = m.ref && m.ref.path ? m.ref.path.join('.') : 'condicao'
    const aceitos = m.is && Array.isArray(m.is.allow) ? semSentinela(m.is.allow) : []
    const alvo = aceitos.length ? aceitos.map(formatarValor).join('|') : '?'

    if (m.then) {
      const extras = anotacoes(m.then)
      casos.push(`${refPath}=${alvo}: ${tipoDe(m.then)}${sufixoValores(m.then)}` +
        (extras.length ? ` (${extras.join(', ')})` : ''))
    }
    if (m.otherwise) {
      const outro = m.otherwise
      const descartado = outro.flags && outro.flags.result === 'strip'
      casos.push(`senão: ${descartado ? 'DESCARTADO' : tipoDe(outro) + sufixoValores(outro)}`)
    }
  }
  return casos
}

/** Um campo vira { nome, obrigatorio, tipo, notas[], filhos[] }. */
function descreverCampo (nome, desc, profundidade = 0) {
  const obrigatorio = !!(desc.flags && desc.flags.presence === 'required')

  if (desc.type === 'alternatives') {
    return { nome, obrigatorio, tipo: 'condicional', notas: renderCondicional(desc), filhos: [] }
  }

  const campo = {
    nome,
    obrigatorio,
    tipo: tipoDe(desc) + sufixoValores(desc),
    notas: anotacoes(desc, nome),
    filhos: []
  }

  if (profundidade < PROFUNDIDADE_MAX) {
    const alvo = desc.type === 'array' && desc.items && desc.items.length
      ? desc.items[0]
      : (desc.type === 'object' ? desc : null)
    if (alvo && alvo.type === 'object' && alvo.keys) {
      campo.filhos = Object.entries(alvo.keys)
        .map(([n, d]) => descreverCampo(n, d, profundidade + 1))
    }
  }

  return campo
}

/**
 * Lista de campos de um schema Joi ja descritos. Aceita schema de OBJETO e
 * schema de ARRAY no topo.
 */
function camposDe (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return []
  const desc = schemaJoi.describe()

  if (desc.type === 'array') {
    const itens = desc.items && desc.items.length ? desc.items[0] : null
    if (!itens || !itens.keys) return []
    return Object.entries(itens.keys).map(([n, d]) => descreverCampo(n, d))
  }

  if (!desc.keys) return []
  return Object.entries(desc.keys).map(([n, d]) => descreverCampo(n, d))
}

/** O corpo deste schema e um array no topo? Muda a forma do --data. */
function ehArrayNoTopo (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return false
  return schemaJoi.describe().type === 'array'
}

/**
 * Dependencias declaradas no nivel do objeto: `.or`, `.xor`, `.and`, `.with`.
 * Sem renderizar isso, o agente monta um corpo com todos os campos "opcionais"
 * preenchidos corretamente e ainda assim leva 400.
 */
function dependenciasDe (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return []
  const desc = schemaJoi.describe()
  if (!Array.isArray(desc.dependencies)) return []

  const rotulo = {
    or: 'pelo menos um de',
    xor: 'exatamente um de',
    oxor: 'no máximo um de',
    and: 'todos ou nenhum de',
    nand: 'nunca juntos'
  }

  return desc.dependencies.map(dep => {
    const pares = (dep.peers || []).map(p =>
      typeof p === 'string' ? p : (p.path ? p.path.join('.') : String(p))
    )
    return `${rotulo[dep.rel] || dep.rel}: ${pares.join(', ')}`
  })
}

function alinhar (campos, recuo = '  ') {
  if (!campos.length) return []
  const larguraNome = Math.max(...campos.map(c => c.nome.length + (c.obrigatorio ? 1 : 0)), 4)
  const larguraTipo = Math.max(...campos.map(c => c.tipo.length), 4)
  const linhas = []
  for (const c of campos) {
    const nome = (c.nome + (c.obrigatorio ? '*' : '')).padEnd(larguraNome)
    const tipo = c.notas.length ? c.tipo.padEnd(larguraTipo) : c.tipo
    const cauda = c.notas.length ? '  ' + c.notas.join('; ') : ''
    linhas.push(`${recuo}${nome}  ${tipo}${cauda}`)
    if (c.filhos && c.filhos.length) {
      linhas.push(...alinhar(c.filhos, recuo + '    '))
    }
  }
  return linhas
}

/** Bloco de campos de um schema, com as dependencias declaradas junto. */
function blocoCampos (schemaJoi, titulo) {
  const campos = camposDe(schemaJoi)
  if (!campos.length) return []

  const linhas = []
  const array = ehArrayNoTopo(schemaJoi)
  linhas.push(`  ${titulo}${array ? ' (o corpo é um ARRAY destes objetos)' : ''}  (* = obrigatório)`)
  linhas.push(...alinhar(campos, '    '))

  const deps = dependenciasDe(schemaJoi)
  if (deps.length) {
    linhas.push('    regras entre campos')
    linhas.push(...deps.map(d => '      ' + d))
  }
  return linhas
}

const ACESSO = {
  login: 'exige LOGIN (qualquer pessoa autenticada)',
  gerente: 'exige GERENTE de qualquer módulo, ou administrador',
  admin: 'exige ADMINISTRADOR global',
  // Módulos criados na 1.33.0, para haver como dar menos que a flag global.
  // O administrador global continua passando nos dois.
  pit_operador: 'exige OPERADOR no módulo Produção, ou administrador',
  efetivo_operador: 'exige OPERADOR no módulo Efetivo, ou administrador'
}

/** A linha que ensina como preencher os `:param` da rota. */
function linhaParams (operacao) {
  const nomes = paramsDaRota(operacao.caminho)
  if (!nomes.length) return null
  return '  flags dos parâmetros: ' +
    nomes.map(n => `:${n} vem de --${flagDoParam(n)}`).join(', ')
}

/** Texto completo do contrato de um recurso: uma secao por operacao real. */
function contrato (chave, recurso) {
  const modulo = recurso.schema()
  const linhas = []

  linhas.push(`${chave}  -  ${recurso.nome}`)
  linhas.push('')

  for (const [acao, op] of Object.entries(recurso.operacoes)) {
    linhas.push(`producao ${chave} ${acao}`)
    linhas.push(`  ${op.metodo} /api${op.caminho}   ${ACESSO[op.acesso] || op.acesso}`)

    const pars = linhaParams(op)
    if (pars) linhas.push(pars)
    if (op.arquivo) {
      linhas.push(`  envia arquivo: --file <caminho>, no campo multipart "${op.arquivo}"`)
    }
    if (op.envelope === 'binario') {
      linhas.push('  resposta BINÁRIA: grava em --saida <arquivo>, fora do envelope JSON')
    }
    if (op.nota) linhas.push(`  nota: ${op.nota}`)
    if (op.confirmar) {
      linhas.push(`  IRREVERSÍVEL ou de alto impacto, exige --confirmar <${op.confirmar.param}>:`)
      linhas.push(`    ${op.confirmar.motivo}`)
    }

    if (op.query) linhas.push(...blocoCampos(modulo[op.query], 'filtros de query'))
    if (op.params) linhas.push(...blocoCampos(modulo[op.params], 'parâmetros da rota'))
    if (op.corpo) {
      linhas.push(...blocoCampos(modulo[op.corpo], 'campos do corpo'))
      linhas.push(...avisoDeChaveDesconhecida(recurso.validacao).map(l => '    ' + l))
    }
    linhas.push('')
  }

  const regras = REGRAS[chave]
  if (regras && regras.length) {
    linhas.push('regras de negócio (o que o Joi não diz)')
    linhas.push(...regras.map(r => '  ' + r))
    linhas.push('')
  }

  return linhas.join('\n')
}

/** O que acontece com uma chave que nao esta no schema, por grupo de rota. */
function avisoDeChaveDesconhecida (validacao) {
  if (validacao === VALIDACAO.ESTRITO) {
    return [
      'campo fora desta lista é RECUSADO pelo servidor (400, com sugestão de nome).',
      'O CLI pega isso na validação local, antes de enviar.'
    ]
  }
  return [
    'campo fora desta lista é DESCARTADO em silêncio pelo servidor (stripUnknown);',
    'o CLI avisa quando isso acontece.'
  ]
}

/** Indice curto de todos os recursos, para o `producao schema` sem argumento. */
function indice (RECURSOS) {
  const chaves = Object.keys(RECURSOS)
  const largura = Math.max(...chaves.map(c => c.length))
  return chaves
    .map(c => {
      const ops = Object.keys(RECURSOS[c].operacoes)
      return `  ${c.padEnd(largura)}  ${RECURSOS[c].nome}\n` +
        `  ${' '.repeat(largura)}  ${ops.length} operações: ${ops.join(', ')}`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// Validacao local
// ---------------------------------------------------------------------------

/**
 * Valida o corpo contra o schema Joi ANTES de enviar, no MODO daquele grupo de
 * rota. Devolve { ok, valor, erros[], descartados[] }.
 *
 * `descartados` quer dizer coisas diferentes nos dois modos, e as duas importam:
 *   estrito  o que o proprio schema remove por .strip(); chave desconhecida ja
 *            virou erro acima.
 *   strip    o que o servidor jogaria fora sem reclamar. E a diferenca entre
 *            "gravei" e "achei que gravei".
 */
function validarCorpo (schemaJoi, corpo, validacao) {
  if (!schemaJoi || typeof schemaJoi.validate !== 'function') {
    return { ok: true, valor: corpo, erros: [], descartados: [] }
  }

  const opcoes = OPCOES_CORPO[validacao] || OPCOES_CORPO[VALIDACAO.ESTRITO]
  const { error, value } = schemaJoi.validate(corpo, opcoes)

  // So faz sentido comparar chaves quando o corpo e um objeto no topo.
  const objeto = corpo && typeof corpo === 'object' && !Array.isArray(corpo)
  const enviadas = objeto ? Object.keys(corpo) : []
  const mantidas = new Set(
    value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : enviadas
  )
  const descartados = enviadas.filter(k => !mantidas.has(k))

  if (!error) {
    return { ok: true, valor: value, erros: [], descartados }
  }

  const erros = error.details.map(d => ({
    campo: d.path.join('.') || '(corpo)',
    mensagem: d.message
  }))
  return { ok: false, valor: value, erros, descartados }
}

/** Valida query e params (sem stripUnknown, como o servidor faz nos dois). */
function validarQuery (schemaJoi, params) {
  if (!schemaJoi || typeof schemaJoi.validate !== 'function') {
    return { ok: true, valor: params, erros: [] }
  }
  const { error, value } = schemaJoi.validate(params, OPCOES_QUERY)
  if (!error) return { ok: true, valor: value, erros: [] }
  return {
    ok: false,
    valor: value,
    erros: error.details.map(d => ({ campo: d.path.join('.') || '(query)', mensagem: d.message }))
  }
}

/**
 * Mensagem de erro que ENSINA: alem do que falhou, imprime a linha de contrato
 * exatamente dos campos que falharam. Evita que o agente tenha que reler o
 * contrato inteiro para consertar um campo.
 */
function explicarErro (schemaJoi, erros, dica, titulo) {
  const linhas = [
    (titulo || 'Corpo inválido') + ' (validado localmente, nada foi enviado):',
    ''
  ]
  for (const e of erros) linhas.push(`  ${e.mensagem}`)

  const campos = camposDe(schemaJoi)
  // Com array no topo o path comeca pelo indice; o nome do campo e o proximo.
  const falhos = new Set(erros.map(e => {
    const partes = e.campo.split('.')
    return /^\d+$/.test(partes[0]) ? partes[1] : partes[0]
  }))
  const relevantes = campos.filter(c => falhos.has(c.nome))

  if (relevantes.length) {
    linhas.push('')
    linhas.push('contrato dos campos citados:')
    linhas.push(...alinhar(relevantes))
  }

  linhas.push('')
  linhas.push(dica || 'contrato completo: producao schema <recurso>')
  return linhas.join('\n')
}

module.exports = {
  contrato,
  indice,
  camposDe,
  ehArrayNoTopo,
  dependenciasDe,
  descreverCampo,
  tipoDe,
  sufixoValores,
  alinhar,
  blocoCampos,
  avisoDeChaveDesconhecida,
  validarCorpo,
  validarQuery,
  explicarErro,
  ACESSO,
  OPCOES_CORPO,
  OPCOES_QUERY
}
