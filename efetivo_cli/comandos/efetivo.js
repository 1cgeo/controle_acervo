'use strict'

// `efetivo mapa`, `efetivo mes`, `efetivo periodos ...`, `efetivo impedimentos ...`
//
//   efetivo mapa --ano 2026
//   efetivo mes  --ano 2026 --mes 7
//   efetivo periodos [--ano 2026]
//   efetivo periodos criar   --data '{"usuario_uuid": "U", "data_inicio": "2026-01-05"}'
//   efetivo periodos editar  --id 12 --data '{"data_inicio": "2026-01-05"}'
//   efetivo periodos excluir --id 12 --confirmar 12
//   efetivo impedimentos ...   (as mesmas quatro formas)
//
// O aproveitamento do efetivo e INTERVALO: a passagem pela DGEO e o impedimento
// sao periodos com inicio e fim, e mes, semana e ano sao CONSULTA sobre eles
// (`mapa` e `mes`). Por isso nao ha verbo de "lancar o mes": lancar o mes seria
// gravar uma conta, e o que se grava aqui e o fato.
//
// Contrato lido do Joi vivo de server/src/efetivo/efetivo_schema.js, como no
// resto do CLI. Nenhum campo, obrigatoriedade ou limite e copiado para ca.

const fs = require('fs')

const { obter, obterOperacao, montarCaminho } = require('../lib/recursos')
const esquema = require('../lib/schema')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')

// Flags do proprio CLI, que nunca viram filtro de query.
const FLAGS_CLI = new Set([
  'campos', 'formato', 'json', 'server', 'user', 'senha', 'token', 'cliente',
  'insecure', 'sem-cache', 'dry-run', 'data', 'data-file', 'confirmar', 'id'
])

const SUBVERBOS = new Set(['criar', 'editar', 'excluir'])

/**
 * O RECURSO de um comando: `meu` tem o seu, e o resto cai em `efetivo`.
 *
 * Eles nao sao o mesmo recurso porque nao tem o mesmo ACESSO: em `efetivo` ler
 * pede consulta e escrever pede gerente no modulo; em `meu` basta ter acesso a
 * algum modulo, porque declarar o proprio impedimento e obrigacao de quem esta
 * na Divisao. Ver o comentario de `meu` em lib/recursos.js.
 */
function recursoDe (comando) {
  return comando === 'meu' ? 'meu' : 'efetivo'
}

/**
 * A chave da operacao na registry, montada do que se digitou.
 * `efetivo periodos criar` -> 'periodos criar'; `efetivo mapa` -> 'mapa'.
 *
 * `meu` TEM UM SEGMENTO A MAIS, e por isso nao cabe no caminho comum:
 *
 *   efetivo periodos criar      -> recurso `efetivo`, operacao 'periodos criar'
 *   efetivo meu periodo criar   -> recurso `meu`,     operacao 'periodo criar'
 *
 * O assunto (`aproveitamento`, `periodo`, `impedimento`) e o primeiro segmento
 * depois de `meu`, e o subverbo e o segundo.
 */
function resolverOperacao (args) {
  const comando = args._[0]

  if (comando === 'meu') {
    const assunto = args._[1]
    const sub = args._[2]
    if (!assunto) {
      throw new Error(
        'Falta o assunto em `meu`. Use: aproveitamento, periodo, impedimento.\n' +
        'Contrato: efetivo schema meu'
      )
    }
    if (!sub) return assunto
    if (!SUBVERBOS.has(sub)) {
      throw new Error(
        `Verbo desconhecido "${sub}" em meu ${assunto}. Use: ${[...SUBVERBOS].join(', ')}.\n` +
        `Para listar: efetivo meu ${assunto}\n` +
        'Contrato: efetivo schema meu'
      )
    }
    return `${assunto} ${sub}`
  }

  const sub = args._[1]

  if (!sub) return comando

  if (!SUBVERBOS.has(sub)) {
    throw new Error(
      `Verbo desconhecido "${sub}" em ${comando}. Use: ${[...SUBVERBOS].join(', ')}.\n` +
      `Para listar: efetivo ${comando}\n` +
      'Contrato: efetivo schema efetivo'
    )
  }
  return `${comando} ${sub}`
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
function validar (schemaJoi, corpo, acao) {
  const r = esquema.validarCorpo(schemaJoi, corpo)
  const avisos = []

  if (r.descartados.length) {
    // O servidor valida com stripUnknown: chave com nome errado some sem erro e
    // a resposta e 200. Sem este aviso, "achei que gravei" e indistinguivel de
    // "gravei".
    avisos.push(
      'Campos REMOVIDOS do corpo antes do envio (o servidor tambem os descartaria, ' +
      `em silencio): ${r.descartados.join(', ')}.\n` +
      '        Confira o nome em: efetivo schema efetivo'
    )
  }

  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(
      schemaJoi, r.erros, `contrato completo: efetivo schema efetivo   (operacao ${acao})`
    ))
    erro.jaFormatado = true
    if (avisos.length) erro.avisos = avisos
    throw erro
  }

  return { corpo: r.valor, avisos }
}

/**
 * O mapa anual devolve { ano, semanas, anual }, e nao uma lista. Imprimir o JSON
 * cru disso gastaria a janela do agente com a grade semana a semana; o que
 * responde "como foi o ano" e o fechamento anual, e a grade fica no --json.
 */
