'use strict'

// Le o contrato direto do schema Joi do server/ e o imprime em forma compacta,
// alem de validar o corpo LOCALMENTE antes de gastar uma requisicao.
//
// O ponto do arquivo: nao existe copia do contrato em lugar nenhum. O texto que
// o agente le e derivado, em tempo de execucao, do mesmo objeto Joi que o
// Express usa para validar. Se o equipamento_schema.js mudar, o texto muda no
// mesmo commit; nao ha artefato gerado para apodrecer nem documentacao para
// desatualizar.
//
// Limite conhecido e deliberado: joi.describe() nao enxerga os COMENTARIOS do
// arquivo de schema, e e neles que mora boa parte da regra de negocio (por que a
// situacao do bem nao e campo, por exemplo). Por isso o comando `schema` tambem
// imprime o bloco curado de regras.js. A FORMA vem do Joi vivo; o PORQUE vem da
// prosa curta ao lado.

const { REGRAS } = require('./regras')

// SEM stripUnknown, e essa e a diferenca que separa este CLI do da mapoteca.
//
// As rotas do equipamento recebem o validador ESTRITO
// (utils/schema_validation_estrito.js): chave desconhecida no corpo vira 400 com
// sugestao do nome mais parecido, e nao some calada. Ligar stripUnknown aqui
// faria o `--dry-run` aprovar corpo que o envio real recusa com 400, que e o
// pior sintoma possivel para quem automatiza.
const OPCOES_CORPO = { abortEarly: false }
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

