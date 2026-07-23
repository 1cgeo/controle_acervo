// Path: mapoteca\anexo_pedido_ctrl.js
'use strict'

const path = require('path')

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')
const { TIPO_ANEXO_PEDIDO } = require('../utils/domain_constants')

const controller = {}

// O multer/busboy entrega file.originalname decodificado como latin1; refaz
// para UTF-8 para não corromper nomes com acento (ex.: "relatório.pdf"). Para
// nomes ASCII é um no-op.
const decodeNome = nome => Buffer.from(nome, 'latin1').toString('utf8')

// Colunas devolvidas ao client (NUNCA o conteudo BYTEA: a listagem traz só os
// metadados; os bytes saem apenas no download).
const COLUNAS = `
  a.id, a.pedido_id, a.tipo_anexo_id, ta.nome AS tipo_anexo_nome,
  a.nome_original, a.extensao, a.mimetype, a.tamanho_bytes, a.descricao,
  a.data_cadastramento, a.usuario_cadastramento_uuid, u.nome AS usuario_cadastramento_nome`

const listarPorPedido = async (pedidoId, conn = db.conn) => {
  return conn.any(
    `SELECT ${COLUNAS}
       FROM mapoteca.anexo_pedido a
       JOIN mapoteca.tipo_anexo_pedido ta ON ta.code = a.tipo_anexo_id
       LEFT JOIN dgeo.usuario u ON u.uuid = a.usuario_cadastramento_uuid
      WHERE a.pedido_id = $<pedidoId>
      ORDER BY a.tipo_anexo_id, a.data_cadastramento, a.id`,
    { pedidoId }
  )
}

controller.listarPorPedido = async pedidoId => {
  const pedido = await db.conn.oneOrNone(
    'SELECT 1 FROM mapoteca.pedido WHERE id = $1',
    [pedidoId]
  )
  if (!pedido) {
    throw new AppError('Pedido não encontrado', httpCode.NotFound)
  }
  return listarPorPedido(pedidoId)
}

// Cria o registro do anexo gravando os bytes (file.buffer) no banco. Um pedido
// admite vários anexos (não substitui). Devolve a lista atualizada do pedido.
controller.criar = async (pedidoId, file, dados, usuarioUuid) => {
  const nomeOriginal = decodeNome(file.originalname)
  const meta = {
    pedidoId,
    tipoAnexoId:
      dados && dados.tipo_anexo_id != null
        ? dados.tipo_anexo_id
        : TIPO_ANEXO_PEDIDO.OUTROS,
    nomeOriginal,
    extensao: path.extname(nomeOriginal).replace('.', '').toLowerCase(),
    mimetype: file.mimetype || null,
    tamanhoBytes:
      file.buffer != null ? file.buffer.length : file.size != null ? file.size : null,
    conteudo: file.buffer,
    descricao: dados && dados.descricao != null ? dados.descricao : null,
    usuarioUuid
  }

  return db.conn.tx(async t => {
    const pedido = await t.oneOrNone(
      'SELECT 1 FROM mapoteca.pedido WHERE id = $1',
      [pedidoId]
    )
    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound)
    }

    await t.none(
      `INSERT INTO mapoteca.anexo_pedido
         (pedido_id, tipo_anexo_id, nome_original, extensao, mimetype,
          tamanho_bytes, conteudo, descricao, usuario_cadastramento_uuid)
       VALUES
         ($<pedidoId>, $<tipoAnexoId>, $<nomeOriginal>, $<extensao>, $<mimetype>,
          $<tamanhoBytes>, $<conteudo>, $<descricao>, $<usuarioUuid>)`,
      meta
    )

    return listarPorPedido(pedidoId, t)
  })
}

// Metadados + bytes de um anexo, para download. Valida existência no banco.
controller.getParaDownload = async id => {
  const arquivo = await db.conn.oneOrNone(
    `SELECT id, nome_original, mimetype, conteudo
       FROM mapoteca.anexo_pedido WHERE id = $1`,
    [id]
  )
  if (!arquivo) {
    throw new AppError('Anexo não encontrado', httpCode.NotFound)
  }
  return arquivo
}

controller.deletar = async id => {
  const arquivo = await db.conn.oneOrNone(
    'SELECT id FROM mapoteca.anexo_pedido WHERE id = $1',
    [id]
  )
  if (!arquivo) {
    throw new AppError('Anexo não encontrado', httpCode.NotFound)
  }
  await db.conn.none('DELETE FROM mapoteca.anexo_pedido WHERE id = $1', [id])
}

module.exports = controller
