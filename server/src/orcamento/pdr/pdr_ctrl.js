'use strict'

const { db } = require('../../database')

const { AppError, httpCode } = require('../utils')

const controller = {}

// Campos opcionais do item; normalizados para null antes da query (um request
// valido que omite um opcional nao pode dar 500 por "Property doesn't exist").
const opcionais = [
  'meta_pit_id',
  'item_label',
  'descricao',
  'gnd',
  'valor_solicitado',
  'valor_autorizado',
  'observacao'
]

const normaliza = item => {
  const out = { ano: item.ano, cod_nd: item.cod_nd }
  opcionais.forEach(c => { out[c] = item[c] !== undefined ? item[c] : null })
  return out
}

const SELECT = `
  SELECT i.id, i.ano, i.cod_nd, nd.nome AS nd_nome,
         i.meta_pit_id, mp.numero_meta AS meta_numero, mp.item AS meta_item,
         mp.descricao AS meta_descricao,
         i.item_label, i.descricao, i.gnd,
         i.valor_solicitado, i.valor_autorizado, i.observacao,
         i.data_cadastramento, i.usuario_cadastramento_uuid,
         i.data_modificacao, i.usuario_modificacao_uuid
  FROM orcamento.pdr_item AS i
  INNER JOIN dominio.natureza_despesa AS nd ON nd.code = i.cod_nd
  LEFT JOIN pit.meta AS mp ON mp.id = i.meta_pit_id`

controller.listar = async ano => {
  return db.conn.any(
    `${SELECT}
     WHERE ($<ano> IS NULL OR i.ano = $<ano>)
     ORDER BY i.ano DESC, i.item_label, i.cod_nd`,
    { ano: ano !== undefined ? ano : null }
  )
}

controller.getPorId = async id => {
  const item = await db.conn.oneOrNone(
    `${SELECT} WHERE i.id = $<id>`,
    { id }
  )
  if (!item) {
    throw new AppError('Item do PDR não encontrado', httpCode.NotFound)
  }
  return item
}

controller.criar = async (item, usuarioUuid) => {
  return db.conn.one(
    `INSERT INTO orcamento.pdr_item
       (ano, cod_nd, meta_pit_id, item_label, descricao, gnd,
        valor_solicitado, valor_autorizado, observacao, usuario_cadastramento_uuid)
     VALUES
       ($<ano>, $<cod_nd>, $<meta_pit_id>, $<item_label>, $<descricao>, $<gnd>,
        $<valor_solicitado>, $<valor_autorizado>, $<observacao>, $<usuarioUuid>)
     RETURNING id`,
    { ...normaliza(item), usuarioUuid }
  )
}

controller.atualizar = async (id, item, usuarioUuid) => {
  const result = await db.conn.result(
    `UPDATE orcamento.pdr_item SET
       ano = $<ano>, cod_nd = $<cod_nd>, meta_pit_id = $<meta_pit_id>,
       item_label = $<item_label>, descricao = $<descricao>, gnd = $<gnd>,
       valor_solicitado = $<valor_solicitado>, valor_autorizado = $<valor_autorizado>,
       observacao = $<observacao>,
       data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
     WHERE id = $<id>`,
    { ...normaliza(item), id, dataModificacao: new Date(), usuarioUuid }
  )
  if (!result.rowCount || result.rowCount !== 1) {
    throw new AppError('Item do PDR não encontrado', httpCode.NotFound)
  }
}

controller.deletar = async id => {
  return db.conn.tx(async t => {
    const existente = await t.oneOrNone(
      'SELECT id FROM orcamento.pdr_item WHERE id = $<id>',
      { id }
    )
    if (!existente) {
      throw new AppError('Item do PDR não encontrado', httpCode.NotFound)
    }

    // Bloqueia a exclusao se houver nota de credito vinculada ao item (FK).
    const referenciado = await t.oneOrNone(
      'SELECT 1 FROM orcamento.nota_credito WHERE pdr_item_id = $<id> LIMIT 1',
      { id }
    )
    if (referenciado) {
      throw new AppError(
        'Não é possível remover o item: existe nota de crédito vinculada a ele',
        httpCode.Conflict
      )
    }

    return t.none('DELETE FROM orcamento.pdr_item WHERE id = $<id>', { id })
  })
}

module.exports = controller
