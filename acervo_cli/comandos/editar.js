// Path: comandos\editar.js
'use strict'

// `acervo editar <versao|produto|arquivo> --id N --set campo=valor`
//
//   acervo editar versao --id 7244 --set data_edicao=2019-05-01 --dry-run
//   acervo editar versao --id 7244 --set data_edicao=2019-05-01 --confirmar 7244
//   acervo editar arquivo --id 9001 --produto 4211 --set tipo_arquivo_id=2 --dry-run
//
// Este e o verbo que existe por causa de um modo de falha real, nao por
// conveniencia. Todo PUT do SCA sobrescreve o OBJETO INTEIRO: o controller monta
// um UPDATE com a lista fixa de colunas. Quem quer mudar um campo tem que ler o
// registro, trocar o campo e devolver o registro completo. Fazer isso a mao
// erra de tres jeitos, e os tres ja custaram correcao em producao:
//
//   1. mandar so o campo que mudou -> 400 nos obrigatorios, ou pior, o servidor
//      grava o DEFAULT do schema nos que tem default (subtipo_produto_id vira
//      null, palavras_chave vira []), em silencio;
//   2. copiar o GET direto para o PUT -> o GET de versao chama o campo de
//      nome_versao e o PUT espera nome;
//   3. copiar o GET de produto direto para o PUT -> o GET NAO devolve
//      subtipo_produto_id, e o PUT o grava como null, apagando a identidade do
//      produto (a Carta Militar deixa de ser militar).
//
// O CLI le, casa os nomes, aplica so o que voce pediu, RECUSA quando um campo
// com default nao veio da leitura (o caso 3), valida contra o Joi vivo e mostra
// o diff antes de mandar. E exige --confirmar com o id, porque isto escreve num
// acervo de producao.

const http = require('../lib/http')
const esquema = require('../lib/schema')
const argsLib = require('../lib/args')
const { RAIZ_SERVER } = require('../lib/recursos')

const path = require('path')

// Como ler a base de cada entidade e como casa-la com o schema do PUT. O
// `renomear` existe porque o SELECT da rota de leitura usa alias que o schema do
// PUT nao conhece; `descartar` tira o que o stripUnknown removeria (e que so
// geraria aviso a toa).
const ALVOS = {
  versao: {
    rota: '/produtos/versao',
    schema: () => require(path.join(RAIZ_SERVER, 'produto', 'produto_schema')).versaoAtualizacao,
    ler: async (cfg, id) => {
      const r = await http.autenticada(cfg, 'GET', `/acervo/versao/${encodeURIComponent(id)}`)
      return r.dados
    },
    renomear: { nome_versao: 'nome' },
    descartar: ['produto_id']
  },

  produto: {
    rota: '/produtos/produto',
    schema: () => require(path.join(RAIZ_SERVER, 'produto', 'produto_schema')).produtoAtualizacao,
    ler: async (cfg, id) => {
      const r = await http.autenticada(cfg, 'GET', `/acervo/produto/${encodeURIComponent(id)}`)
      return r.dados
    },
    renomear: {},
    descartar: []
  },

  arquivo: {
    rota: '/arquivo/arquivo',
    schema: () => require(path.join(RAIZ_SERVER, 'arquivo', 'arquivo_schema')).arquivoAtualizacao,
    // Nao ha rota que devolva UM arquivo: os arquivos so aparecem dentro do
    // detalhado do produto. Por isso o --produto e obrigatorio aqui.
    ler: async (cfg, id, flags) => {
      const produtoId = argsLib.exigir(
        flags, 'produto',
        'id do produto dono do arquivo; nao ha rota que devolva um arquivo isolado'
      )
      const r = await http.autenticada(cfg, 'GET', `/acervo/produto/detalhado/${encodeURIComponent(produtoId)}`)
      for (const v of (r.dados && r.dados.versoes) || []) {
        for (const a of v.arquivos || []) {
          if (Number(a.id) === Number(id)) return a
        }
      }
      throw new Error(
        `Arquivo ${id} nao esta no produto ${produtoId}. ` +
        'Confira o produto com: acervo produto --id <produto> --arquivos'
      )
    },
    renomear: {},
    // O detalhado devolve mais colunas do que o PUT aceita (uuid, checksum,
    // tamanho, auditoria). Elas caem no stripUnknown e viram nota, nao erro:
    // sao colunas de leitura, nao campos editaveis.
    descartar: []
  }
}