function formatarMapa (dados, opcoesSaida) {
  const anual = Array.isArray(dados.anual) ? dados.anual : []
  const semanas = Array.isArray(dados.semanas) ? dados.semanas : []

  if (!anual.length) {
    return {
      texto: `Efetivo de ${dados.ano}: nenhuma passagem cadastrada no ano.`,
      avisos: []
    }
  }

  const out = saida.lista(anual, opcoesSaida)
  return {
    texto: `Efetivo de ${dados.ano}, fechamento anual\n\n${out.texto}` +
      `\n\n${semanas.length} semana(s) na grade. Para a grade inteira: --json`,
    avisos: out.avisos
  }
}

async function executar (args, cfg) {
  const flags = args.flags
  const acao = resolverOperacao(args)
  const recurso = recursoDe(args._[0])
  const { operacao } = obterOperacao(recurso, acao)
  const modulo = obter(recurso).schema()

  const opcoesSaida = {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: operacao.colunas
  }

  const avisos = []

  // ---- corpo -------------------------------------------------------------
  let corpo = null
  if (operacao.corpo) {
    const bruto = lerCorpo(flags)
    if (bruto === null) {
      throw new Error(
        `efetivo ${acao} exige --data '{...}' ou --data-file corpo.json.\n` +
        'Contrato: efetivo schema efetivo\n' +
        'Descubra o uuid da pessoa com: efetivo usuario listar'
      )
    }
    const r = validar(modulo[operacao.corpo], bruto, acao)
    corpo = r.corpo
    avisos.push(...r.avisos)
  } else if (flags.data || flags['data-file']) {
    avisos.push(`efetivo ${acao} nao leva corpo; --data foi ignorado.`)
  }

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
        `filtros aceitos: ${aceitos.join(', ')}   (contrato: efetivo schema efetivo)`,
        'Filtro de query invalido'
      ))
      erro.jaFormatado = true
      throw erro
    }
    // Filtro nao aceito vira aviso: sem isso um --mes num comando que so filtra
    // por ano sai como "listou o ano inteiro" e o agente conclui coisa errada.
    const ignoradas = Object.keys(flags).filter(f => !aceitos.includes(f) && !FLAGS_CLI.has(f))
    if (ignoradas.length) {
      avisos.push(
        `Filtros ignorados (esta operacao aceita ${aceitos.join(', ') || 'nenhum'}): ${ignoradas.join(', ')}`
      )
    }
    const enviar = {}
    for (const k of Object.keys(params)) enviar[k] = r.valor[k]
    sufixo = http.query(enviar)
  }

  // ---- caminho -----------------------------------------------------------
  const caminho = montarCaminho(operacao, { id: flags.id }) + sufixo

  // ---- dry-run (antes da confirmacao) ------------------------------------
  // Exigir --confirmar para poder OLHAR a requisicao inverte o guardrail.
  if (flags['dry-run']) {
    const linhas = [
      '[dry-run] nada foi enviado. A requisicao seria:',
      `  ${operacao.metodo} /api${caminho}   (exige ADMINISTRADOR)`
    ]
    if (corpo !== null) {
      linhas.push('  corpo (ja validado contra o schema vivo do server/):')
      linhas.push(JSON.stringify(corpo, null, 2))
    }
    return { texto: linhas.join('\n'), avisos }
  }

  // ---- confirmacao -------------------------------------------------------
  if (operacao.confirmar) {
    const esperado = String(flags.id)
    const dado = flags.confirmar === undefined || flags.confirmar === true
      ? null
      : String(flags.confirmar)

    if (dado !== esperado) {
      const erro = new Error(
        `Operacao irreversivel e nao confirmada: ${operacao.confirmar.motivo}.\n` +
        `Atinge o registro ${esperado}.\n` +
        'Para executar de fato, repita o id em --confirmar:\n' +
        `  efetivo ${acao} --id ${esperado} --confirmar ${esperado}\n` +
        'Para so ver a requisicao que sairia: acrescente --dry-run.'
      )
      erro.jaFormatado = true
      throw erro
    }
  }

  // ---- envio -------------------------------------------------------------
  const r = await http.autenticada(
    cfg, operacao.metodo, caminho, corpo !== null ? { corpo } : {}
  )

  if (acao === 'mapa') {
    const dados = r.dados || {}
    if (flags.json) return { texto: JSON.stringify(dados, null, 2), avisos }
    const out = formatarMapa(dados, opcoesSaida)
    return { texto: out.texto, avisos: [...avisos, ...out.avisos] }
  }

  if (operacao.envelope === 'mensagem' || r.dados === undefined || r.dados === null) {
    return { texto: r.message || 'ok', avisos }
  }

  if (operacao.envelope === 'lista' || Array.isArray(r.dados)) {
    const out = saida.lista(r.dados, opcoesSaida)
    return { texto: out.texto, avisos: [...avisos, ...out.avisos] }
  }

  return { texto: saida.registro(r.dados, { ...opcoesSaida, padrao: null }), avisos }
}

/**
 * Errar o nome do verbo e conhecimento local e nao pode exigir SCA_URL, como no
 * resto do CLI. O --dry-run das escritas idem: elas validam o corpo contra o Joi
 * sem tocar a rede.
 */
function precisaServidor (args) {
  let acao
  try {
    acao = resolverOperacao(args)
    obterOperacao(recursoDe(args._[0]), acao)
  } catch (e) {
    return false
  }
  if (args.flags['dry-run'] === true) return false
  return true
}

module.exports = { executar, precisaServidor, resolverOperacao, recursoDe, formatarMapa }