/** Renderiza o tipo de um campo em notacao curta: string(<=30), int>0, date>=data_inicio. */
function tipoDe (desc) {
  if (!desc || !desc.type) return 'any'

  switch (desc.type) {
    case 'string': {
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
      // O `min` de uma data aqui referencia OUTRO CAMPO (data_fim >= data_inicio,
      // que espelha os CHECK *_fim_apos_inicio do DDL). Sem renderizar a
      // referencia, o agente monta um corpo aparentemente correto e leva 400.
      const min = regraPor(desc, 'min')
      if (min && min.args) return `date>=${limiteDe(min.args)}`
      return 'date'
    }
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
// SUBSTITUI a lista anterior (e o que .valid() faz em alguns caminhos). Ele e
// detalhe interno do describe, nunca um valor aceito: se vazar para a saida, o
// agente le `situacao_id={"override":true}|1` e conclui que ha um valor valido a
// mais.
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

/**
 * Anotacoes extras de um campo: default, trim, precisao, o .raw() das datas e as
 * MENSAGENS que o autor do schema escreveu.
 *
 * As mensagens entram porque neste modulo elas sao a regra em prosa, ja em
 * portugues ("A data de fim deve ser igual ou posterior a data de inicio"). Sem
 * imprimi-las, essa frase so apareceria no 400.
 */
function anotacoes (desc, nomeCampo) {
  const notas = []
  const flags = (desc && desc.flags) || {}

  // DEFAULT E VALOR PRESENTE, nao ausencia. Um campo com .default() que o corpo
  // omite chega ao banco com o default, e num PUT (que substitui a linha) isso
  // REVERTE o que estava gravado. Marcar aqui e o minimo; quem impede o estrago
  // e o ciclo ler-mesclar-reenviar dos comandos de alteracao.
  if ('default' in flags && typeof flags.default !== 'function') {
    notas.push(`default ${formatarValor(flags.default)}`)
  }

  // .raw() nas datas preserva a string 'AAAA-MM-DD' em vez de converter para
  // Date UTC. Sem isso o Postgres (sessao em UTC-3) gravaria o dia anterior.
  if (desc && desc.type === 'date' && flags.result === 'raw') {
    notas.push("'AAAA-MM-DD' literal")
  }

  if (desc && desc.type === 'string' && regraPor(desc, 'trim')) {
    notas.push('espaços das pontas removidos')
  }

  const precisao = desc && regraPor(desc, 'precision')
  if (precisao && precisao.args) {
    notas.push(`${limiteDe(precisao.args)} casas decimais`)
  }

  // .description() e a unica prosa livre que o describe() enxerga.
  if (flags.description) notas.push(flags.description)

  const mensagens = (desc && desc.preferences && desc.preferences.messages) || null
  if (mensagens) {
    for (const texto of Object.values(mensagens)) {
      if (typeof texto === 'string') notas.push(texto)
    }
  }

  if (nomeCampo && /_id$/.test(nomeCampo) && !(desc.flags && desc.flags.only)) {
    notas.push('FK')
  }
  return notas
}

/** Um campo vira { nome, obrigatorio, tipo, notas[] }. */
function descreverCampo (nome, desc) {
  return {
    nome,
    obrigatorio: !!(desc.flags && desc.flags.presence === 'required'),
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
 * Os campos com `.default()` e o valor de cada um.
 *
 * Existe por causa de um modo de falha que ja custou caro no acervo_cli em
 * 2026-08-08: campo com `.default(false)` SOME da saida de quem trata default
 * como ausencia. Aqui ele e tratado como VALOR PRESENTE: quem monta um corpo
 * para PUT precisa saber que omitir `ativo` grava `true` e que omitir
 * `transferido_siafi` grava `false`, revertendo o que estava la.
 */
function camposComDefault (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return []
  const desc = schemaJoi.describe()
  if (!desc.keys) return []
  return Object.entries(desc.keys)
    .filter(([, d]) => d.flags && 'default' in d.flags && typeof d.flags.default !== 'function')
    .map(([nome, d]) => ({ nome, valor: d.flags.default }))
}

/**
 * Nomes dos campos de DATA de um schema.
 *
 * Existe por causa de um modo de falha silencioso: o servidor devolve a data
 * como timestamp ISO completo ('2026-05-11T03:00:00.000Z') e o schema a aceita
 * de volta com .raw(), ou seja, grava a STRING como veio numa coluna DATE. Quem
 * le um lancamento e o reenvia (que e o que toda alteracao faz aqui) precisa
 * recortar a data antes.
 */
function camposDataDe (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return []
  const desc = schemaJoi.describe()
  if (!desc.keys) return []
  return Object.entries(desc.keys)
    .filter(([, d]) => d.type === 'date')
    .map(([nome]) => nome)
}

/**
 * Recorta um timestamp ISO em 'AAAA-MM-DD'; devolve o resto intacto.
 *
 * O recorte e do PREFIXO da string, e nao uma conversao de fuso: o SCA roda em
 * UTC-3, onde a meia-noite local de um dia serializa como 'AAAA-MM-DDT03:00:00Z'
 * e o prefixo e o dia certo. E o mesmo recorte do mapoteca_cli.
 */
function soData (valor) {
  if (valor === null || valor === undefined || valor === '') return valor
  const texto = String(valor)
  const casa = texto.match(/^(\d{4}-\d{2}-\d{2})/)
  return casa ? casa[1] : valor
}

const ROTULO_DEP = {
  or: 'pelo menos um de',
  xor: 'exatamente um de',
  oxor: 'no máximo um de',
  and: 'todos ou nenhum de',
  nand: 'nunca juntos'
}

/**
 * Dependencias declaradas no nivel do objeto (`.or`, `.xor`, `.and`, `.with`).
 * O schema do equipamento nao usa nenhuma hoje, e imprimir isso continua valendo:
 * o dia em que uma entrar, ela aparece no contrato sem ninguem tocar no CLI.
 */
function dependenciasDe (schemaJoi) {
  if (!schemaJoi || typeof schemaJoi.describe !== 'function') return []
  const desc = schemaJoi.describe()
  if (!Array.isArray(desc.dependencies)) return []

  return desc.dependencies.map(dep => {
    const pares = (dep.peers || []).map(p =>
      typeof p === 'string' ? p : (p.path ? p.path.join('.') : String(p))
    )
    return `${ROTULO_DEP[dep.rel] || dep.rel}: ${pares.join(', ')}`
  })
}

/** Nomes e tipos dos filtros aceitos numa listagem, lidos do proprio schema de query. */
function filtrosDe (modulo) {
  if (!modulo || !modulo.listarQuery) return []
  return camposDe(modulo.listarQuery).map(c => ({ nome: c.nome, tipo: c.tipo }))
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
 * de criacao, o que muda na atualizacao, os defaults e o bloco de regras curado.
 */
function contrato (chave, recurso) {
  const modulo = typeof recurso.schema === 'function' ? recurso.schema() : {}
  const linhas = []
  const base = '/api' + recurso.caminho

  linhas.push(`${chave}  -  ${recurso.nome}`)
  linhas.push('')

  const filtros = filtrosDe(modulo)
  const textoFiltros = filtros.length
    ? `   filtros: ${filtros.map(f => `${f.nome} (${f.tipo})`).join(', ')}`
    : ''

  // Cada rota vem como 'ESQUERDA :: nota', e a nota e alinhada numa coluna so.
  // O marcador <filtros> nao entra na linha da rota: com cinco filtros ela
  // passaria de 200 colunas, que o agente le pela metade.
  const entradas = (recurso.rotas || []).map(r => {
    const partes = r.split(' :: ')
    return {
      esquerda: partes[0].replace('<base>', base).replace('<filtros>', '').trimEnd(),
      nota: partes[1] || '',
      temFiltros: r.includes('<filtros>')
    }
  })
  const largura = entradas.length
    ? Math.max(...entradas.filter(e => e.nota).map(e => e.esquerda.length), 0)
    : 0

  linhas.push('rotas')
  for (const e of entradas) {
    linhas.push('  ' + (e.nota ? e.esquerda.padEnd(largura) + '   ' + e.nota : e.esquerda))
    if (e.temFiltros && textoFiltros) {
      linhas.push('  ' + ' '.repeat(7) + textoFiltros.trim())
    }
  }
  linhas.push('')

  const campos = camposDe(modulo.criar)
  if (campos.length) {
    linhas.push('campos do corpo em POST  (* = obrigatório)')
    linhas.push(...alinhar(campos))
    linhas.push('')

    const deps = dependenciasDe(modulo.criar)
    if (deps.length) {
      linhas.push('  regras entre campos')
      linhas.push(...deps.map(d => '    ' + d))
      linhas.push('')
    }

    linhas.push('  campo fora desta lista é RECUSADO pelo servidor (400, com sugestão do')
    linhas.push('  nome mais parecido): o módulo usa o validador estrito.')
    linhas.push('')
  }

  const camposPut = camposDe(modulo.atualizar)
  if (camposPut.length) {
    // A diferenca entre POST e PUT neste modulo nao e a LISTA de campos, e sim a
    // OBRIGATORIEDADE de um deles: `equipamento_id` deixa de ser exigido no PUT.
    // Renderizar so "os mesmos do POST" esconderia exatamente isso.
    const novos = camposPut
      .filter(c => !campos.some(k => k.nome === c.nome))
      .map(c => c.nome + (c.obrigatorio ? '*' : ''))
    const mudaram = camposPut
      .filter(c => {
        const igual = campos.find(k => k.nome === c.nome)
        return igual && igual.obrigatorio !== c.obrigatorio
      })
      .map(c => `${c.nome} (${c.obrigatorio ? 'passa a ser obrigatório' : 'deixa de ser obrigatório'})`)

    linhas.push('campos do corpo em PUT')
    linhas.push(`  os mesmos do POST${novos.length ? ', mais: ' + novos.join(', ') : ''}` +
      `${mudaram.length ? '; exceto ' + mudaram.join(', ') : ''}`)
    // Ate 2026-09-05 esta linha terminava em "campo omitido volta ao default do
    // schema", e desde a saida dos defaults do equipamento (achado S3-05) isso
    // deixou de ser verdade ali: sem default, a chave ausente nao viaja e o
    // servidor preserva a coluna. O que continua valendo em TODO recurso e a
    // instrucao, e nao o mecanismo; o que o omitido faz e dito logo abaixo, e so
    // onde houver default.
    linhas.push('  o PUT SUBSTITUI a linha: mande o corpo INTEIRO, lido de volta.')

    const defaults = camposComDefault(modulo.atualizar)
    if (defaults.length) {
      linhas.push(
        '  ATENÇÃO, campos com default: omitir grava o default, e não "deixa como está" -> ' +
        defaults.map(d => `${d.nome}=${formatarValor(d.valor)}`).join(', ')
      )
    }
    linhas.push('  Prefira os verbos que leem o registro e reenviam o corpo inteiro.')
    linhas.push('')
  }

  const regras = REGRAS[chave]
  if (regras && regras.length) {
    linhas.push('regras de negócio')
    linhas.push(...regras.map(r => '  ' + r))
    linhas.push('')
  }

  if (recurso.verbos && recurso.verbos.length) {
    linhas.push('comandos')
    linhas.push(...recurso.verbos.map(v => '  ' + v))
    linhas.push('')
  }

  return linhas.join('\n')
}

/** Indice curto de todos os recursos, para o `equipamento schema` sem argumento. */
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
 * { ok, valor, erros[], descartados[], preenchidos[] }.
 *
 * `preenchidos` sao os campos que o Joi ACRESCENTOU ao corpo por causa de um
 * `.default()`. Eles nao sao erro, e por isso nao barram nada, mas quem monta um
 * PUT precisa ve-los: sao exatamente os campos que "voltaram ao default" sem
 * ninguem ter digitado.
 *
 * `descartados` sao chaves que sumiram do corpo validado por `.strip()` do
 * proprio schema. Nome FORA do schema nao cai aqui: ele vira erro, porque o
 * servidor do equipamento o recusa com 400.
 */
function validarCorpo (schemaJoi, corpo) {
  if (!schemaJoi || typeof schemaJoi.validate !== 'function') {
    return { ok: true, valor: corpo, erros: [], descartados: [], preenchidos: [] }
  }

  const { error, value } = schemaJoi.validate(corpo, OPCOES_CORPO)

  const enviadas = Object.keys(corpo && typeof corpo === 'object' ? corpo : {})
  const mantidas = new Set(Object.keys(value && typeof value === 'object' ? value : {}))
  const descartados = enviadas.filter(k => !mantidas.has(k))
  const preenchidos = camposComDefault(schemaJoi)
    .filter(d => !enviadas.includes(d.nome))
    .map(d => `${d.nome}=${formatarValor(d.valor)}`)

  if (!error) {
    return { ok: true, valor: value, erros: [], descartados, preenchidos }
  }

  const erros = error.details.map(d => ({
    campo: d.path.join('.') || '(corpo)',
    mensagem: d.message
  }))
  return { ok: false, valor: value, erros, descartados, preenchidos }
}

/**
 * Mensagem de erro que ENSINA: alem do que falhou, imprime a linha de contrato
 * exatamente dos campos que falharam. Evita que o agente tenha que reler o
 * contrato inteiro para consertar uma virgula.
 */
function explicarErro (schemaJoi, erros, dica) {
  const linhas = ['Corpo inválido (validado localmente, nada foi enviado):', '']
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
  linhas.push(dica || 'contrato completo: equipamento schema <recurso>')
  return linhas.join('\n')
}

module.exports = {
  contrato,
  indice,
  camposDe,
  camposComDefault,
  camposDataDe,
  soData,
  filtrosDe,
  dependenciasDe,
  descreverCampo,
  tipoDe,
  sufixoValores,
  alinhar,
  formatarValor,
  validarCorpo,
  explicarErro,
  OPCOES_CORPO,
  OPCOES_QUERY
}
