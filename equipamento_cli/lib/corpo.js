'use strict'

// Montagem e conferencia do corpo de uma escrita. E o unico lugar do CLI que
// transforma o que o agente digitou no JSON que sai pela rede, e ele faz isso
// SEMPRE a partir da lista de campos do Joi vivo: um campo novo no schema vira
// uma flag aceita no mesmo commit, sem tocar aqui.
//
// Tres coisas moram neste arquivo porque os quatro comandos de escrita
// (bem, tipo, historico e a ficha) precisariam das tres:
//
//   1. montar o corpo a partir de --data e de --<campo>, nessa ordem;
//   2. MESCLAR sobre o registro lido, que e o que torna seguro um PUT que
//      substitui a linha inteira;
//   3. validar contra o Joi antes de gastar a requisicao, e explicar o erro com
//      o contrato do campo errado junto.

const fs = require('fs')

const esquema = require('./schema')
const argsLib = require('./args')
const saida = require('./saida')

// Flags que nunca sao campo de corpo nem filtro: nao entram no corpo e nao viram
// aviso de "flag ignorada".
const FLAGS_GLOBAIS = [
  'campos', 'formato', 'json', 'server', 'user', 'senha', 'token', 'cliente',
  'insecure', 'sem-cache', 'dry-run', 'ajuda', 'help',
  'id', 'confirmar', 'data', 'data-file', 'patrimonio', 'para'
]

/** Le o corpo passado como JSON inteiro, por --data ou --data-file. */
function lerData (flags) {
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

/**
 * Traduz o valor cru de uma flag para o valor que vai no corpo.
 *
 * O token `null` vira NULO de verdade, e isso e necessario, nao acessorio: como
 * o PUT substitui a linha, limpar um campo (reabrir um lancamento fechado,
 * apagar uma previsao que nao se cumpriu) so tem esta porta na linha de comando.
 * A forma sem ambiguidade continua sendo --data '{"campo": null}'.
 */
function valorDeCampo (bruto, tipo) {
  const v = argsLib.valorDeFlag(bruto, tipo)
  if (v === undefined) return undefined
  if (typeof v === 'string' && v.toLowerCase() === 'null') return null
  return v
}

/**
 * Monta o corpo de uma escrita.
 *
 * Ordem de precedencia, da mais fraca para a mais forte:
 *   base (o registro lido de volta) < --data / --data-file < --<campo>
 *
 * @param {object} schemaJoi schema da acao (criar ou atualizar)
 * @param {object} flags
 * @param {object|null} base registro ja recortado aos campos do schema
 * @returns {{corpo: object, mudou: string[], avisos: string[]}}
 */
function montarCorpo (schemaJoi, flags, base = null) {
  const campos = esquema.camposDe(schemaJoi)
  const nomes = campos.map(c => c.nome)
  const corpo = base ? { ...base } : {}
  const avisos = []
  const mudou = []

  const doData = lerData(flags)
  if (doData) {
    if (typeof doData !== 'object' || Array.isArray(doData)) {
      throw new Error('--data precisa ser um objeto JSON.')
    }
    for (const [chave, valor] of Object.entries(doData)) {
      corpo[chave] = valor
      mudou.push(chave)
    }
  }

  for (const campo of campos) {
    const bruto = flags[campo.nome]
    if (bruto === undefined) continue
    const valor = valorDeCampo(bruto, campo.tipo)
    if (valor === undefined) {
      // Flag de campo nao booleano que veio sem valor. Deixar passar em silencio
      // faria a alteracao que o agente pediu simplesmente nao acontecer.
      avisos.push(
        `--${campo.nome} veio sem valor e foi ignorada (o campo é ${campo.tipo}). ` +
        `Use --${campo.nome} <valor>, ou --${campo.nome} null para limpá-lo.`
      )
      continue
    }
    corpo[campo.nome] = valor
    mudou.push(campo.nome)
  }

  // Flag que nao e campo nem global: quase sempre e nome errado, e sem este
  // aviso ela some sem gravar nada. E o modo de falha registrado como "a
  // ferramenta disse OK e nada foi gravado".
  const desconhecidas = Object.keys(flags).filter(
    f => !nomes.includes(f) && !FLAGS_GLOBAIS.includes(f)
  )
  if (desconhecidas.length) {
    avisos.push(
      `Flags ignoradas (não são campos deste recurso): ${desconhecidas.join(', ')}. ` +
      `Campos aceitos: ${nomes.join(', ')}.`
    )
  }

  return { corpo, mudou: [...new Set(mudou)], avisos }
}

/**
 * Recorta um registro lido de volta para os campos que o schema aceita.
 *
 * As duas coisas que ele faz sao as duas que fariam o PUT falhar sem elas:
 *
 *   1. TIRA as colunas que a leitura acrescenta e o corpo nao aceita
 *      (nr_patrimonio e modelo do bem numa lista de historico, o nome resolvido
 *      dos dominios). O validador do modulo e estrito: mandar uma delas de volta
 *      volta 400.
 *   2. RECORTA as datas de timestamp ISO para 'AAAA-MM-DD', porque o schema as
 *      regrava cruas numa coluna DATE.
 *
 * Devolve tambem os campos do schema que o registro NAO trouxe e que tem
 * default: eles seriam preenchidos pelo Joi sem ninguem digitar, e num PUT isso
 * REVERTE o valor gravado. Aparecem como aviso, nunca em silencio.
 *
 * @returns {{base: object, ausentesComDefault: string[]}}
 */
function recortar (schemaJoi, registro) {
  const campos = esquema.camposDe(schemaJoi)
  const datas = new Set(esquema.camposDataDe(schemaJoi))
  const defaults = esquema.camposComDefault(schemaJoi)

  const base = {}
  const ausentesComDefault = []

  for (const campo of campos) {
    if (registro && Object.prototype.hasOwnProperty.call(registro, campo.nome)) {
      const valor = registro[campo.nome]
      base[campo.nome] = datas.has(campo.nome) ? esquema.soData(valor) : valor
      continue
    }
    const comDefault = defaults.find(d => d.nome === campo.nome)
    if (comDefault) {
      ausentesComDefault.push(`${campo.nome}=${esquema.formatarValor(comDefault.valor)}`)
    }
  }

  return { base, ausentesComDefault }
}

/**
 * Valida o corpo contra o Joi da acao e devolve o corpo ja normalizado, ou lanca
 * um erro com o contrato do campo errado junto.
 *
 * `avisosAnteriores` sao os que a MONTAGEM ja produziu (flag ignorada, flag sem
 * valor). Eles precisam entrar aqui porque a validacao pode lancar, e um aviso
 * perdido no caminho de erro e justamente o que explicaria o erro: quem digitou
 * `--modelos` em vez de `--modelo` recebe "modelo é obrigatório" e a razao some.
 */
function validar (schemaJoi, corpo, chave, avisosAnteriores = []) {
  if (!schemaJoi) return { corpo, avisos: [...avisosAnteriores] }

  const r = esquema.validarCorpo(schemaJoi, corpo)
  const avisos = [...avisosAnteriores]

  if (r.descartados.length) {
    avisos.push(
      'Campos REMOVIDOS do corpo antes do envio por regra do schema (o servidor ' +
      `faria o mesmo): ${r.descartados.join(', ')}.`
    )
  }
  if (r.preenchidos.length) {
    // Default NAO e ausencia: ele grava. Num POST isso e o comportamento
    // esperado; num PUT e o que reverte o campo que ninguem mencionou.
    avisos.push(
      `Campos preenchidos pelo default do schema (ninguém os digitou, e eles VÃO ` +
      `ao banco): ${r.preenchidos.join(', ')}.`
    )
  }

  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(
      schemaJoi, r.erros, `contrato completo: equipamento schema ${chave}`
    ))
    erro.jaFormatado = true
    erro.avisos = avisos
    throw erro
  }

  return { corpo: r.valor, avisos }
}

