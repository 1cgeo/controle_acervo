'use strict'

// Le o contrato direto dos schemas Joi do server/ e o imprime em forma compacta,
// alem de validar o corpo LOCALMENTE antes de gastar uma requisicao.
//
// O ponto do arquivo: nao existe copia do contrato em lugar nenhum. O texto que
// o agente le e derivado, em tempo de execucao, do mesmo objeto Joi que o
// Express usa para validar. Se o schema mudar, o texto muda no mesmo commit;
// nao ha artefato gerado para apodrecer nem documentacao para desatualizar.
//
// Limite conhecido e deliberado: joi.describe() nao enxerga os COMENTARIOS do
// arquivo de schema, e e neles que mora boa parte da regra de negocio (por que
// valor_nc nunca muda por devolucao, por exemplo). Por isso o comando `schema`
// tambem imprime o bloco curado de regras.js. A FORMA vem do Joi vivo; o PORQUE
// vem da prosa curta ao lado.

const { REGRAS } = require('./regras')

// SEM stripUnknown, e essa e a diferenca que separa este CLI do da mapoteca.
//
// O SCA tem DOIS middlewares com o mesmo nome. As rotas do orcamento recebem o
// ESTRITO (utils/schema_validation_estrito.js), escolhido em
// server/src/orcamento/utils/index.js: chave desconhecida no corpo vira 400 com
// sugestao do nome mais parecido, e nao some calada. O outro, que descarta,
// serve o resto do sistema.
//
// Ligar stripUnknown aqui faz o `--dry-run` aprovar corpo que o envio real
// recusa com 400, que e o pior sintoma possivel para quem automatiza.
const OPCOES_CORPO = { abortEarly: false }
const OPCOES_QUERY = { abortEarly: false }

// ---------------------------------------------------------------------------
// Formatacao do contrato
// ---------------------------------------------------------------------------

function regraPor (desc, nome) {
  return (desc.rules || []).find(r => r.name === nome)
}

