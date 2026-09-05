'use strict'

const fs = require('fs').promises
const fsClassic = require('fs')

const AppError = require('./app_error')
const httpCode = require('./http_code')

/**
 * Envia como download HTTP um arquivo que mora num VOLUME do acervo.
 *
 * O volume é um caminho de sistema de arquivos (UNC no Windows, ponto de
 * montagem no Linux), e não um serviço: nenhum volume precisa de servidor HTTP.
 * O byte vai do volume até este processo por SMB, e daqui até o navegador por
 * HTTP. Nada é copiado para pasta temporária, então não há o que limpar depois.
 *
 * Existe compartilhado porque DOIS módulos entregam arquivo do volume (o acervo
 * e o ponto de controle), e as três armadilhas abaixo são iguais nos dois.
 */

/**
 * Content-Disposition com nome de arquivo acentuado.
 *
 * São dois parâmetros de propósito: `filename` (ASCII, para cliente antigo) e
 * `filename*` (RFC 5987, com o nome de verdade). Com só o primeiro, o acento
 * chega trocado; com só o segundo, cliente antigo baixa "download" sem extensão.
 * @param {string} nome
 * @returns {string}
 */
const disposicao = (nome) => {
  const ascii = nome.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`
}

/**
 * Interpreta o cabeçalho Range.
 *
 * Aceita UMA faixa (`bytes=0-` ou `bytes=100-199`), que é o que navegador e
 * gerenciador de download mandam ao retomar. Faixa múltipla devolve `null`, e o
 * arquivo inteiro vai no lugar: responder multipart/byteranges seria mais código
 * para um caso que nenhum cliente nosso produz.
 *
 * @param {string|undefined} cabecalho
 * @param {number} tamanho - tamanho total, em bytes
 * @returns {{inicio:number, fim:number}|null|'invalida'}
 */
const faixaPedida = (cabecalho, tamanho) => {
  if (!cabecalho) return null

  const achado = /^bytes=(\d*)-(\d*)$/.exec(String(cabecalho).trim())
  if (!achado) return null

  const [, cruInicio, cruFim] = achado
  if (cruInicio === '' && cruFim === '') return 'invalida'

  // Sufixo (`bytes=-500`): os últimos 500 bytes.
  if (cruInicio === '') {
    const ultimos = Number(cruFim)
    if (ultimos <= 0) return 'invalida'
    return { inicio: Math.max(tamanho - ultimos, 0), fim: tamanho - 1 }
  }

  const inicio = Number(cruInicio)
  const fim = cruFim === '' ? tamanho - 1 : Math.min(Number(cruFim), tamanho - 1)
  if (inicio > fim || inicio >= tamanho) return 'invalida'
  return { inicio, fim }
}

/**
 * Confere o arquivo no volume e faz stream dele na resposta.
 *
 * @param {Object} req - request do Express (só o cabeçalho Range é lido)
 * @param {Object} res - response do Express
 * @param {{caminho:string, nome:string, checksum?:string}} arquivo
 * @returns {Promise<{bytes:number, parcial:boolean}>} resolve quando o último
 *   byte saiu. Quem chama usa isso para registrar o download com o desfecho
 *   REAL, e não com a intenção.
 */
const enviarArquivoDoVolume = async (req, res, arquivo) => {
  // O registro diz que o arquivo existe; o VOLUME é que decide. Esta conferência
  // vem ANTES de qualquer cabeçalho: depois dele não há como responder erro, e o
  // download sairia truncado parecendo completo.
  let info
  try {
    await fs.access(arquivo.caminho)
    info = await fs.stat(arquivo.caminho)
  } catch {
    throw new AppError(
      `O arquivo está registrado mas não foi encontrado no volume: ${arquivo.nome}`,
      httpCode.NotFound
    )
  }

  const tamanho = info.size

  // ARQUIVO DE 0 BYTE É RECUSA, e a recusa mora AQUI, junto da conferência
  // acima e antes de qualquer cabeçalho. Sem `Range`, `fim = tamanho - 1` daria
  // `-1`, e `createReadStream(..., { end: -1 })` LANÇA SÍNCRONO
  // (`ERR_OUT_OF_RANGE`). O lanço acontece depois de `Content-Disposition:
  // attachment` já ter sido escrito no `res`: o Express responde o JSON de 500
  // (porque `headersSent` ainda é falso), mas com o cabeçalho de anexo em pé, e
  // o navegador SALVA um arquivo com o texto do erro dentro, com o nome do
  // arquivo do acervo. Um stub de 0 byte nasce fácil (cópia SMB interrompida,
  // envio de arquivo vazio), e o que o usuário precisa ler é que o arquivo está
  // registrado e vazio, não um download que parece ter dado certo.
  if (tamanho === 0) {
    throw new AppError(
      `O arquivo está registrado mas está vazio no volume: ${arquivo.nome}`,
      httpCode.NotFound
    )
  }

  const faixa = faixaPedida(req.headers && req.headers.range, tamanho)

  if (faixa === 'invalida') {
    res.setHeader('Content-Range', `bytes */${tamanho}`)
    throw new AppError(
      `Faixa de bytes inválida para o arquivo ${arquivo.nome}`,
      httpCode.RangeNotSatisfiable
    )
  }

  const inicio = faixa ? faixa.inicio : 0
  const fim = faixa ? faixa.fim : tamanho - 1
  const bytes = fim - inicio + 1

  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Disposition', disposicao(arquivo.nome))
  // Sem isto o navegador não tenta retomar, e um arquivo de 500 MB que cai no
  // meio começa de novo do zero.
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Length', String(bytes))

  if (faixa) {
    res.status(206)
    res.setHeader('Content-Range', `bytes ${inicio}-${fim}/${tamanho}`)
  } else if (arquivo.checksum) {
    // O checksum é do arquivo INTEIRO, então ele só vai na entrega inteira:
    // mandá-lo junto de uma fatia convida a comparar o que não é comparável.
    res.setHeader('X-Checksum-SHA256', arquivo.checksum)
  }

  return new Promise((resolve, reject) => {
    const fluxo = fsClassic.createReadStream(arquivo.caminho, { start: inicio, end: fim })

    fluxo.on('error', (erro) => {
      // Cabeçalho já foi: não há como virar isto num JSON de erro. Derruba a
      // conexão, que é o que faz o cliente perceber o arquivo incompleto.
      res.destroy()
      reject(erro)
    })

    res.on('close', () => {
      // Cliente desistiu no meio (fechou a aba, cancelou). Não é erro nosso, mas
      // também não é entrega: quem registra o download precisa saber a diferença.
      if (!res.writableFinished) {
        fluxo.destroy()
        reject(new Error(`Download interrompido pelo cliente: ${arquivo.nome}`))
      }
    })

    res.on('finish', () => resolve({ bytes, parcial: Boolean(faixa) }))

    fluxo.pipe(res)
  })
}

module.exports = { enviarArquivoDoVolume, faixaPedida, disposicao }
