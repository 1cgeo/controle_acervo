'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')

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

// O NOME de quem cadastrou e de quem alterou sai junto com o uuid. A tela nao
// tem como resolver um uuid, e o historico de alteracoes so comeca em
// 2026-07-30: para os itens gravados antes disso, a data de cadastro e o nome
// sao a unica rastreabilidade que existe.
const SELECT = `
  SELECT i.id, i.ano, i.cod_nd, nd.nome AS nd_nome,
         i.meta_pit_id, mp.numero_meta AS meta_numero, mp.item AS meta_item,
         mp.descricao AS meta_descricao,
         i.item_label, i.descricao, i.gnd,
         i.valor_solicitado, i.valor_autorizado, i.observacao,
         i.data_cadastramento, i.usuario_cadastramento_uuid,
         uc.nome AS usuario_cadastramento,
         i.data_modificacao, i.usuario_modificacao_uuid,
         um.nome AS usuario_modificacao
  FROM orcamento.pdr_item AS i
  INNER JOIN dominio.natureza_despesa AS nd ON nd.code = i.cod_nd
  LEFT JOIN pit.meta_vigente AS mp ON mp.id = i.meta_pit_id
  LEFT JOIN dgeo.usuario AS uc ON uc.uuid = i.usuario_cadastramento_uuid
  LEFT JOIN dgeo.usuario AS um ON um.uuid = i.usuario_modificacao_uuid`

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

// GANHOU TRANSACAO em 2026-08-02: a linha de rastro tem de cair junto com a
// mudanca que ela descreve, e no INSERT solto isso nao era possivel.
controller.criar = async (item, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criado = await t.one(
      `INSERT INTO orcamento.pdr_item
         (ano, cod_nd, meta_pit_id, item_label, descricao, gnd,
          valor_solicitado, valor_autorizado, observacao, usuario_cadastramento_uuid)
       VALUES
         ($<ano>, $<cod_nd>, $<meta_pit_id>, $<item_label>, $<descricao>, $<gnd>,
          $<valor_solicitado>, $<valor_autorizado>, $<observacao>, $<usuarioUuid>)
       RETURNING *`,
      { ...normaliza(item), usuarioUuid }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.pdr_item',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    })

    // O `RETURNING *` e do rastro; a rota continua devolvendo so o id.
    return { id: criado.id }
  })
}

controller.atualizar = async (id, item, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Antes daqui o 404 saia do `rowCount` do proprio UPDATE, e o estado
    // anterior era destruido sem nunca ser lido. `lerAntes` faz as duas coisas
    // e lanca o MESMO 404.
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'orcamento.pdr_item',
      id,
      'Item do PDR'
    )

    const depois = await t.one(
      `UPDATE orcamento.pdr_item SET
         ano = $<ano>, cod_nd = $<cod_nd>, meta_pit_id = $<meta_pit_id>,
         item_label = $<item_label>, descricao = $<descricao>, gnd = $<gnd>,
         valor_solicitado = $<valor_solicitado>, valor_autorizado = $<valor_autorizado>,
         observacao = $<observacao>,
         data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      { ...normaliza(item), id, dataModificacao: new Date(), usuarioUuid }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.pdr_item',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  })
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'orcamento.pdr_item',
      id,
      'Item do PDR'
    )

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

    await t.none('DELETE FROM orcamento.pdr_item WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.pdr_item',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