/** Renderiza o tipo de um campo em notacao curta: string(<=20), int, number>0. */
function tipoDe (desc) {
  if (!desc || !desc.type) return 'any'

  switch (desc.type) {
    case 'string': {
      const max = regraPor(desc, 'max')
      const min = regraPor(desc, 'min')
      if (max && max.args) return `string(<=${max.args.limit})`
      if (min && min.args) return `string(>=${min.args.limit})`
      return 'string'
    }
    case 'number': {
      const base = regraPor(desc, 'integer') ? 'int' : 'number'
      const sinal = regraPor(desc, 'sign')
      if (sinal && sinal.args && sinal.args.sign === 'positive') return `${base}>0`
      if (sinal && sinal.args && sinal.args.sign === 'negative') return `${base}<0`
      const min = regraPor(desc, 'min')
      const max = regraPor(desc, 'max')
      if (min && max && min.args && max.args) return `${base} ${min.args.limit}..${max.args.limit}`
      if (min && min.args) return `${base}>=${min.args.limit}`
      if (max && max.args) return `${base}<=${max.args.limit}`
      return base
    }
    case 'boolean': return 'bool'
    case 'date': return 'date'
    case 'array': return 'array'
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
// `classificacao_id={"override":true}|1` e conclui que ha dois valores validos.
function semSentinela (allow) {
  return (allow || []).filter(
    v => !(v && typeof v === 'object' && 'override' in v)
  )
}

/** Sufixo de valores aceitos: " =1|2" para .valid(), " |null|''" para .allow(). */
function sufixoValores (desc) {
  if (!desc || !Array.isArray(desc.allow)) return ''
  const aceitos = semSentinela(desc.allow)
  if (!aceitos.length) return ''
  const valores = aceitos.map(formatarValor).join('|')
  // flags.only significa .valid(): a lista e exaustiva, nao aditiva.
  if (desc.flags && desc.flags.only) return ' =' + valores
  return ' |' + valores
}

/** Anotacoes extras: default, e o .raw() das datas (que muda o significado). */
function anotacoes (desc, nomeCampo) {
  const notas = []
  const flags = (desc && desc.flags) || {}

  if ('default' in flags) {
    notas.push(`default ${formatarValor(flags.default)}`)
  }
  // .raw() nas datas preserva a string 'YYYY-MM-DD' em vez de converter para
  // Date UTC. Sem isso o Postgres (sessao em UTC-3) gravaria o dia anterior.
  // E a diferenca entre gravar 2026-06-12 e 2026-06-11: vale dizer.
  // No describe o .raw() aparece como flags.result === 'raw'.
  if (desc && desc.type === 'date' && flags.result === 'raw') {
    notas.push("'YYYY-MM-DD' literal")
  }
  if (nomeCampo && /_id$/.test(nomeCampo)) {
    notas.push('FK')
  }
  return notas
}

/**
 * Renderiza o campo `alternatives().conditional()`, que e como o modulo expressa
 * invariante entre campos irmaos (o pdr_item_id da NC so existe quando a
 * classificacao e PDR). Sem tratamento proprio isso sairia como "condicional"
 * e o agente perderia exatamente a regra que mais erra.
 */
function renderCondicional (desc) {
  const casos = []
  for (const m of desc.matches || []) {
    const refPath = m.ref && m.ref.path ? m.ref.path.join('.') : 'condicao'
    const aceitos = m.is && Array.isArray(m.is.allow) ? semSentinela(m.is.allow) : []
    const alvo = aceitos.length ? aceitos.map(formatarValor).join('|') : '?'

    if (m.then) {
      casos.push(`${refPath}=${alvo}: ${tipoDe(m.then)}${sufixoValores(m.then)}` +
        (anotacoes(m.then).length ? ` (${anotacoes(m.then).join(', ')})` : ''))
    }
    if (m.otherwise) {
      const desc2 = m.otherwise
      // .strip() no otherwise = o campo e descartado silenciosamente.
      const descartado = desc2.flags && desc2.flags.result === 'strip'
      casos.push(`senao: ${descartado ? 'DESCARTADO' : tipoDe(desc2) + sufixoValores(desc2)}`)
    }
  }
  return casos
}

/** Um campo vira { nome, obrigatorio, tipo, notas[] }. */
function descreverCampo (nome, desc) {
  const obrigatorio = !!(desc.flags && desc.flags.presence === 'required')

  if (desc.type === 'alternatives') {
    return {
      nome,
      obrigatorio,
      tipo: 'condicional',
      notas: renderCondicional(desc)
    }
  }

  return {
    nome,
    obrigatorio,
    tipo: tipoDe(desc) + sufixoValores(desc),
    notas: anotacoes(desc, nome)
  }
}

/** Lista de campos de um schema de objeto Joi, ja descritos. */
function camposDe (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return []
  const desc = schemaJoi.describe()
  if (!desc.keys) return []
  return Object.entries(desc.keys).map(([nome, d]) => descreverCampo(nome, d))
}

/**
 * Dependencias declaradas no nivel do objeto: `.or('a','b')` (pelo menos um),
 * `.xor` (exatamente um), `.and`, `.nand`, `.with`, `.without`. O modulo usa `.or`
 * no rpnp (nota_empenho_id OU empenho_label) e no arquivo (o vinculo
 * polimorfico). Sem renderizar isso, o agente monta um corpo com todos os
 * campos "opcionais" preenchidos corretamente e ainda assim leva 400.
 */
function dependenciasDe (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return []
  const desc = schemaJoi.describe()
  if (!Array.isArray(desc.dependencies)) return []

  const rotulo = {
    or: 'pelo menos um de',
    xor: 'exatamente um de',
    oxor: 'no maximo um de',
    and: 'todos ou nenhum de',
    nand: 'nunca juntos'
  }

  return desc.dependencies.map(dep => {
    const pares = (dep.peers || []).map(p =>
      typeof p === 'string' ? p : (p.path ? p.path.join('.') : String(p))
    )
    const texto = rotulo[dep.rel] || dep.rel
    return `${texto}: ${pares.join(', ')}`
  })
}

/**
 * Nomes dos filtros aceitos numa listagem, lidos do schema de query da propria
 * feature. A chave e `listarQuery` na maioria dos recursos; o anexo usa
 * `vinculoQuery`, e por isso ela e parametro em vez de literal.
 */
function filtrosDe (modulo, chaveQuery = 'listarQuery') {
  const query = modulo && modulo[chaveQuery || 'listarQuery']
  if (!query) return []
  return camposDe(query).map(c => ({
    nome: c.nome,
    tipo: c.tipo
  }))
}

function alinhar (campos) {
  const larguraNome = Math.max(...campos.map(c => c.nome.length + (c.obrigatorio ? 1 : 0)), 4)
  const larguraTipo = Math.max(...campos.map(c => c.tipo.length), 4)
  return campos.map(c => {
    const nome = (c.nome + (c.obrigatorio ? '*' : '')).padEnd(larguraNome)
    const tipo = c.notas.length ? c.tipo.padEnd(larguraTipo) : c.tipo
    const cauda = c.notas.length ? '  ' + c.notas.join('; ') : ''
    return `  ${nome}  ${tipo}${cauda}`
  })
}

/**
 * Texto completo do contrato de um recurso: rotas, filtros de listagem, campos
 * de criacao/atualizacao e o bloco de regras curado.
 */
function contrato (chave, recurso) {
  const modulo = recurso.schema()
  const linhas = []
  const base = '/api' + recurso.caminho

  linhas.push(`${chave}  -  ${recurso.nome}`)
  linhas.push('')

  // Rotas. O acesso e por perfil no modulo orcamento: consulta le, operador
  // cria e atualiza, gerente deleta. O CRUD de dominio exige administrador.
  linhas.push('rotas')
  if (recurso.rotas) {
    // Recurso cuja forma foge do CRUD por id. Sem a lista explicita, o CLI
    // anunciaria o PUT e o GET por id que o registry assume por padrao, e o
    // agente descobriria pelo 404.
    linhas.push(...recurso.rotas.map(r => '  ' + r.replace('<base>', base)))
  } else if (recurso.somenteLeitura) {
    // Recurso de LEITURA, sem CRUD: o painel calcula, ninguem escreve nele. Sem
    // esta ramificacao o CLI anunciava POST, PUT e DELETE que nao existem, e o
    // agente que acreditasse no contrato descobriria pelo 404.
    for (const sub of recurso.somenteLeitura) {
      linhas.push(`  GET    ${base}/${sub.caminho}   ${sub.descricao || ''}`.trimEnd())
    }
  } else if (recurso.singleton) {
    linhas.push(`  GET    ${base}`)
    linhas.push(`  PUT    ${base}                 (singleton, sem id)`)
  } else if (chave === 'dominio') {
    linhas.push(`  GET    ${base}/<sub>            perfil consulta`)
    linhas.push(`  POST   ${base}/<sub>`)
    linhas.push(`  PUT    ${base}/<sub>/<code>`)
    linhas.push(`  DELETE ${base}/<sub>/<code>`)
    linhas.push(`  escrita so em: ${recurso.subEscrita.join(', ')}`)
    linhas.push(`  leitura em:    ${recurso.subLeitura.join(', ')}`)
  } else {
    const filtros = filtrosDe(modulo, recurso.queryListar)
    const sufixoFiltro = filtros.length
      ? `   filtros: ${filtros.map(f => `${f.nome} (${f.tipo})`).join(', ')}`
      : ''
    linhas.push(`  GET    ${base}${sufixoFiltro}`)
    linhas.push(`  GET    ${base}/:id`)
    linhas.push(`  POST   ${base}`)
    linhas.push(`  PUT    ${base}/:id`)
    linhas.push(`  DELETE ${base}/:id`)
  }
  linhas.push('')

  const schemaCorpo = modulo.criar || modulo.atualizar
  const campos = camposDe(schemaCorpo)
  if (campos.length) {
    linhas.push('campos do corpo  (* = obrigatorio)')
    linhas.push(...alinhar(campos))
    linhas.push('')

    const deps = dependenciasDe(schemaCorpo)
    if (deps.length) {
      linhas.push('  regras entre campos')
      linhas.push(...deps.map(d => '    ' + d))
      linhas.push('')
    }

    // O servidor do orcamento RECUSA a chave desconhecida, e nao a descarta: o
    // CLI a pega antes, local, e diz qual e.
    linhas.push('  campo fora desta lista e RECUSADO pelo servidor (400).')
    linhas.push('')
  }

  const regras = REGRAS[chave]
  if (regras && regras.length) {
    linhas.push('regras de negocio')
    linhas.push(...regras.map(r => '  ' + r))
    linhas.push('')
  }

  return linhas.join('\n')
}

/** Indice curto de todos os recursos, para o `orcamento schema` sem argumento. */
function indice (RECURSOS) {
  const chaves = Object.keys(RECURSOS)
  const largura = Math.max(...chaves.map(c => c.length))
  return chaves
    .map(c => `  ${c.padEnd(largura)}  ${RECURSOS[c].nome}`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Validacao local
// ---------------------------------------------------------------------------

/**
 * Valida o corpo contra o schema Joi ANTES de enviar. Devolve
 * { ok, valor, erros[], descartados[] }.
 *
 * `descartados` sao as chaves que sumiram do corpo validado por descarte
 * DELIBERADO do schema, com `.strip()`. O caso vivo e o `pdr_item_id` de uma NC
 * Extra-PDR: ele existe, e legitimo mandar, e mesmo assim nao grava. Sem este
 * aviso, isso vira "achei que gravei".
 *
 * Nome FORA do schema nao cai aqui: ele vira erro, porque o servidor do
 * orcamento o recusa com 400.
 */
function validarCorpo (schemaJoi, corpo) {
  if (!schemaJoi || typeof schemaJoi.validate !== 'function') {
    return { ok: true, valor: corpo, erros: [], descartados: [] }
  }

  const { error, value } = schemaJoi.validate(corpo, OPCOES_CORPO)

  const enviadas = Object.keys(corpo && typeof corpo === 'object' ? corpo : {})
  const mantidas = new Set(Object.keys(value && typeof value === 'object' ? value : {}))
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

/**
 * Mensagem de erro que ENSINA: alem do que falhou, imprime a linha de contrato
 * exatamente dos campos que falharam. Evita que o agente tenha que reler o
 * contrato inteiro (ou pior, o catalogo de rotas do vault) para consertar.
 */
function explicarErro (schemaJoi, erros) {
  const linhas = ['Corpo invalido (validado localmente, nada foi enviado):', '']
  for (const e of erros) linhas.push(`  ${e.mensagem}`)

  const campos = camposDe(schemaJoi)
  const falhos = new Set(erros.map(e => e.campo.split('.')[0]))
  const relevantes = campos.filter(c => falhos.has(c.nome))

  if (relevantes.length) {
    linhas.push('')
    linhas.push('contrato dos campos citados:')
    linhas.push(...alinhar(relevantes))
  }

  linhas.push('')
  linhas.push('contrato completo: orcamento schema <recurso>')
  return linhas.join('\n')
}

module.exports = {
  contrato,
  indice,
  camposDe,
  filtrosDe,
  dependenciasDe,
  descreverCampo,
  tipoDe,
  sufixoValores,
  alinhar,
  validarCorpo,
  explicarErro,
  OPCOES_CORPO,
  OPCOES_QUERY
}
