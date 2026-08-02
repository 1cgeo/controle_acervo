'use strict'

// Recebe UM arquivo por HTTP e o grava direto no volume do acervo.
//
// O QUE MUDA AQUI. Ate 2026-08-01 o servidor nunca gravava byte em volume:
// quem copiava era o plugin do QGIS, por SMB, e o par prepare-upload/
// confirm-upload so registrava a intencao e conferia o resultado. O servidor ja
// ALCANCA o volume (o download faz createReadStream + pipe em
// utils/enviar_arquivo.js), entao o que faltava para o navegador tambem carregar
// era o sentido contrario. A sessao, as tabelas _temp e o confirm-upload sao os
// MESMOS: um caminho novo de deposito, nao uma segunda maquina de upload.
//
// POR QUE MULTER COM STORAGE PROPRIO, e nao `diskStorage` nem `busboy` direto:
//
//   - `memoryStorage` esta fora de questao. Ele guarda o arquivo inteiro em
//     `file.buffer`, e um .img de 7,4 GB derruba o processo. E o que os dois
//     usos de multer que ja existiam (anexo do pedido, anexo do orcamento)
//     fazem, e ali cabe: sao anexos de 50 a 100 MB que vao para o BANCO.
//   - `diskStorage` grava o arquivo e devolve so o caminho. Para o SHA-256
//     seria preciso ler o arquivo DE NOVO, e ler duas vezes o mesmo byte e
//     exatamente o custo que a catalogacao in-place existiu para remover
//     (362 GB relidos no LOTE_1 do Convenio RS). Aqui o byte passa pelo
//     processo uma unica vez: o mesmo fluxo que escreve alimenta o hash.
//   - `busboy` direto daria o mesmo, mas ele e dependencia TRANSITIVA do
//     multer, e nao esta no package.json. Depender de dependencia de terceiro
//     quebra na primeira atualizacao que o multer fizer sem nos avisar.
//
// Sobra o contrato de storage do proprio multer, que e publico e entrega o
// fluxo cru em `file.stream`: parsing de multipart e teto de tamanho ficam com
// a biblioteca, e a escrita fica conosco.

const multer = require('multer')
const fs = require('fs')
const fsPromises = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { Transform, pipeline } = require('stream')
const { promisify } = require('util')

const pipelineAsync = promisify(pipeline)

const { db } = require('../database')
const config = require('../config')
const {
  AppError,
  httpCode,
  logger,
  domainConstants: { TIPO_ARQUIVO }
} = require('../utils')

// Sufixo do arquivo AINDA INCOMPLETO.
//
// Nada e gravado direto no nome definitivo. Conexao cortada no meio (aba
// fechada, cabo, timeout do proxy) deixaria um arquivo truncado com o nome que
// o acervo considera valido: o registro diria 400 MB, o volume teria 12, e o
// unico jeito de descobrir seria alguem baixar e reclamar. Com o `.parcial`, a
// interrupcao deixa lixo visivel e nomeado, que o cancel-upload apaga.
const SUFIXO_PARCIAL = '.parcial'

// Blocos de 8 MB, pelo mesmo motivo do BLOCO_LEITURA de arquivo_ctrl.js: o
// destino e um share SMB, e ali o custo por escrita e de rede, nao de disco.
const BLOCO_ESCRITA = 8 * 1024 * 1024

/** Teto em bytes, lido a cada requisicao para nao divergir do config. */
const tetoEmBytes = () => Number(config.UPLOAD_WEB_MAX_GB) * 1024 * 1024 * 1024

const emGb = bytes => (bytes / (1024 * 1024 * 1024)).toFixed(2)

const mensagemDeTeto = () =>
  `Arquivo maior que o teto de ${config.UPLOAD_WEB_MAX_GB} GB do envio pelo navegador. ` +
  'Arquivo desse tamanho entra pelo plugin do QGIS, que copia direto para o volume ' +
  'sem passar pelo servidor.'

