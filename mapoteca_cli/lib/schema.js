// Path: lib\schema.js
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
// forma_entrega fica nula no cadastro, por exemplo). Por isso o comando `schema`
// tambem imprime o bloco curado de regras.js. A FORMA vem do Joi vivo; o PORQUE
// vem da prosa curta ao lado.

const { REGRAS } = require('./regras')

// Mesmas opcoes do middleware do servidor (utils/schema_validation.js): o corpo
// valida com stripUnknown, a query sem. Divergir aqui produziria um CLI que
// aceita o que o servidor recusa, ou o contrario, que e pior que nao validar.
const OPCOES_CORPO = { stripUnknown: true, abortEarly: false }
const OPCOES_QUERY = { abortEarly: false }

// ---------------------------------------------------------------------------
// Formatacao do contrato
// ---------------------------------------------------------------------------

function regraPor (desc, nome) {
  return (desc.rules || []).find(r => r.name === nome)
}

/** Renderiza o alvo de um limite, que pode ser numero ou referencia a outro campo. */
function limiteDe (args) {
  if (!args) return null
  const bruto = 'limit' in args ? args.limit : args.date
  if (bruto && typeof bruto === 'object' && bruto.ref) {
    return (bruto.ref.path || []).join('.')
  }
  return bruto
}

