'use strict'

// CRUD generico sobre a registry de recursos da mapoteca:
//   mapoteca <recurso> listar    [--campos a,b] [--formato tsv|tabela|json]
//   mapoteca <recurso> obter     --id 42
//   mapoteca <recurso> criar     --data '{...}' | --data-file corpo.json  [--dry-run]
//   mapoteca <recurso> atualizar --id 42 --data '{...}'                   [--dry-run]
//   mapoteca <recurso> deletar   --ids 42,43 --confirmar 42,43            [--dry-run]
//
// Quatro decisoes que valem explicar:
//
// 1. O corpo e validado LOCALMENTE contra o Joi antes de sair da maquina. Um
//    corpo torto falha em milissegundos, com o contrato do campo errado impresso
//    junto, em vez de custar um round-trip e um 400 generico.
//
// 2. O servidor valida o corpo com stripUnknown, ou seja, campo com nome errado
//    e DESCARTADO em silencio. Aqui isso vira aviso explicito: e a diferenca
//    entre "gravei" e "achei que gravei".
//
// 3. O PUT da mapoteca SUBSTITUI a linha inteira e leva o id no CORPO, nao na
//    URL. Mandar so o campo que mudou zera todos os outros, calado. O CLI avisa
//    exatamente quais campos voltariam ao default antes de enviar.
//
// 4. O DELETE e sempre em LOTE (array de ids no corpo) e e irreversivel: excluir
//    um pedido leva junto todos os itens dele. Por isso exige --confirmar com a
//    mesma lista de ids repetida. O guardrail de acao irreversivel precisa morar
//    na INTERFACE, nao na skill que a chama: skill e de um cliente so, a
//    interface serve todos.

const fs = require('fs')

const { obter, RECURSOS } = require('../lib/recursos')
const esquema = require('../lib/schema')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')

// Flags que nunca sao filtro de listagem: nao entram na query e nao viram aviso
// de "filtro ignorado".
const FLAGS_GLOBAIS = [
  'campos', 'formato', 'json', 'server', 'user', 'senha', 'token',
  'insecure', 'sem-cache', 'dry-run', 'id', 'ids', 'confirmar', 'data',
  'data-file', 'ajuda', 'help'
]

function lerCorpo (flags) {
  if (flags.data && flags['data-file']) {
    throw new Error('Use --data OU --data-file, nunca os dois.')
  }
  if (flags['data-file']) {
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

/** Valida contra o Joi da acao e devolve o corpo normalizado, ou lanca com o contrato junto. */
function validar (modulo, acao, corpo, chave) {
  const schemaJoi = acao === 'criar' ? modulo.criar : modulo.atualizar
  if (!schemaJoi) return { corpo, avisos: [] }

  const r = esquema.validarCorpo(schemaJoi, corpo)
  const avisos = []

  if (r.descartados.length) {
    avisos.push(
      'Campos REMOVIDOS do corpo antes do envio (o servidor tambem os descartaria, ' +
      `em silencio): ${r.descartados.join(', ')}.\n` +
      `        Causa: nome fora do schema de ${chave}. Confira em: mapoteca schema ${chave}`
    )
  }

  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(
      schemaJoi, r.erros, `contrato completo: mapoteca schema ${chave}`
    ))
    erro.jaFormatado = true
    if (avisos.length) erro.avisos = avisos
    throw erro
  }

  return { corpo: r.valor, avisos }
}

/**
 * Lista os campos opcionais que o PUT vai zerar por omissao. E a armadilha mais
 * cara deste CRUD: o servidor monta o UPDATE com um ColumnSet de default null,
 * entao campo ausente do corpo vira NULL na linha, sem erro nenhum.
 */
function camposQueSeriamZerados (modulo, corpo) {
  const enviados = new Set(Object.keys(corpo || {}))
  return esquema.camposDe(modulo.criar)
    .filter(c => !c.obrigatorio && !enviados.has(c.nome))
    .map(c => c.nome)
}

