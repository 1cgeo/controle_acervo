'use strict'

// CRUD generico sobre a registry de recursos:
//   orcamento <recurso> listar    [--ano 2026] [--campos a,b] [--formato tsv|tabela|json]
//   orcamento <recurso> obter     --id 42
//   orcamento <recurso> criar     --data '{...}' | --data-file corpo.json  [--dry-run]
//   orcamento <recurso> atualizar --id 42 --data '{...}'                   [--dry-run]
//   orcamento <recurso> deletar   --id 42 --confirmar <valor>              [--dry-run]
//   orcamento <recurso> anexar    --id 42 --file nota.pdf
//
// Tres decisoes que valem explicar:
//
// 1. O corpo e validado LOCALMENTE contra o Joi antes de sair da maquina. Um
//    corpo torto falha em milissegundos, com o contrato do campo errado impresso
//    junto, em vez de custar um round-trip e um 400 generico.
//
// 2. O servidor valida o corpo com stripUnknown, ou seja, campo com nome errado
//    e DESCARTADO em silencio. Aqui isso vira aviso explicito: e a diferenca
//    entre "gravei" e "achei que gravei".
//
// 3. deletar exige --confirmar com o identificador do registro. O guardrail de
//    acao irreversivel precisa morar na INTERFACE, nao na skill que a chama:
//    skill e de um cliente so, a interface serve todos.

const fs = require('fs')
const path = require('path')

const { obter, EXTENSOES_ANEXO } = require('../lib/recursos')
const esquema = require('../lib/schema')
const saida = require('../lib/saida')
const http = require('../lib/http')
const argsLib = require('../lib/args')

// A rota de anexo sai da registry, nunca escrita a mao: ela ganhou o prefixo
// /orcamento na fusao de 2026-07-27, e no SCA existe TAMBEM um /api/arquivo do
// acervo, que e outra coisa. Caminho literal aqui acertaria a rota errada.
const CAMINHO_ARQUIVO = obter('arquivo').caminho

const MIMES = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet'
}

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

