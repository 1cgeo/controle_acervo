'use strict'

// CRUD generico sobre a registry de recursos:
//   orcamento <recurso> listar    [--ano 2026] [--campos a,b] [--formato tsv|tabela|json]
//   orcamento <recurso> obter     --id 42
//   orcamento <recurso> criar     --data '{...}' | --data-file corpo.json  [--dry-run]
//   orcamento <recurso> atualizar --id 42 --data '{...}'                   [--dry-run]
//   orcamento <recurso> deletar   --id 42 --confirmar <valor>              [--dry-run]
//   orcamento <recurso> anexar    --id 42 --file nota.pdf
//   orcamento arquivo   baixar    --id 42 [--para nota.pdf]
//
// Tres decisoes que valem explicar:
//
// 1. O corpo e validado LOCALMENTE contra o Joi antes de sair da maquina. Um
//    corpo torto falha em milissegundos, com o contrato do campo errado impresso
//    junto, em vez de custar um round-trip e um 400 generico.
//
// 2. O servidor do orcamento RECUSA com 400 a chave desconhecida no corpo (ele
//    recebe o schemaValidation ESTRITO, ver server/src/orcamento/utils/). O CLI
//    pega o nome errado antes, local, e diz qual e.
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

// A rota de anexo sai da registry, nunca escrita a mao: no SCA existe TAMBEM um
// /api/arquivo do acervo, que e outra coisa. Caminho literal aqui acertaria a
// rota errada em vez de dar 404.
const CAMINHO_ARQUIVO = obter('arquivo').caminho