async function executar (args, cfg) {
  const chave = args._[0]
  const acao = args._[1] || 'listar'
  const recurso = obter(chave)
  const flags = args.flags
  const modulo = recurso.schema()

  const opcoesSaida = {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: recurso.colunas
  }

  switch (acao) {
    // -----------------------------------------------------------------------
    case 'listar': {
      if (recurso.semListar) {
        throw new Error(
          `Nao existe listagem de ${chave} na API: os itens so aparecem dentro de um ` +
          'pedido. Use: mapoteca pedido itens --id <id do pedido>'
        )
      }

      // Filtros derivados do proprio schema de query: se o backend ganhar um
      // filtro novo, ele aparece aqui sem tocar no CLI.
      const aceitos = esquema.filtrosDe(modulo).map(f => f.nome)
      const params = {}
      for (const nome of aceitos) {
        if (flags[nome] !== undefined && flags[nome] !== true) params[nome] = flags[nome]
      }

      const ignoradas = Object.keys(flags).filter(
        f => !aceitos.includes(f) && !FLAGS_GLOBAIS.includes(f)
      )
      const avisos = ignoradas.length
        ? [`Filtros ignorados (este recurso aceita ${aceitos.join(', ') || 'nenhum'}): ${ignoradas.join(', ')}`]
        : []

      const r = await http.autenticada(cfg, 'GET', recurso.caminho + http.query(params))
      const out = saida.lista(r.dados, opcoesSaida)
      return { texto: out.texto, avisos: [...avisos, ...out.avisos] }
    }

    // -----------------------------------------------------------------------
    case 'obter': {
      if (recurso.semListar) {
        throw new Error(
          `Nao existe GET por id de ${chave}. Use: mapoteca pedido itens --id <id do pedido>`
        )
      }
      const id = argsLib.exigir(flags, 'id', `id do registro de ${chave}`)
      const r = await http.autenticada(cfg, 'GET', `${recurso.caminho}/${encodeURIComponent(id)}`)
      return { texto: saida.registro(r.dados, opcoesSaida) }
    }

    // -----------------------------------------------------------------------
    case 'criar':
    case 'atualizar': {
      const bruto = lerCorpo(flags)
      if (!bruto || typeof bruto !== 'object') {
        throw new Error(
          `${acao} exige --data '{...}' ou --data-file corpo.json (um objeto JSON). ` +
          `Contrato: mapoteca schema ${chave}`
        )
      }

      const avisosExtra = []
      const corpoBruto = { ...bruto }

      if (acao === 'atualizar') {
        // O id vai no CORPO. Aceitar tambem --id e conveniencia, nao alternativa:
        // quem passa os dois com valores diferentes tem um erro que precisa ver.
        const idFlag = flags.id !== undefined && flags.id !== true ? Number(flags.id) : null
        if (idFlag !== null && corpoBruto.id !== undefined && Number(corpoBruto.id) !== idFlag) {
          throw new Error(
            `--id ${idFlag} nao bate com o "id": ${corpoBruto.id} do corpo. ` +
            'Na mapoteca o id do PUT vai no corpo; deixe so um dos dois.'
          )
        }
        if (corpoBruto.id === undefined && idFlag !== null) corpoBruto.id = idFlag

        const zerados = camposQueSeriamZerados(modulo, corpoBruto)
        if (zerados.length) {
          avisosExtra.push(
            'O PUT da mapoteca SUBSTITUI a linha inteira. Estes campos nao vieram no ' +
            `corpo e voltariam ao default (em geral null): ${zerados.join(', ')}.\n` +
            `        Se a intencao era mudar so um campo, leia o registro antes ` +
            `(mapoteca ${chave} obter --id ${corpoBruto.id} --json) e reenvie o corpo completo.`
          )
        }
      }

      const { corpo, avisos } = validar(modulo, acao, corpoBruto, chave)
      const metodo = acao === 'atualizar' ? 'PUT' : 'POST'
      const todosAvisos = [...avisosExtra, ...avisos]

      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado. A requisicao seria:',
            `  ${metodo} /api${recurso.caminho}`,
            '  corpo (ja validado contra o schema vivo do server/):',
            JSON.stringify(corpo, null, 2)
          ].join('\n'),
          avisos: todosAvisos
        }
      }

      const r = await http.autenticada(cfg, metodo, recurso.caminho, { corpo })
      const texto = r.dados && typeof r.dados === 'object' && Object.keys(r.dados).length
        ? `${r.message || 'ok'}\n${saida.registro(r.dados, opcoesSaida)}`
        : (r.message || 'ok')
      return { texto, avisos: todosAvisos }
    }

    // -----------------------------------------------------------------------
    case 'deletar': {
      const ids = argsLib.lista(flags.ids) ||
        (flags.id !== undefined && flags.id !== true ? [String(flags.id)] : null)

      if (!ids || !ids.length) {
        throw new Error(
          `deletar exige --ids 42,43 (o DELETE da mapoteca e sempre em lote: o corpo e ` +
          `{"${recurso.chaveIds}": [...]}).`
        )
      }

      const numeros = ids.map(v => {
        const n = Number(v)
        if (!Number.isInteger(n)) throw new Error(`id invalido em --ids: "${v}".`)
        return n
      })

      const corpo = { [recurso.chaveIds]: numeros }

      // O --dry-run nao escreve, entao ele NAO exige a confirmacao: e ele que
      // mostra o que a confirmacao autorizaria. Cobrar --confirmar aqui
      // desmentia a propria mensagem de erro, que manda usar --dry-run antes.
      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado. Seria:',
            `  DELETE /api${recurso.caminho}`,
            JSON.stringify(corpo, null, 2),
            '',
            'Para excluir de fato:',
            `  mapoteca ${chave} deletar --ids ${numeros.join(',')} --confirmar ${numeros.join(',')}`
          ].join('\n')
        }
      }

      // Guardrail de acao irreversivel na propria interface. A confirmacao repete
      // a lista inteira: confirmar "42" quando se pediu "42,43" e exatamente o
      // acidente que se quer impedir.
      const confirmacao = argsLib.lista(flags.confirmar) || []
      const bate = confirmacao.length === numeros.length &&
        confirmacao.every((v, i) => Number(v) === numeros[i])

      if (!bate) {
        const linhas = [
          `Exclusao de ${numeros.length} registro(s) de ${chave} e IRREVERSIVEL e nao foi confirmada.`
        ]
        if (chave === 'pedido') {
          linhas.push('Excluir um pedido apaga TODOS os itens dele junto.')
        }
        linhas.push(
          'Para excluir de fato, repita a mesma lista em --confirmar:',
          `  mapoteca ${chave} deletar --ids ${numeros.join(',')} --confirmar ${numeros.join(',')}`,
          'Para so ver o que aconteceria: acrescente --dry-run.'
        )
        const erro = new Error(linhas.join('\n'))
        erro.jaFormatado = true
        throw erro
      }

      const r = await http.autenticada(cfg, 'DELETE', recurso.caminho, { corpo })
      return { texto: r.message || `${numeros.length} registro(s) de ${chave} excluidos.` }
    }

    default:
      throw new Error(
        `Acao desconhecida "${acao}" para ${chave}. ` +
        'Use: listar, obter, criar, atualizar, deletar.'
      )
  }
}

/**
 * Recurso sem GET proprio (o item do pedido) nao precisa de servidor para
 * responder "essa rota nao existe": a resposta certa e o encaminhamento, e
 * exigir SCA_URL antes so trocaria o erro util por um erro de configuracao.
 */
function precisaServidor (args) {
  const recurso = RECURSOS[args._[0]]
  const acao = args._[1] || 'listar'
  if (recurso && recurso.semListar && (acao === 'listar' || acao === 'obter')) return false
  return true
}

module.exports = { executar, precisaServidor, lerCorpo, camposQueSeriamZerados }