/** Renderiza o tipo de um campo em notacao curta: string(<=20), int>=1, uuid. */
function tipoDe (desc) {
  if (!desc || !desc.type) return 'any'

  // Joi.when() no nivel do campo (sem tipo base) chega como `any` com `whens`.
  // E como a mapoteca expressa invariante entre campos irmaos (data_atendimento
  // so e obrigatoria quando o pedido esta concluido).
  if (Array.isArray(desc.whens) && desc.whens.length) return 'condicional'

  switch (desc.type) {
    case 'string': {
      if (regraPor(desc, 'guid')) return 'uuid'
      const padrao = regraPor(desc, 'pattern')
      if (padrao && padrao.args) return `string ${padrao.args.regex}`
      const max = regraPor(desc, 'max')
      const min = regraPor(desc, 'min')
      if (max && max.args) return `string(<=${limiteDe(max.args)})`
      if (min && min.args) return `string(>=${limiteDe(min.args)})`
      return 'string'
    }
    case 'number': {
      const base = regraPor(desc, 'integer') ? 'int' : 'number'
      const sinal = regraPor(desc, 'sign')
      if (sinal && sinal.args && sinal.args.sign === 'positive') return `${base}>0`
      if (sinal && sinal.args && sinal.args.sign === 'negative') return `${base}<0`
      const min = regraPor(desc, 'min')
      const max = regraPor(desc, 'max')
      if (min && max) return `${base} ${limiteDe(min.args)}..${limiteDe(max.args)}`
      if (min) return `${base}>=${limiteDe(min.args)}`
      if (max) return `${base}<=${limiteDe(max.args)}`
      return base
    }
    case 'boolean': return 'bool'
    case 'date': {
      const min = regraPor(desc, 'min')
      // O min de uma data costuma referenciar outro campo (data_atendimento nao
      // pode ser anterior a data_pedido). Sem renderizar isso, o agente monta um
      // corpo aparentemente correto e leva 400.
      if (min && min.args) return `date>=${limiteDe(min.args)}`
      return 'date'
    }
    case 'array': {
      const itens = Array.isArray(desc.items) && desc.items.length
        ? tipoDe(desc.items[0])
        : 'any'
      const min = regraPor(desc, 'min')
      const sufixo = min && min.args ? `, min ${limiteDe(min.args)}` : ''
      return `array<${itens}>${sufixo}`
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
// SUBSTITUI a lista anterior (e o que .valid() faz em alguns caminhos). Ele e
// detalhe interno do describe, nunca um valor aceito: se vazar para a saida, o
// agente le `situacao_pedido_id={"override":true}|5` e conclui que ha um valor
// valido a mais.
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

/** Anotacoes extras: default, o .raw() das datas, a description do proprio Joi. */
function anotacoes (desc, nomeCampo) {
  const notas = []
  const flags = (desc && desc.flags) || {}

  if ('default' in flags && typeof flags.default !== 'function') {
    notas.push(`default ${formatarValor(flags.default)}`)
  }
  // .raw() nas datas preserva a string 'YYYY-MM-DD' em vez de converter para
  // Date UTC. Sem isso o Postgres (sessao em UTC-3) gravaria o dia anterior.
  // E a diferenca entre gravar 2026-06-12 e 2026-06-11: vale dizer.
  if (desc && desc.type === 'date' && flags.result === 'raw') {
    notas.push("'YYYY-MM-DD' literal")
  }
  // .description() e a unica prosa que o describe() enxerga: se o autor do
  // schema escreveu, mostra.
  if (flags.description) notas.push(flags.description)
  if (nomeCampo && /_id$/.test(nomeCampo) && !(desc.flags && desc.flags.only)) {
    notas.push('FK')
  }
  return notas
}

/**
 * Renderiza o campo declarado com Joi.when(), que e como a mapoteca expressa
 * invariante entre campos irmaos (data_atendimento so e obrigatoria com o
 * pedido concluido; motivo_cancelamento so com o pedido cancelado). Sem
 * tratamento proprio isso sairia como "any" e o agente perderia exatamente a
 * regra que mais custa: descobrir pelo 400 que faltava um campo.
 */
function renderCondicional (desc) {
  const casos = []
  for (const w of desc.whens || []) {
    const refPath = w.ref && w.ref.path ? w.ref.path.join('.') : 'condicao'
    const aceitos = w.is && Array.isArray(w.is.allow) ? semSentinela(w.is.allow) : []
    const alvo = aceitos.length ? aceitos.map(formatarValor).join('|') : '?'

    if (w.then) {
      const obrigatorio = w.then.flags && w.then.flags.presence === 'required'
      const notas = anotacoes(w.then)
      casos.push(
        `${refPath}=${alvo}: ${tipoDe(w.then)}${sufixoValores(w.then)}` +
        (obrigatorio ? ' OBRIGATORIO' : '') +
        (notas.length ? ` (${notas.join(', ')})` : '')
      )
    }
    if (w.otherwise) {
      const outro = w.otherwise
      // .strip() no otherwise = o campo e descartado silenciosamente.
      const descartado = outro.flags && outro.flags.result === 'strip'
      casos.push(
        `senao: ${descartado ? 'DESCARTADO' : tipoDe(outro) + sufixoValores(outro)}`
      )
    }
  }
  return casos
}

/** Um campo vira { nome, obrigatorio, tipo, notas[] }. */
function descreverCampo (nome, desc) {
  const obrigatorio = !!(desc.flags && desc.flags.presence === 'required')

  if ((Array.isArray(desc.whens) && desc.whens.length) || desc.type === 'alternatives') {
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
 * Dependencias declaradas no nivel do objeto: `.or`, `.xor`, `.and`, `.with`.
 * A mapoteca hoje nao usa nenhuma, mas ler isso do describe e o que garante que
 * o dia em que alguem acrescentar uma, o contrato ja a mostre sem tocar no CLI.
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
    return `${rotulo[dep.rel] || dep.rel}: ${pares.join(', ')}`
  })
}

/**
 * Validacao `.custom()` no nivel do objeto: o describe so diz que ela existe,
 * nunca o que ela checa. Vale avisar que ha uma regra invisivel ali, para o
 * agente nao concluir que o contrato impresso e exaustivo.
 */
function customDe (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return false
  const desc = schemaJoi.describe()
  return (desc.rules || []).some(r => r.name === 'custom')
}

/**
 * Nomes dos campos de DATA de um schema, inclusive os que so viram data dentro
 * de um Joi.when().
 *
 * Existe por causa de um modo de falha caro e silencioso: o servidor devolve a
 * data como timestamp ISO completo ('2026-07-24T00:00:00.000Z') e o schema a
 * aceita de volta com .raw(), ou seja, grava a STRING como veio numa coluna
 * DATE. Com a sessao do Postgres em UTC-3, isso pode gravar o dia anterior. Quem
 * le um pedido e o reenvia (que e o que qualquer atualizacao parcial faz)
 * precisa recortar a data antes.
 */
function camposDataDe (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return []
  const desc = schemaJoi.describe()
  if (!desc.keys) return []

  return Object.entries(desc.keys)
    .filter(([, d]) => {
      if (d.type === 'date') return true
      return (d.whens || []).some(w =>
        (w.then && w.then.type === 'date') || (w.otherwise && w.otherwise.type === 'date')
      )
    })
    .map(([nome]) => nome)
}

/** Recorta um timestamp ISO em 'YYYY-MM-DD'; devolve o resto intacto. */
function soData (valor) {
  if (valor === null || valor === undefined || valor === '') return valor
  const texto = String(valor)
  const casa = texto.match(/^(\d{4}-\d{2}-\d{2})/)
  return casa ? casa[1] : valor
}

/** Nomes dos filtros aceitos numa listagem, lidos do proprio schema de query. */
function filtrosDe (modulo) {
  if (!modulo || !modulo.listarQuery) return []
  return camposDe(modulo.listarQuery).map(c => ({ nome: c.nome, tipo: c.tipo }))
}

function alinhar (campos) {
  const larguraNome = Math.max(...campos.map(c => c.nome.length + (c.obrigatorio ? 1 : 0)), 4)
  const larguraTipo = Math.max(...campos.map(c => c.tipo.length), 4)
  return campos.flatMap(c => {
    const nome = (c.nome + (c.obrigatorio ? '*' : '')).padEnd(larguraNome)
    const tipo = c.notas.length ? c.tipo.padEnd(larguraTipo) : c.tipo
    // Condicional rende varias linhas; espalhar evita uma linha de 200 colunas
    // que o agente le pela metade.
    if (c.tipo === 'condicional' && c.notas.length > 1) {
      return [
        `  ${nome}  ${tipo}`,
        ...c.notas.map(n => `  ${' '.repeat(larguraNome)}  ${' '.repeat(larguraTipo)}  ${n}`)
      ]
    }
    const cauda = c.notas.length ? '  ' + c.notas.join('; ') : ''
    return [`  ${nome}  ${tipo}${cauda}`]
  })
}

/**
 * Texto completo do contrato de um recurso: rotas, campos de criacao e de
 * atualizacao, o corpo do delete e o bloco de regras curado.
 */
function contrato (chave, recurso) {
  const modulo = recurso.schema()
  const linhas = []
  const base = '/api' + recurso.caminho

  linhas.push(`${chave}  -  ${recurso.nome}`)
  linhas.push('')

  linhas.push('rotas')
  if (!recurso.semListar) {
    const filtros = filtrosDe(modulo)
    const sufixoFiltro = filtros.length
      ? `   filtros: ${filtros.map(f => `${f.nome} (${f.tipo})`).join(', ')}`
      : ''
    linhas.push(`  GET    ${base}${sufixoFiltro}`)
    linhas.push(`  GET    ${base}/:id`)
  } else {
    linhas.push(`  (sem GET proprio: os itens vem dentro de GET /api/mapoteca/pedido/:id)`)
  }
  linhas.push(`  POST   ${base}`)
  linhas.push(`  PUT    ${base}                 o id vai no CORPO, nao na URL`)
  linhas.push(`  DELETE ${base}                 corpo {"${recurso.chaveIds}": [ids]}, sempre em LOTE`)
  linhas.push('')

  const campos = camposDe(modulo.criar)
  if (campos.length) {
    linhas.push('campos do corpo em POST  (* = obrigatorio)')
    linhas.push(...alinhar(campos))
    linhas.push('')

    const deps = dependenciasDe(modulo.criar)
    if (deps.length) {
      linhas.push('  regras entre campos')
      linhas.push(...deps.map(d => '    ' + d))
      linhas.push('')
    }
    if (customDe(modulo.criar)) {
      linhas.push('  ha uma validacao .custom() no nivel do objeto que o describe() nao')
      linhas.push('  consegue detalhar: o contrato acima nao e exaustivo para este recurso.')
      linhas.push('')
    }

    // stripUnknown do servidor: campo com nome errado some sem erro. E a
    // armadilha mais cara da API para quem escreve, e por isso ela e dita aqui.
    linhas.push('  campo fora desta lista e DESCARTADO em silencio pelo servidor')
    linhas.push('  (stripUnknown); o mapoteca avisa quando isso acontece.')
    linhas.push('')
  }

  // O PUT da mapoteca substitui a linha inteira: os campos sao os mesmos do POST
  // mais o id. Dizer isso explicitamente evita o modo de falha mais caro da API,
  // que e mandar so o campo que mudou e zerar todo o resto.
  const camposPut = camposDe(modulo.atualizar)
  if (camposPut.length) {
    const soNoPut = camposPut
      .filter(c => !campos.some(k => k.nome === c.nome))
      .map(c => c.nome + (c.obrigatorio ? '*' : ''))
    linhas.push('campos do corpo em PUT')
    linhas.push(`  os mesmos do POST, mais: ${soNoPut.join(', ') || '(nenhum)'}`)
    linhas.push('  o PUT SUBSTITUI a linha: campo omitido volta ao default (em geral null).')
    linhas.push('  Leia o registro, altere o que muda e reenvie o corpo inteiro.')
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

/** Indice curto de todos os recursos, para o `mapoteca schema` sem argumento. */
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
 * `descartados` sao as chaves que o stripUnknown removeria: o servidor as
 * ignoraria sem reclamar, o que faz um erro de digitacao virar um campo que
 * simplesmente nao gravou. Detectar isso aqui e o unico jeito de o agente ficar
 * sabendo. Vale lembrar que o livro-razao do vault ja registra esta familia de
 * erro: "a ferramenta disse OK e nada foi gravado".
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
 * contrato inteiro para consertar uma virgula.
 */
function explicarErro (schemaJoi, erros, dica) {
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
  linhas.push(dica || 'contrato completo: mapoteca schema <recurso>')
  return linhas.join('\n')
}

module.exports = {
  contrato,
  indice,
  camposDe,
  camposDataDe,
  soData,
  filtrosDe,
  dependenciasDe,
  customDe,
  descreverCampo,
  tipoDe,
  sufixoValores,
  renderCondicional,
  alinhar,
  validarCorpo,
  explicarErro,
  OPCOES_CORPO,
  OPCOES_QUERY
}