// Flags que nunca sao filtro de listagem: nao entram na query e nao viram aviso
// de "filtro ignorado".
const FLAGS_GLOBAIS = [
  'campos', 'formato', 'json', 'server', 'user', 'senha', 'token', 'cliente',
  'insecure', 'sem-cache', 'dry-run', 'ajuda', 'help',
  'id', 'confirmar', 'data', 'data-file', 'anexo', 'file', 'para'
]

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
    // Descarte DELIBERADO do schema, por .strip(): o campo existe, e legitimo
    // manda-lo, e mesmo assim ele nao grava. O caso vivo e o pdr_item_id de uma
    // NC Extra-PDR. Sem este aviso, isso vira "achei que gravei".
    avisos.push(
      'Campos REMOVIDOS do corpo antes do envio por REGRA do schema (o servidor ' +
      `faria o mesmo): ${r.descartados.join(', ')}.\n` +
      `        Eles existem e nao se aplicam a este caso. Confira em: ` +
      `orcamento schema ${chave}`
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

  // Recurso de LEITURA sem colecao propria: a base nao responde nada, so as
  // sub-rotas. Sem esta guarda, `orcamento dashboard listar` levava 404 em vez
  // de dizer qual e o comando certo.
  if (recurso.somenteLeitura) {
    throw new Error(
      `${chave} nao tem CRUD nem listagem: e um recurso calculado. Sub-rotas: ` +
      `${recurso.somenteLeitura.map(s => s.caminho).join(', ')}.\n` +
      `A execucao por ND sai por: orcamento saldo [--nd 339040] [--ano 2026] [--mes 7]`
    )
  }

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
      const aceitos = esquema.filtrosDe(modulo, recurso.queryListar).map(f => f.nome)
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
      if (recurso.semObter) {
        throw new Error(
          `Nao existe GET por id de ${chave} na API. Para os metadados, use ` +
          `orcamento ${chave} listar --<vinculo> <valor>; para os bytes, ` +
          `orcamento ${chave} baixar --id <id>.`
        )
      }
      const id = argsLib.exigir(flags, 'id', `id do registro de ${chave}`)
      const r = await http.autenticada(cfg, 'GET', `${recurso.caminho}/${encodeURIComponent(id)}`)
      return { texto: saida.registro(r.dados, opcoesSaida) }
    }

    // -----------------------------------------------------------------------
    case 'criar':
    case 'atualizar': {
      if (acao === 'atualizar' && recurso.semAtualizar) {
        throw new Error(
          `Nao existe PUT de ${chave} na API. Para trocar um anexo, apague ` +
          `(orcamento ${chave} deletar --id N --confirmar N) e envie de novo.`
        )
      }
      if (acao === 'criar' && recurso.rotas && chave === 'arquivo') {
        throw new Error(
          'O anexo sobe por multipart, nunca por --data. Use o verbo do dono: ' +
          "orcamento nc anexar --id N --file nota.pdf (ou dfd, ou pdr)."
        )
      }
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
      // TODO PUT do modulo leva id. O desvio de singleton que existia aqui
      // servia a UM recurso, a `configuracao`, cujo `PUT /` sumiu com a poda da
      // 1.34.0: sem ele, a excecao passou a descrever ninguem.
      if (acao === 'atualizar') {
        metodo = 'PUT'
        const id = argsLib.exigir(flags, 'id', `id do registro de ${chave} a atualizar`)
        caminho = `${recurso.caminho}/${encodeURIComponent(id)}`
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
      const temDados = r.dados && typeof r.dados === 'object'
      // Com `--json` o stdout e so o JSON: a mensagem do servidor ia colada
      // ANTES do objeto e quebrava o `JSON.parse` de quem le o id recem-criado
      // para a chamada seguinte. Ela desce para os AVISOS, que saem em stderr.
      if (opcoesSaida.formato === 'json') {
        return {
          texto: saida.registro(temDados ? r.dados : null, opcoesSaida),
          avisos: [r.message || 'ok', ...avisos]
        }
      }
      const texto = temDados
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
      // Com `--json` o stdout e so o registro criado, que e de onde sai o id da
      // proxima chamada; a prosa (mensagem do servidor e desfecho do anexo) vai
      // para os AVISOS, que ja saem em stderr. Colada em volta do objeto, ela
      // quebrava o `JSON.parse` de quem encadeia.
      const jsonPuro = opcoesSaida.formato === 'json'
      const linhas = []
      const contar = texto => (jsonPuro ? avisos : linhas).push(texto)
      const responder = () => ({
        texto: jsonPuro ? saida.registro(registroCriado, opcoesSaida) : linhas.join('\n'),
        avisos
      })

      contar(criado.message || `${chave} criado.`)
      if (!jsonPuro && Object.keys(registroCriado).length) {
        linhas.push(saida.registro(registroCriado, opcoesSaida))
      }

      if (!anexo) {
        return responder()
      }

      // O vinculo do PDR e por ANO, nao pelo id do item recem-criado.
      const alvo = vinculo === 'pdr_ano' ? corpo.ano : registroCriado.id
      if (alvo === undefined || alvo === null) {
        avisos.push(
          `Registro criado, mas nao consegui descobrir o ${vinculo} para anexar ` +
          `(a resposta do POST nao trouxe o id). Anexe a parte: ` +
          `orcamento ${chave} anexar --id <${vinculo}> --file ${anexo}`
        )
        return responder()
      }

      const bytesArquivo = fs.readFileSync(anexo)
      const ext = path.extname(anexo).toLowerCase()
      const mp = http.multipart('arquivo', anexo, bytesArquivo, MIMES[ext] || 'application/octet-stream')
      try {
        const anexado = await http.autenticada(
          cfg, 'POST', CAMINHO_ARQUIVO + http.query({ [vinculo]: alvo }),
          { bytes: mp.bytes, contentType: mp.contentType }
        )
        contar(`${anexado.message || 'anexo enviado'} (${path.basename(anexo)}, ${bytesArquivo.length} bytes)`)
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

      return responder()
    }

    // -----------------------------------------------------------------------
    case 'deletar': {
      const id = argsLib.exigir(flags, 'id', `id do registro de ${chave} a excluir`)

      // O --dry-run nao escreve, entao ele NAO exige a confirmacao: e ele que
      // mostra o que a confirmacao autorizaria. Cobrar --confirmar aqui
      // desmentia a propria mensagem de erro, que manda usar --dry-run antes.
      if (flags['dry-run']) {
        return {
          texto: [
            `[dry-run] nada foi enviado. Seria: DELETE /api${recurso.caminho}/${id}`,
            'Para excluir de fato:',
            `  orcamento ${chave} deletar --id ${id} --confirmar ${id}`
          ].join('\n')
        }
      }

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

      const r = await http.autenticada(cfg, 'DELETE', `${recurso.caminho}/${encodeURIComponent(id)}`)
      return { texto: r.message || `${chave} ${id} excluido.` }
    }

    // -----------------------------------------------------------------------
    case 'anexar': {
      const vinculo = recurso.anexo
      if (!vinculo) {
        throw new Error(
          `O recurso ${chave} nao aceita anexo. Aceitam: nc (nota_credito_id), ` +
          'dfd (dfd_id), pdr (pdr_ano, por ano) e recolhimento (recolhimento_id).'
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

    // -----------------------------------------------------------------------
    // Baixa os bytes de um anexo. Sem ele, conferir o que subiu exigia sair do
    // CLI e chamar a rota na mao com o token do cache, e o TAMANHO seria a unica
    // prova: dois PDF diferentes com o mesmo numero de bytes passam. Por isso o
    // comando imprime o sha256 do que chegou.
    case 'baixar': {
      if (chave !== 'arquivo') {
        throw new Error(
          `baixar so existe para o recurso arquivo (o anexo). Use: ` +
          `orcamento arquivo baixar --id <id do anexo>`
        )
      }
      const id = argsLib.exigir(flags, 'id', 'id do ANEXO (a coluna id da listagem)')
      const destino = flags.para && flags.para !== true ? String(flags.para) : `anexo_${id}`

      if (flags['dry-run']) {
        return {
          texto: `[dry-run] nada foi baixado. Seria: GET /api${recurso.caminho}/${id}/download`
        }
      }

      if (fs.existsSync(destino)) {
        throw new Error(
          `"${destino}" ja existe e nao foi sobrescrito. Escolha outro nome com --para.`
        )
      }

      const r = await http.autenticada(
        cfg, 'GET', `${recurso.caminho}/${encodeURIComponent(id)}/download`,
        { binario: true }
      )
      fs.writeFileSync(destino, r.bytes)
      const sha = require('crypto').createHash('sha256').update(r.bytes).digest('hex')

      return {
        texto: `anexo ${id} gravado em ${destino} (${r.bytes.length} bytes)\nsha256    ${sha}`,
        avisos: [
          'Compare o sha256 com o do arquivo de origem para provar o CONTEUDO. ' +
          'Tamanho igual nao prova nada.'
        ]
      }
    }

    default:
      throw new Error(
        `Acao desconhecida "${acao}" para ${chave}. ` +
        'Use: listar, obter, criar, lancar, atualizar, deletar, anexar. ' +
        'O recurso arquivo tem tambem: baixar.'
      )
  }
}

module.exports = { executar, precisaServidor: true }
