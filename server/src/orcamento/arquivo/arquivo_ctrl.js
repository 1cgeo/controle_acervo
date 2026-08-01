'use strict'

const path = require('path')

const { db } = require('../../database')
const { AppError, httpCode } = require('../utils')

const controller = {}

// O multer/busboy entrega file.originalname decodificado como latin1; refaz
// para UTF-8 para nao corromper nomes com acento (ex.: "relatório.pdf"). Para
// nomes ASCII e um no-op.
const decodeNome = nome => Buffer.from(nome, 'latin1').toString('utf8')

// Colunas devolvidas ao client (NUNCA o conteudo BYTEA: a listagem traz so os
// metadados; os bytes saem apenas no download).
const COLUNAS =
  `id, nota_credito_id, dfd_id, pdr_ano, nome_original,
   extensao, mimetype, tamanho_bytes, data_cadastramento, usuario_cadastramento_uuid`

const INSERT_SQL = `INSERT INTO orcamento.arquivo
    (nota_credito_id, dfd_id, pdr_ano, nome_original,
     extensao, mimetype, tamanho_bytes, conteudo, usuario_cadastramento_uuid)
  VALUES
    ($<notaCreditoId>, $<dfdId>, $<pdrAno>, $<nomeOriginal>,
     $<extensao>, $<mimetype>, $<tamanhoBytes>, $<conteudo>, $<usuarioUuid>)`

// Normaliza o vinculo (NC | DFD | PDR-ano) num trio com null nos ausentes.
const normalizarVinculo = vinculo => ({
  notaCreditoId: vinculo.nota_credito_id != null ? vinculo.nota_credito_id : null,
  dfdId: vinculo.dfd_id != null ? vinculo.dfd_id : null,
  pdrAno: vinculo.pdr_ano != null ? vinculo.pdr_ano : null
})

controller.listarPorVinculo = async vinculo => {
  const { notaCreditoId, dfdId, pdrAno } = normalizarVinculo(vinculo)
  // Exatamente um dos tres e nao-nulo (garantido pelo schema); o branch ativo
  // filtra pela coluna correspondente.
  return db.conn.any(
    `SELECT ${COLUNAS}
       FROM orcamento.arquivo
      WHERE ($<notaCreditoId>::bigint IS NOT NULL AND nota_credito_id = $<notaCreditoId>)
         OR ($<dfdId>::bigint IS NOT NULL AND dfd_id = $<dfdId>)
         OR ($<pdrAno>::smallint IS NOT NULL AND pdr_ano = $<pdrAno>)
      ORDER BY data_cadastramento, id`,
    { notaCreditoId, dfdId, pdrAno }
  )
}

// Cria o registro do anexo gravando os bytes (file.buffer) no banco. Para
// NC/DFD (single) substitui o anexo anterior em transacao (apaga a linha antiga
// e insere a nova). Devolve a lista atualizada do vinculo.
controller.criar = async (file, vinculo, usuarioUuid) => {
  const { notaCreditoId, dfdId, pdrAno } = normalizarVinculo(vinculo)

  // Valida o dono (NC/DFD). PDR e nivel ano: nao ha linha pai para checar.
  if (notaCreditoId != null) {
    const nc = await db.conn.oneOrNone(
      'SELECT 1 FROM orcamento.nota_credito WHERE id = $1',
      [notaCreditoId]
    )
    if (!nc) {
      throw new AppError('Nota de credito nao encontrada', httpCode.NotFound)
    }
  } else if (dfdId != null) {
    const dfd = await db.conn.oneOrNone(
      'SELECT 1 FROM orcamento.dfd WHERE id = $1',
      [dfdId]
    )
    if (!dfd) {
      throw new AppError('DFD nao encontrado', httpCode.NotFound)
    }
  }

  const nomeOriginal = decodeNome(file.originalname)
  const meta = {
    notaCreditoId,
    dfdId,
    pdrAno,
    nomeOriginal,
    extensao: path.extname(nomeOriginal).replace('.', '').toLowerCase(),
    mimetype: file.mimetype || null,
    tamanhoBytes: file.buffer != null ? file.buffer.length : (file.size != null ? file.size : null),
    conteudo: file.buffer,
    usuarioUuid
  }

  const single = notaCreditoId != null || dfdId != null

  if (single) {
    // coluna e um identificador interno controlado (nunca entrada do usuario).
    const coluna = notaCreditoId != null ? 'nota_credito_id' : 'dfd_id'
    const valorDono = notaCreditoId != null ? notaCreditoId : dfdId

    // Reenviar substitui: apaga o anexo anterior e insere o novo na mesma tx.
    await db.conn.tx(async t => {
      await t.none(`DELETE FROM orcamento.arquivo WHERE ${coluna} = $1`, [
        valorDono
      ])
      await t.none(INSERT_SQL, meta)
    })
  } else {
    await db.conn.none(INSERT_SQL, meta)
  }

  return controller.listarPorVinculo(vinculo)
}

// Metadados + bytes de um anexo, para download. Valida existencia no banco.
controller.getParaDownload = async id => {
  const arquivo = await db.conn.oneOrNone(
    `SELECT id, nome_original, mimetype, conteudo
       FROM orcamento.arquivo WHERE id = $1`,
    [id]
  )
  if (!arquivo) {
    throw new AppError('Arquivo nao encontrado', httpCode.NotFound)
  }

  return arquivo
}

controller.deletar = async id => {
  const arquivo = await db.conn.oneOrNone(
    'SELECT id FROM orcamento.arquivo WHERE id = $1',
    [id]
  )
  if (!arquivo) {
    throw new AppError('Arquivo nao encontrado', httpCode.NotFound)
  }

  await db.conn.none('DELETE FROM orcamento.arquivo WHERE id = $1', [id])
}

module.exports = controller
