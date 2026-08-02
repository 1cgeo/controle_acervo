'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// Codigo SQLSTATE do PostgreSQL para violacao de chave estrangeira.
const FK_VIOLATION = '23503'

// Reembrulha violacao de FK (nota_empenho_id inexistente) como AppError 400.
const tratarFk = err => {
  if (err && err.code === FK_VIOLATION) {
    throw new AppError(
      'A nota de empenho informada nao existe',
      httpCode.BadRequest,
      err
    )
  }
  throw err
}

controller.listar = async (filtros = {}) => {
  // Lista os recebimentos, opcionalmente filtrados por nota de empenho.
  // Traz o numero da NE para contexto. Ordenado por id.
  return db.conn.any(
    `SELECT rm.id, rm.nota_empenho_id,
            ne.numero AS nota_empenho_numero,
            rm.material, rm.prazo_entrega, rm.situacao, rm.ano_referencia
     FROM orcamento.recebimento_material AS rm
     INNER JOIN orcamento.nota_empenho AS ne ON ne.id = rm.nota_empenho_id
     WHERE ($<notaEmpenhoId> IS NULL OR rm.nota_empenho_id = $<notaEmpenhoId>)
     ORDER BY rm.id`,
    {
      notaEmpenhoId:
        filtros.nota_empenho_id != null ? filtros.nota_empenho_id : null
    }
  )
}

controller.getPorId = async id => {
  const rm = await db.conn.oneOrNone(
    `SELECT rm.id, rm.nota_empenho_id,
            ne.numero AS nota_empenho_numero,
            rm.material, rm.prazo_entrega, rm.situacao, rm.ano_referencia,
            rm.data_cadastramento, rm.usuario_cadastramento_uuid,
            rm.data_modificacao, rm.usuario_modificacao_uuid
     FROM orcamento.recebimento_material AS rm
     INNER JOIN orcamento.nota_empenho AS ne ON ne.id = rm.nota_empenho_id
     WHERE rm.id = $<id>`,
    { id }
  )

  if (!rm) {
    throw new AppError('Recebimento de material nao encontrado', httpCode.NotFound)
  }

  return rm
}

// As tres ganharam TRANSACAO em 2026-08-02, com a rastreabilidade.
controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn
    .tx(async t => {
      const criado = await t.one(
        `INSERT INTO orcamento.recebimento_material
          (nota_empenho_id, material, prazo_entrega, situacao, ano_referencia,
           usuario_cadastramento_uuid)
         VALUES
          ($<notaEmpenhoId>, $<material>, $<prazoEntrega>, $<situacao>, $<anoReferencia>,
           $<usuarioUuid>)
         RETURNING *`,
        {
          notaEmpenhoId: dados.nota_empenho_id,
          material: dados.material,
          prazoEntrega: dados.prazo_entrega || null,
          situacao: dados.situacao || null,
          anoReferencia: dados.ano_referencia != null ? dados.ano_referencia : null,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.recebimento_material',
        registroId: criado.id,
        operacao: 'I',
        depois: criado,
        usuarioUuid,
        contexto
      })

      return { id: criado.id }
    })
    .catch(tratarFk)
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn
    .tx(async t => {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'orcamento.recebimento_material',
        id,
        'Recebimento de material'
      )

      const depois = await t.one(
        `UPDATE orcamento.recebimento_material SET
           nota_empenho_id = $<notaEmpenhoId>, material = $<material>,
           prazo_entrega = $<prazoEntrega>, situacao = $<situacao>,
           ano_referencia = $<anoReferencia>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          id,
          notaEmpenhoId: dados.nota_empenho_id,
          material: dados.material,
          prazoEntrega: dados.prazo_entrega || null,
          situacao: dados.situacao || null,
          anoReferencia: dados.ano_referencia != null ? dados.ano_referencia : null,
          dataModificacao: new Date(),
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.recebimento_material',
        registroId: id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })

      return { id: depois.id }
    })
    .catch(tratarFk)
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'orcamento.recebimento_material',
      id,
      'Recebimento de material'
    )

    await t.none('DELETE FROM orcamento.recebimento_material WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.recebimento_material',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