/**
 * Storage do multer que grava no `.parcial` e MEDE no mesmo passo.
 *
 * O destino nao sai daqui: ele foi calculado no prepare, gravado em
 * `acervo.upload_arquivo_temp.destination_path` e ja validado contra travessia.
 * O middleware abaixo o carrega em `req.arquivoWeb` antes do multer rodar,
 * porque o multipart so pode ser parseado depois de se saber para onde escrever.
 */
const storageNoVolume = {
  _handleFile (req, file, cb) {
    const { caminhoParcial } = req.arquivoWeb

    // `file.path` e o que multer passa para `_removeFile` quando aborta (teto
    // estourado, conexao caida). Sem ele, o `.parcial` do envio interrompido
    // ficaria no volume ate alguem cancelar a sessao.
    file.path = caminhoParcial

    const hash = crypto.createHash('sha256')
    let bytes = 0

    // Transform em vez de um `on('data')` ao lado do pipe: com dois consumidores
    // do mesmo fluxo a ordem entre "entrar em modo fluente" e "conectar o pipe"
    // passa a importar, e um pedaco perdido daria um checksum errado sem erro
    // nenhum. No meio do cano, cada byte e contado exatamente uma vez.
    const medidor = new Transform({
      transform (pedaco, _codificacao, proximo) {
        hash.update(pedaco)
        bytes += pedaco.length
        proximo(null, pedaco)
      }
    })

    // A subpasta e legitima (o nome fisico pode trazer caminho relativo) e
    // `createWriteStream` nao a cria. `recursive` tambem torna a retentativa
    // barata. A raiz ja foi validada: `motivoCaminhoInseguro` roda no prepare.
    fsPromises
      .mkdir(path.dirname(caminhoParcial), { recursive: true })
      .then(() => {
        // `flags: 'w'` trunca: um `.parcial` de tentativa anterior e sobrescrito,
        // nunca continuado. Retomada parcial exigiria saber que os bytes ja
        // gravados sao os mesmos deste envio, e ninguem sabe disso.
        const saida = fs.createWriteStream(caminhoParcial, {
          flags: 'w',
          highWaterMark: BLOCO_ESCRITA
        })
        return pipelineAsync(file.stream, medidor, saida)
      })
      .then(() => {
        cb(null, {
          caminho_parcial: caminhoParcial,
          checksum: hash.digest('hex'),
          bytes,
          tamanho_mb: bytes / (1024 * 1024)
        })
      })
      .catch(cb)
  },

  _removeFile (req, file, cb) {
    const caminho = file.path
    delete file.path
    // Ausente nao e erro: o abort pode ter acontecido antes de a escrita comecar.
    fs.unlink(caminho, erro => cb(erro && erro.code !== 'ENOENT' ? erro : null))
  }
}

/**
 * Carrega a sessao e a linha `_temp` do arquivo, e decide se este usuario pode
 * gravar naquele destino. Roda ANTES do multer: sem destino nao ha para onde
 * streamar, e adiar isso significaria receber gigabytes para so entao recusar.
 */
