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
// arquivo de schema nem os triggers do banco, e e neles que mora boa parte da
// regra de negocio (por que a data_edicao prova a edicao e o rotulo nao, por
// exemplo). Por isso o comando `schema` tambem imprime o bloco curado de
// regras.js. A FORMA vem do Joi vivo; o PORQUE vem da prosa curta ao lado.

const { REGRAS } = require('./regras')

// Mesmas opcoes do middleware do servidor (utils/schema_validation.js): o corpo
// valida com stripUnknown, a query e os params sem. Divergir aqui produziria um
// CLI que aceita o que o servidor recusa, ou o contrario, que e pior que nao
// validar.
const OPCOES_CORPO = { stripUnknown: true, abortEarly: false }
const OPCOES_QUERY = { abortEarly: false }

// Ate onde descer nos aninhamentos ao imprimir. O SCA aninha fundo
// (produtos[].versoes[].arquivos[]), e sem limite o contrato de um
// prepare-upload/product viraria uma parede de texto.
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

/** Renderiza o tipo de um campo em notacao curta: string(<=20), int, date>=ref:x. */
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
    case 'date': {
      // O min de uma data costuma ser referencia a campo irmao
      // (data_edicao >= data_criacao). Sem imprimir isso, o agente monta um
      // corpo formalmente correto e leva 400 sem entender por que.
      const min = regraPor(desc, 'min')
      const ref = min && limite(min.args, 'date')
      return ref ? `date>=${ref}` : 'date'
    }
    case 'array': {
      const min = limite(regraPor(desc, 'min') && regraPor(desc, 'min').args)
      const itens = desc.items && desc.items.length ? desc.items[0] : null
      const dentro = itens ? tipoDe(itens) : 'any'
      const unico = regraPor(desc, 'unique') ? ' unico' : ''
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
// `cliente={"override":true}|sca_web` e conclui que ha um valor a mais.
function semSentinela (allow) {
  return (allow || []).filter(
    v => !(v && typeof v === 'object' && 'override' in v)
  )
}

/** Sufixo de valores aceitos: " =a|b" para .valid(), " |null|''" para .allow(). */
function sufixoValores (desc) {
  if (!desc || !Array.isArray(desc.allow)) return ''
  const aceitos = semSentinela(desc.allow)
  if (!aceitos.length) return ''
  const valores = aceitos.map(formatarValor).join('|')
  // flags.only significa .valid(): a lista e exaustiva, nao aditiva.
  if (desc.flags && desc.flags.only) return ' =' + valores
  return ' |' + valores
}

/** Anotacoes extras: default, strict, FK. */
function anotacoes (desc, nomeCampo) {
  const notas = []
  const flags = (desc && desc.flags) || {}

  if ('default' in flags) {
    // Aqui mora a armadilha silenciosa do SCA: num PUT de objeto inteiro, campo
    // com default que voce nao mandar e GRAVADO com o default, apagando o valor
    // que estava la. Marcar sempre.
    notas.push(`default ${formatarValor(flags.default)}`)
  }
  // .strict() desliga a coercao: "1" (string) e recusado onde se espera 1.
  // Como o corpo entra por JSON na linha de comando, essa distincao e real.
  if (desc && desc.preferences && desc.preferences.convert === false) {
    notas.push('strict (sem coercao de tipo)')
  }
  if (nomeCampo && /_id$/.test(nomeCampo)) {
    notas.push('FK')
  }
  return notas
}

/**
 * Renderiza o campo `alternatives().conditional()`, que e como o SCA expressa
 * invariante entre campos irmaos (o denominador_escala_especial so existe em
 * escala personalizada; o arquivo de Tileserver nao tem checksum). Sem
 * tratamento proprio isso sairia como "condicional" e o agente perderia
 * exatamente a regra que mais erra.
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
        (extras.length ? ` (${extras.join(', ')})` : '') +
        (m.then.flags && m.then.flags.presence === 'required' ? ' obrigatorio' : ''))
    }
    if (m.otherwise) {
      const outro = m.otherwise
      // .strip() no otherwise = o campo e descartado silenciosamente.
      const descartado = outro.flags && outro.flags.result === 'strip'
      casos.push(`senao: ${descartado ? 'DESCARTADO' : tipoDe(outro) + sufixoValores(outro)}` +
        (!descartado && outro.flags && outro.flags.presence === 'required' ? ' obrigatorio' : ''))
    }
  }
  return casos
}

/**
 * O campo declarado `forbidden()`: o servidor responde 400 se ele vier no corpo.
 *
 * Ele precisa de tratamento proprio porque o `describe()` o entrega como
 * `type: 'any'` sem regra nenhuma, e ele sairia impresso como `campo any`. O
 * agente leria isso como "campo opcional que aceita qualquer coisa", que e a
 * leitura exatamente oposta. A mensagem do `.messages()` entra junto porque e
 * nela que mora o motivo da recusa e o caminho certo (`data_fim_prevista` e do
 * lote, o `checksum` e medido pelo servidor).
 */
function ehRecusado (desc) {
  return !!(desc && desc.flags && desc.flags.presence === 'forbidden')
}

function motivoDaRecusa (desc) {
  const mensagens = desc.preferences && desc.preferences.messages
  const texto = mensagens && mensagens['any.unknown']
  return texto ? [texto] : []
}

/** Um campo vira { nome, obrigatorio, tipo, notas[], filhos[] }. */
function descreverCampo (nome, desc, profundidade = 0) {
  const obrigatorio = !!(desc.flags && desc.flags.presence === 'required')

  if (ehRecusado(desc)) {
    return {
      nome,
      obrigatorio: false,
      tipo: 'RECUSADO (400)',
      notas: motivoDaRecusa(desc),
      filhos: []
    }
  }

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
    // Objeto aninhado e array de objetos: descer. Sem isto, o contrato de
    // `versao_relacionamento array<object>` nao diria quais chaves o objeto tem,
    // que e a unica coisa que o agente precisa saber para montar o corpo.
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
 * schema de ARRAY no topo (o SCA usa array no topo em versao_historica e em
 * produto_versao_historica: o corpo inteiro e uma lista).
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

/** Bloco de campos de um schema, com dependencias e o aviso do stripUnknown. */
function blocoCampos (schemaJoi, titulo, avisarStrip) {
  const campos = camposDe(schemaJoi)
  if (!campos.length) return []

  const linhas = []
  const array = ehArrayNoTopo(schemaJoi)
  linhas.push(`  ${titulo}${array ? ' (o corpo e um ARRAY destes objetos)' : ''}  (* = obrigatorio)`)
  linhas.push(...alinhar(campos, '    '))

  const deps = dependenciasDe(schemaJoi)
  if (deps.length) {
    linhas.push('    regras entre campos')
    linhas.push(...deps.map(d => '      ' + d))
  }
  if (avisarStrip) {
    // stripUnknown do servidor: campo com nome errado some sem erro. E a
    // armadilha mais cara da API para quem escreve, e por isso ela e dita aqui.
    linhas.push('    campo fora desta lista e DESCARTADO em silencio (stripUnknown);')
    linhas.push('    o acervo avisa quando isso acontece.')
  }
  return linhas
}

// O nivel vem do guard da rota no server/ (verifyPerfil no modulo acervo,
// verifyGerente ou verifyAdmin). Os perfis sao hierarquicos: gerente alcanca o
// que operador alcanca, e operador o que consulta alcanca. O administrador e
// global e passa em qualquer um.
//
// `gerente_qualquer` NAO E O MESMO que `gerente`, e a distincao e do RPCMTec: o
// `verifyGerente` do server/ aceita gerente de QUALQUER modulo, e nao gerente do
// acervo. Traduzi-lo como `gerente` faria o contrato afirmar que a leitura do
// relatorio pede perfil no acervo, o que fecharia a porta, no papel, para o
// gerente da mapoteca -- que e justamente quem confere a secao dele antes da
// assinatura.
const ACESSO = {
  publico: 'publico (sem login)',
  login: 'exige login',
  consulta: 'exige perfil CONSULTA no modulo acervo',
  operador: 'exige perfil OPERADOR no modulo acervo',
  gerente: 'exige perfil GERENTE no modulo acervo',
  gerente_qualquer: 'exige GERENTE de QUALQUER modulo (ou administrador)',
  admin: 'exige ADMINISTRADOR'
}

/** Texto completo do contrato de um recurso: uma secao por operacao real. */
function contrato (chave, recurso) {
  const modulo = recurso.schema()
  const linhas = []

  linhas.push(`${chave}  -  ${recurso.nome}`)
  linhas.push('')

  for (const [acao, op] of Object.entries(recurso.operacoes)) {
    linhas.push(`acervo ${chave} ${acao}`)
    linhas.push(`  ${op.metodo} /api${op.caminho}   ${ACESSO[op.acesso] || op.acesso}`)
    if (op.nota) linhas.push(`  nota: ${op.nota}`)
    if (op.objetoInteiro) {
      linhas.push('  PUT de objeto INTEIRO: mande o registro completo, nunca so o campo')
      linhas.push('  que mudou. Use `acervo editar` para nao errar isto.')
    }
    if (op.pesado) linhas.push(`  operacao pesada: ${op.pesado}`)
    // `destrutivo` e o aviso da operacao que muda ou apaga sem levar corpo. O
    // `confirmar` nao alcanca esse caso: ele exige repetir os identificadores
    // atingidos, e a rota de limpeza nao tem corpo nem :param de onde tira-los.
    // Exigi-lo ali travaria a operacao para sempre, em vez de guarda-la.
    if (op.destrutivo) linhas.push(`  operacao destrutiva: ${op.destrutivo}`)
    if (op.confirmar) {
      linhas.push(`  IRREVERSIVEL, exige --confirmar com os valores de ${op.confirmar.campo}:`)
      linhas.push(`    ${op.confirmar.motivo}`)
    }

    if (op.query) {
      linhas.push(...blocoCampos(modulo[op.query], 'filtros de query', false))
    }
    if (op.params) {
      linhas.push(...blocoCampos(modulo[op.params], 'parametros da rota', false))
    }
    if (op.corpo) {
      linhas.push(...blocoCampos(modulo[op.corpo], 'campos do corpo', true))
    }
    linhas.push('')
  }

  const regras = REGRAS[chave]
  if (regras && regras.length) {
    linhas.push('regras de negocio (o que o Joi nao diz)')
    linhas.push(...regras.map(r => '  ' + r))
    linhas.push('')
  }

  return linhas.join('\n')
}

/** Indice curto de todos os recursos, para o `acervo schema` sem argumento. */
function indice (RECURSOS) {
  const chaves = Object.keys(RECURSOS)
  const largura = Math.max(...chaves.map(c => c.length))
  return chaves
    .map(c => {
      const ops = Object.keys(RECURSOS[c].operacoes)
      return `  ${c.padEnd(largura)}  ${RECURSOS[c].nome}\n` +
        `  ${' '.repeat(largura)}  ${ops.length} operacoes: ${ops.join(', ')}`
    })
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
 * sabendo.
 */
function validarCorpo (schemaJoi, corpo) {
  if (!schemaJoi || typeof schemaJoi.validate !== 'function') {
    return { ok: true, valor: corpo, erros: [], descartados: [] }
  }

  const { error, value } = schemaJoi.validate(corpo, OPCOES_CORPO)

  // So faz sentido comparar chaves quando o corpo e um objeto no topo; com
  // array no topo o stripUnknown age item a item.
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

/** Valida query/params (sem stripUnknown, como o servidor). */
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
 * Campos que o schema preencheria com DEFAULT porque a base lida nao os traz.
 * Num PUT de objeto inteiro, isso e gravar o default por cima do valor real, em
 * silencio. E a diferenca entre "corrigi a data" e "corrigi a data e apaguei o
 * subtipo".
 *
 * @param {object} schemaJoi schema do corpo do PUT
 * @param {object} base o registro lido do servidor
 * @returns {Array<{campo: string, padrao: any}>}
 */
function defaultsAusentes (schemaJoi, base) {
  const campos = camposDe(schemaJoi)
  const presentes = new Set(Object.keys(base || {}))
  const saida = []
  for (const c of campos) {
    const temDefault = c.notas.some(n => n.startsWith('default '))
    if (temDefault && !presentes.has(c.nome)) {
      saida.push({ campo: c.nome, padrao: c.notas.find(n => n.startsWith('default ')).slice(8) })
    }
  }
  return saida
}

/**
 * Nomes dos campos NUMERICOS declarados `.strict()`.
 *
 * Existe por causa do driver: coluna BIGINT/BIGSERIAL do Postgres volta como
 * STRING no JSON (ela nao cabe no numero do JavaScript sem risco). Entao um
 * `lote_id` lido do proprio servidor volta como "107", e o Joi `.strict()` do
 * PUT o recusa. Quem le-altera-reenvia precisa desfazer essa stringificacao, e
 * so nela: string que veio do usuario continua sendo erro dele.
 */
function numerosStrict (schemaJoi) {
  return camposDe(schemaJoi)
    .filter(c => /^int|^number/.test(c.tipo) && c.notas.some(n => n.startsWith('strict')))
    .map(c => c.nome)
}

/**
 * Mensagem de erro que ENSINA: alem do que falhou, imprime a linha de contrato
 * exatamente dos campos que falharam. Evita que o agente tenha que reler o
 * contrato inteiro para consertar um campo.
 */
function explicarErro (schemaJoi, erros, dica, titulo) {
  const linhas = [
    (titulo || 'Corpo invalido') + ' (validado localmente, nada foi enviado):',
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
  linhas.push(dica || 'contrato completo: acervo schema <recurso>')
  return linhas.join('\n')
}

module.exports = {
  contrato,
  indice,
  camposDe,
  ehArrayNoTopo,
  sufixoValores,
  validarCorpo,
  validarQuery,
  defaultsAusentes,
  numerosStrict,
  explicarErro
}