/** Valida contra o Joi da acao e devolve o corpo ja normalizado, ou lanca com o contrato junto. */
function validar (modulo, acao, corpo, chave) {
  const schemaJoi = acao === 'criar' ? modulo.criar : modulo.atualizar
  if (!schemaJoi) return { corpo, avisos: [] }

  const r = esquema.validarCorpo(schemaJoi, corpo)
  const avisos = []

  if (r.descartados.length) {
    // Desde 2026-07-25 nome fora do schema e ERRO (o servidor recusa com 400 e
    // a validacao local pega antes). Entao o que sobra aqui e o descarte
    // DELIBERADO do proprio schema, por .strip(): o caso vivo e o pdr_item_id
    // de uma NC Extra-PDR, que existe no schema, e legitimo mandar, e mesmo
    // assim nao grava. Sem este aviso o agente acha que gravou.
    avisos.push(
      `Campos descartados por REGRA do schema (existem, mas nao se aplicam a este ` +
      `caso, e o servidor tambem os descartaria): ${r.descartados.join(', ')}.\n` +
      `        Nao e erro de digitacao (isso agora vira 400). Veja a condicional em: orcamento schema ${chave}`
    )
  }

  if (!r.ok) {
    const erro = new Error(esquema.explicarErro(schemaJoi, r.erros))
    erro.jaFormatado = true
    if (avisos.length) erro.avisos = avisos
    throw erro
  }

  return { corpo: r.valor, avisos }
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
      // Filtros derivados do proprio listarQuery do schema: se o backend ganhar
      // um filtro novo, ele aparece aqui sem tocar no CLI.
      const aceitos = esquema.filtrosDe(modulo).map(f => f.nome)
      const params = {}
      for (const nome of aceitos) {
        if (flags[nome] !== undefined && flags[nome] !== true) params[nome] = flags[nome]
      }

      const usados = Object.keys(flags).filter(
        f => !aceitos.includes(f) && !['campos', 'formato', 'json', 'server', 'user', 'senha', 'token', 'insecure', 'sem-cache', 'dry-run'].includes(f)
      )
      const avisos = usados.length
        ? [`Filtros ignorados (este recurso aceita ${aceitos.join(', ') || 'nenhum'}): ${usados.join(', ')}`]
        : []

      const r = await http.autenticada(cfg, 'GET', recurso.caminho + http.query(params))
      const out = saida.lista(r.dados, opcoesSaida)
      return { texto: out.texto, avisos: [...avisos, ...out.avisos] }
    }

    // -----------------------------------------------------------------------
    case 'obter': {
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
          `Contrato: orcamento schema ${chave}`
        )
      }

      const { corpo, avisos } = validar(modulo, acao, bruto, chave)

      let caminho = recurso.caminho
      let metodo = 'POST'
      if (acao === 'atualizar') {
        metodo = 'PUT'
        if (!recurso.singleton) {
          const id = argsLib.exigir(flags, 'id', `id do registro de ${chave} a atualizar`)
          caminho = `${recurso.caminho}/${encodeURIComponent(id)}`
        }
      }

      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado. A requisicao seria:',
            `  ${metodo} /api${caminho}`,
            '  corpo (ja validado contra o schema):',
            JSON.stringify(corpo, null, 2)
          ].join('\n'),
          avisos
        }
      }

      const r = await http.autenticada(cfg, metodo, caminho, { corpo })
      const texto = r.dados && typeof r.dados === 'object'
        ? `${r.message || 'ok'}\n${saida.registro(r.dados, opcoesSaida)}`
        : (r.message || 'ok')
      return { texto, avisos }
    }

    // -----------------------------------------------------------------------
    // Verbo de intencao: cria o registro E anexa o documento numa invocacao so.
    // Sem ele, lancar uma NC com o PDF sao duas execucoes e um id que o agente
    // precisa ler do stdout da primeira para montar a segunda.
    case 'lancar': {
      const vinculo = recurso.anexo
      if (!vinculo) {
        throw new Error(
          `lancar (criar + anexar) so existe para recursos com anexo: nc, dfd, pdr. ` +
          `Para ${chave}, use: orcamento ${chave} criar --data '{...}'`
        )
      }

      const bruto = lerCorpo(flags)
      if (!bruto || typeof bruto !== 'object') {
        throw new Error(`lancar exige --data '{...}' ou --data-file. Contrato: orcamento schema ${chave}`)
      }
      const { corpo, avisos } = validar(modulo, 'criar', bruto, chave)

      const anexo = flags.anexo && flags.anexo !== true ? flags.anexo : null
      if (anexo) {
        if (!fs.existsSync(anexo)) throw new Error(`Arquivo nao encontrado: ${anexo}`)
        const ext = path.extname(anexo).toLowerCase()
        const aceitas = EXTENSOES_ANEXO[vinculo] || []
        if (!aceitas.includes(ext)) {
          throw new Error(`Extensao ${ext} nao aceita para ${vinculo} (aceita: ${aceitas.join(', ')}).`)
        }
      }

      if (flags['dry-run']) {
        return {
          texto: [
            '[dry-run] nada foi enviado. A sequencia seria:',
            `  1. POST /api${recurso.caminho}`,
            JSON.stringify(corpo, null, 2),
            anexo ? `  2. POST /api${CAMINHO_ARQUIVO}?${vinculo}=<${vinculo === 'pdr_ano' ? 'ano do corpo' : 'id criado'}> com ${path.basename(anexo)}` : '  (sem anexo)'
          ].join('\n'),
          avisos
        }
      }

      const criado = await http.autenticada(cfg, 'POST', recurso.caminho, { corpo })
      const registroCriado = criado.dados || {}
      const linhas = [criado.message || `${chave} criado.`]
      if (Object.keys(registroCriado).length) {
        linhas.push(saida.registro(registroCriado, opcoesSaida))
      }

      if (!anexo) {
        return { texto: linhas.join('\n'), avisos }
      }

      // O vinculo do PDR e por ANO, nao pelo id do item recem-criado.
      const alvo = vinculo === 'pdr_ano' ? corpo.ano : registroCriado.id
      if (alvo === undefined || alvo === null) {
        avisos.push(
          `Registro criado, mas nao consegui descobrir o ${vinculo} para anexar ` +
          `(a resposta do POST nao trouxe o id). Anexe a parte: ` +
          `orcamento ${chave} anexar --id <${vinculo}> --file ${anexo}`
        )
        return { texto: linhas.join('\n'), avisos }
      }

      const bytesArquivo = fs.readFileSync(anexo)
      const ext = path.extname(anexo).toLowerCase()
      const mp = http.multipart('arquivo', anexo, bytesArquivo, MIMES[ext] || 'application/octet-stream')
      try {
        const anexado = await http.autenticada(
          cfg, 'POST', CAMINHO_ARQUIVO + http.query({ [vinculo]: alvo }),
          { bytes: mp.bytes, contentType: mp.contentType }
        )
        linhas.push(`${anexado.message || 'anexo enviado'} (${path.basename(anexo)}, ${bytesArquivo.length} bytes)`)
      } catch (err) {
        // O registro JA foi criado: nao existe transacao entre as duas rotas.
        // Dizer isso e obrigatorio, senao o agente reexecuta o lancar inteiro e
        // duplica o registro (ou leva 409).
        avisos.push(
          `ATENCAO: o ${chave} foi criado (${vinculo}=${alvo}), mas o anexo FALHOU: ${err.message}\n` +
          `NAO repita o lancar (duplicaria o registro). Reenvie so o anexo:\n` +
          `  orcamento ${chave} anexar --id ${alvo} --file ${anexo}`
        )
      }

      return { texto: linhas.join('\n'), avisos }
    }

    // -----------------------------------------------------------------------
    case 'deletar': {
      const id = argsLib.exigir(flags, 'id', `id do registro de ${chave} a excluir`)

      // Guardrail de acao irreversivel na propria interface.
      const confirmacao = flags.confirmar
      if (confirmacao !== String(id)) {
        throw new Error(
          `Exclusao e irreversivel e nao foi confirmada.\n` +
          `Para excluir de fato, repita o id em --confirmar:\n` +
          `  orcamento ${chave} deletar --id ${id} --confirmar ${id}\n` +
          `Para so ver o que aconteceria: acrescente --dry-run.`
        )
      }

      if (flags['dry-run']) {
        return { texto: `[dry-run] nada foi enviado. Seria: DELETE /api${recurso.caminho}/${id}` }
      }

      const r = await http.autenticada(cfg, 'DELETE', `${recurso.caminho}/${encodeURIComponent(id)}`)
      return { texto: r.message || `${chave} ${id} excluido.` }
    }

    // -----------------------------------------------------------------------
    case 'anexar': {
      const vinculo = recurso.anexo
      if (!vinculo) {
        throw new Error(
          `O recurso ${chave} nao aceita anexo. Aceitam: nc (nota_credito_id), ` +
          'dfd (dfd_id) e pdr (pdr_ano, por ano).'
        )
      }
      const id = argsLib.exigir(flags, 'id', vinculo === 'pdr_ano' ? 'o ANO do PDR' : `id do ${chave}`)
      const arquivo = argsLib.exigir(flags, 'file', 'caminho do arquivo a anexar')

      if (!fs.existsSync(arquivo)) throw new Error(`Arquivo nao encontrado: ${arquivo}`)
      const ext = path.extname(arquivo).toLowerCase()
      const aceitas = EXTENSOES_ANEXO[vinculo] || []
      if (!aceitas.includes(ext)) {
        throw new Error(`Extensao ${ext} nao aceita para ${vinculo} (aceita: ${aceitas.join(', ')}).`)
      }

      const bytesArquivo = fs.readFileSync(arquivo)
      if (flags['dry-run']) {
        return {
          texto: `[dry-run] nada foi enviado. Seria: POST /api${recurso.caminho}?${vinculo}=${id} ` +
            `com ${path.basename(arquivo)} (${bytesArquivo.length} bytes)`
        }
      }

      const mp = http.multipart('arquivo', arquivo, bytesArquivo, MIMES[ext] || 'application/octet-stream')
      const r = await http.autenticada(
        cfg, 'POST', CAMINHO_ARQUIVO + http.query({ [vinculo]: id }),
        { bytes: mp.bytes, contentType: mp.contentType }
      )
      return { texto: `${r.message || 'anexado'} (${path.basename(arquivo)}, ${bytesArquivo.length} bytes)` }
    }

    default:
      throw new Error(
        `Acao desconhecida "${acao}" para ${chave}. ` +
        'Use: listar, obter, criar, atualizar, deletar, anexar.'
      )
  }
}

module.exports = { executar, precisaServidor: true }