const resolverDestino = async (req, res, next) => {
  try {
    const { session_uuid: sessionUuid, temp_id: tempId } = req.params

    // O JOIN e o que faz o `temp_id` de OUTRA sessao virar 404: casar so pelo id
    // deixaria qualquer operador escrever no destino reservado por um colega.
    const linha = await db.conn.oneOrNone(
      `SELECT a.id, a.destination_path, a.status, a.tipo_arquivo_id,
              a.nome, a.nome_arquivo, a.extensao,
              s.id AS session_id, s.usuario_uuid, s.status AS session_status,
              s.operation_type
       FROM acervo.upload_arquivo_temp a
       JOIN acervo.upload_session s ON s.id = a.session_id
       WHERE s.uuid_session = $<sessionUuid> AND a.id = $<tempId>`,
      { sessionUuid, tempId }
    )

    if (!linha) {
      throw new AppError(
        'Arquivo não encontrado nesta sessão de upload. ' +
        'O identificador do arquivo tem de ser um dos que o prepare devolveu para esta mesma sessão.',
        httpCode.NotFound
      )
    }

    if (linha.usuario_uuid !== req.usuarioUuid) {
      throw new AppError(
        'Usuário não autorizado para esta sessão de upload',
        httpCode.Forbidden
      )
    }

    if (linha.session_status !== 'pending') {
      throw new AppError(
        `Sessão de upload já está com status "${linha.session_status}"; não aceita mais arquivos`,
        httpCode.Conflict
      )
    }

    if (Number(linha.tipo_arquivo_id) === TIPO_ARQUIVO.TILESERVER) {
      throw new AppError(
        'Tileserver é uma URL e não tem byte para enviar',
        httpCode.BadRequest
      )
    }

    // O `Content-Length` do navegador chega antes do primeiro byte do corpo, e
    // recusar aqui evita receber gigabytes para descartar no fim. Nao substitui
    // o teto do multer: requisicao em `chunked` nao declara tamanho nenhum, e e
    // la que a conta vale. A folga cobre o envelope do multipart (delimitador,
    // cabecalho da parte), que viaja junto e nao e do arquivo: com um arquivo
    // por requisicao ele fica na casa das centenas de bytes, entao 64 KB e
    // folga larga sem tornar o teto pequeno inexequivel.
    const declarado = Number(req.headers['content-length'])
    const teto = tetoEmBytes()
    if (Number.isFinite(declarado) && declarado > teto + 64 * 1024) {
      throw new AppError(
        `${mensagemDeTeto()} Recebido: ${emGb(declarado)} GB.`,
        httpCode.BadRequest
      )
    }

    req.arquivoWeb = {
      tempId: Number(linha.id),
      sessionId: Number(linha.session_id),
      destino: linha.destination_path,
      caminhoParcial: linha.destination_path + SUFIXO_PARCIAL,
      nome: linha.nome,
      nomeArquivo: linha.nome_arquivo,
      extensao: linha.extensao
    }

    return next()
  } catch (erro) {
    return next(erro)
  }
}

/**
 * Recebe o multipart de um arquivo so, no campo "arquivo".
 *
 * O multer e construido A CADA requisicao porque o teto e lido do config na
 * hora: construido uma vez no `require`, ele congelaria o valor e o teste (e o
 * ajuste em producao) passaria a mentir. O objeto e barato.
 */
const receberMultipart = (req, res, next) => {
  const middleware = multer({
    storage: storageNoVolume,
    limits: { fileSize: tetoEmBytes(), files: 1 }
  }).single('arquivo')

  middleware(req, res, erro => {
    if (!erro) return next()
    if (erro instanceof multer.MulterError) {
      const mensagem =
        erro.code === 'LIMIT_FILE_SIZE'
          ? mensagemDeTeto()
          : `Erro no envio do arquivo: ${erro.message}`
      return next(new AppError(mensagem, httpCode.BadRequest, erro))
    }
    return next(erro)
  })
}

const uploadArquivoWeb = [resolverDestino, receberMultipart]

/**
 * Apaga os `.parcial` de uma sessao.
 *
 * So os `.parcial`: arquivo ja renomeado para o nome definitivo saiu do dominio
 * desta funcao. Ele pode ser o byte que outra sessao (ou um confirm anterior)
 * ja considera gravado, e apagar arquivo de acervo por causa de um cancelamento
 * seria destruir dado para limpar lixo.
 *
 * Falha ao apagar vira log, nunca erro da requisicao: quem cancelou cancelou, e
 * derrubar o cancelamento porque um arquivo temporario resistiu deixaria a
 * sessao aberta, que e o problema maior.
 */
const removerParciais = async (caminhos, contexto = {}) => {
  let apagados = 0
  for (const destino of caminhos) {
    if (!destino) continue
    try {
      await fsPromises.unlink(destino + SUFIXO_PARCIAL)
      apagados++
    } catch (erro) {
      if (erro.code === 'ENOENT') continue
      logger.warn('Não foi possível apagar arquivo parcial de upload', {
        ...contexto,
        caminho: destino + SUFIXO_PARCIAL,
        erro: erro.message
      })
    }
  }
  return apagados
}

module.exports = {
  uploadArquivoWeb,
  removerParciais,
  SUFIXO_PARCIAL
}