/**
 * Filtros de listagem lidos do proprio schema de query do recurso, com aviso
 * para toda flag que nao e filtro nem global.
 */
function montarFiltros (modulo, flags) {
  const aceitos = esquema.filtrosDe(modulo)
  const params = {}

  for (const filtro of aceitos) {
    const valor = argsLib.valorDeFlag(flags[filtro.nome], filtro.tipo)
    if (valor !== undefined) params[filtro.nome] = valor
  }

  const nomes = aceitos.map(f => f.nome)
  const ignoradas = Object.keys(flags).filter(
    f => !nomes.includes(f) && !FLAGS_GLOBAIS.includes(f)
  )
  const avisos = ignoradas.length
    ? [`Filtros ignorados (este recurso aceita ${nomes.join(', ') || 'nenhum'}): ${ignoradas.join(', ')}`]
    : []

  return { params, avisos }
}

/**
 * Uma linha por campo que MUDA, com o antes e o depois.
 *
 * E o que separa "reenviei o corpo inteiro" de "reenviei o corpo inteiro e sei o
 * que isso altera". Num PUT que substitui a linha, o campo que volta ao default
 * aparece aqui como mudanca, e e exatamente o que se quer ver antes de gravar.
 */
function resumoMudancas (base, corpo) {
  const linhas = []
  for (const [chave, depois] of Object.entries(corpo)) {
    const antes = base ? base[chave] : undefined
    if (JSON.stringify(antes) === JSON.stringify(depois)) continue
    linhas.push(`  ${chave}: ${saida.celula(chave, antes)} -> ${saida.celula(chave, depois)}`)
  }
  return linhas
}

/**
 * Leva os avisos ja acumulados para dentro do erro, quando a escrita falha.
 *
 * Sem isto, o caminho de erro perde exatamente o aviso que explica o erro: quem
 * levou 400 por um campo que o default preencheu, ou por uma flag ignorada, veria
 * so a mensagem do servidor, sem a linha que diz de onde aquele valor saiu.
 */
async function comAvisos (promessa, avisos) {
  try {
    return await promessa
  } catch (err) {
    err.avisos = [...(avisos || []), ...(err.avisos || [])]
    throw err
  }
}

/** Guardrail de acao irreversivel, na propria interface. */
function exigirConfirmacao (flags, id, comando) {
  if (String(flags.confirmar) !== String(id)) {
    throw new Error(
      'Exclusão é irreversível e não foi confirmada.\n' +
      'Para excluir de fato, repita o id em --confirmar:\n' +
      `  ${comando} --id ${id} --confirmar ${id}\n` +
      'Para só ver o que aconteceria: acrescente --dry-run.'
    )
  }
}

module.exports = {
  FLAGS_GLOBAIS,
  lerData,
  montarCorpo,
  recortar,
  validar,
  montarFiltros,
  resumoMudancas,
  comAvisos,
  exigirConfirmacao,
  valorDeCampo
}