/** "campo=valor" -> [campo, valor], com o valor lido como JSON quando possivel. */
function parSet (texto) {
  const igual = String(texto).indexOf('=')
  if (igual === -1) {
    throw new Error(`--set espera campo=valor (recebi "${texto}").`)
  }
  const campo = texto.slice(0, igual).trim()
  const bruto = texto.slice(igual + 1)
  let valor
  try {
    // JSON primeiro: e o que faz 24 virar numero (os ids sao .strict(), string
    // nao passa), null virar null e ["a","b"] virar array.
    valor = JSON.parse(bruto)
  } catch (e) {
    valor = bruto
  }
  return [campo, valor]
}

function iguais (a, b) {
  if (a === b) return true
  if (a instanceof Date || b instanceof Date) {
    return new Date(a).getTime() === new Date(b).getTime()
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

function mostrar (v) {
  if (v === undefined) return '(ausente)'
  if (v === null) return 'null'
  // O Joi converte data para Date; sem tratar isso, o diff imprimiria os dois
  // lados em formatos diferentes e pareceria mudar mais do que muda.
  const texto = v instanceof Date ? v.toISOString() : (typeof v === 'object' ? JSON.stringify(v) : String(v))
  const iso = texto.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/)
  return iso ? iso[1] : texto
}

async function executar (args, cfg) {
  const flags = args.flags
  const tipo = args._[1]
  const alvo = ALVOS[tipo]

  if (!alvo) {
    throw new Error(
      `acervo editar <versao|produto|arquivo> --id N --set campo=valor\n` +
      `Recebi "${tipo || '(nada)'}".`
    )
  }

  const id = argsLib.exigir(flags, 'id', `id do registro de ${tipo}`)

  const mudancas = {}
  for (const par of argsLib.repetida(flags, 'set')) {
    const [campo, valor] = parSet(par)
    mudancas[campo] = valor
  }
  if (flags.data && flags.data !== true) {
    try {
      Object.assign(mudancas, JSON.parse(flags.data))
    } catch (e) {
      throw new Error(`--data nao e JSON valido: ${e.message}`)
    }
  }
  if (!Object.keys(mudancas).length) {
    throw new Error(
      `Nada a mudar. Diga o que muda com --set campo=valor (repetivel) ou --data '{...}'.\n` +
      `Campos: acervo schema ${tipo === 'arquivo' ? 'arquivo' : 'produtos'}`
    )
  }

  // ---- 1. ler a base -----------------------------------------------------
  const bruto = await alvo.ler(cfg, id, flags)
  const base = {}
  for (const [k, v] of Object.entries(bruto || {})) {
    if (alvo.descartar.includes(k)) continue
    base[alvo.renomear[k] || k] = v
  }
  base.id = Number(id)

  const schemaJoi = alvo.schema()

  // Desfaz a stringificacao do driver nos campos numericos `.strict()`. Coluna
  // BIGINT volta como STRING no JSON (ela nao cabe no numero do JavaScript sem
  // risco), entao `lote_id` lido do proprio servidor chega "107" e o PUT o
  // recusa. Vale SO para o que veio da leitura: string que o usuario digitou em
  // --set continua sendo erro dele, e o Joi vai dizer isso.
  for (const campo of esquema.numerosStrict(schemaJoi)) {
    const v = base[campo]
    if (typeof v === 'string' && /^-?\d+$/.test(v)) base[campo] = Number(v)
  }

  // ---- 2. o guardrail do default silencioso ------------------------------
  const ausentes = esquema.defaultsAusentes(schemaJoi, base)
    .filter(a => !(a.campo in mudancas))

  if (ausentes.length) {
    // Este e o caso 3 do cabecalho. Recusar e o ponto: seguir em frente
    // gravaria o default por cima do valor real, e ninguem veria.
    throw Object.assign(new Error(
      `A leitura de ${tipo} ${id} NAO trouxe ${ausentes.length} campo(s) que o PUT ` +
      `grava com valor padrao:\n` +
      ausentes.map(a => `  ${a.campo}  -> seria gravado como ${a.padrao}`).join('\n') +
      '\n\nEnviar assim APAGARIA o valor atual desses campos, em silencio.\n' +
      'Descubra o valor de verdade e passe-o explicitamente:\n' +
      ausentes.map(a => `  --set ${a.campo}=<valor atual>`).join('\n') +
      '\n(se o valor atual for mesmo o padrao, passe-o do mesmo jeito: explicito e diferente de esquecido)'
    ), { jaFormatado: false })
  }

  // ---- 3. aplicar e validar ---------------------------------------------
  const novo = { ...base, ...mudancas }
  const r = esquema.validarCorpo(schemaJoi, novo)

  const avisos = []
  if (r.descartados.length) {
    avisos.push(
      `Campos removidos antes do envio (o servidor tambem os descartaria em silencio): ` +
      `${r.descartados.join(', ')}.`
    )
    const errados = r.descartados.filter(c => c in mudancas)
    if (errados.length) {
      throw new Error(
        `Os campos que voce pediu para mudar nao existem no contrato de ${tipo}: ${errados.join(', ')}.\n` +
        `Eles seriam descartados e a edicao nao teria efeito. Contrato: acervo schema ` +
        `${tipo === 'arquivo' ? 'arquivo' : 'produtos'}`
      )
    }
  }
  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(
      schemaJoi, r.erros,
      `contrato completo: acervo schema ${tipo === 'arquivo' ? 'arquivo' : 'produtos'}`
    ))
    erro.jaFormatado = true
    erro.avisos = avisos
    throw erro
  }

  // ---- 4. diff -----------------------------------------------------------
  const diff = []
  for (const campo of Object.keys(r.valor)) {
    if (!iguais(base[campo], r.valor[campo])) {
      diff.push(`  ${campo}: ${mostrar(base[campo])}  ->  ${mostrar(r.valor[campo])}`)
    }
  }

  if (!diff.length) {
    return {
      texto: `Nada mudaria em ${tipo} ${id}: os valores pedidos ja sao os atuais. Nada foi enviado.`,
      avisos
    }
  }

  const cabecalho = [
    `${tipo} ${id}: ${diff.length} campo(s) mudariam`,
    ...diff,
    '',
    `PUT /api${alvo.rota} com o objeto INTEIRO (${Object.keys(r.valor).length} campos).`
  ]

  if (flags['dry-run']) {
    return {
      texto: ['[dry-run] nada foi enviado.', ...cabecalho, '', JSON.stringify(r.valor, null, 2)].join('\n'),
      avisos
    }
  }

  // ---- 5. confirmacao ----------------------------------------------------
  // Escrita em acervo de producao: a confirmacao repete o id, para que confirmar
  // exija ter olhado o diff acima em vez de digitar "sim" por reflexo.
  if (String(flags.confirmar) !== String(id)) {
    throw new Error(
      [
        'Edicao em acervo de PRODUCAO, nao confirmada.',
        ...cabecalho,
        '',
        'Para gravar de fato, repita o id em --confirmar:',
        `  acervo editar ${tipo} --id ${id} ${argsLib.repetida(flags, 'set').map(s => `--set ${s}`).join(' ')} --confirmar ${id}`
      ].join('\n')
    )
  }

  const resp = await http.autenticada(cfg, 'PUT', alvo.rota, { corpo: r.valor })
  return {
    texto: [resp.message || 'atualizado', ...cabecalho].join('\n'),
    avisos
  }
}

module.exports = { executar, precisaServidor: true, ALVOS, parSet }
