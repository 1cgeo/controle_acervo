'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// Codigo SQLSTATE do PostgreSQL para violacao de chave estrangeira. Aqui o caso
// possivel e nota_empenho_id apontando para uma NE inexistente.
const FK_VIOLATION = '23503'

const tratarFk = err => {
  if (err && err.code === FK_VIOLATION) {
    const detalhe = (err && err.detail) || ''
    const msg = detalhe.includes('(nota_empenho_id)')
      ? 'A nota de empenho informada nao existe'
      : 'Referencia invalida em um dos campos do RPNP'
    throw new AppError(msg, httpCode.BadRequest, err)
  }
  throw err
}

controller.listar = async (filtros = {}) => {
  // Lista os RPNP (restos a pagar nao processados) do ano. Quando a nota de
  // empenho esta cadastrada, traz o numero dela; senao usa o empenho_label livre.
  return db.conn.any(
    `SELECT rp.id, rp.ano, rp.nota_empenho_id,
            ne.numero AS nota_empenho_numero,
            rp.empenho_label, rp.finalidade,
            rp.valor_empenhado, rp.valor_a_liquidar
     FROM orcamento.rpnp AS rp
     LEFT JOIN orcamento.nota_empenho AS ne ON ne.id = rp.nota_empenho_id
     WHERE ($<ano> IS NULL OR rp.ano = $<ano>)
     ORDER BY rp.ano DESC, rp.id`,
    { ano: filtros.ano != null ? filtros.ano : null }
  )
}

controller.getPorId = async id => {
  const rpnp = await db.conn.oneOrNone(
    `SELECT rp.id, rp.ano, rp.nota_empenho_id,
            ne.numero AS nota_empenho_numero,
            rp.empenho_label, rp.finalidade,
            rp.valor_empenhado, rp.valor_a_liquidar,
            rp.data_cadastramento, rp.usuario_cadastramento_uuid,
            rp.data_modificacao, rp.usuario_modificacao_uuid
     FROM orcamento.rpnp AS rp
     LEFT JOIN orcamento.nota_empenho AS ne ON ne.id = rp.nota_empenho_id
     WHERE rp.id = $<id>`,
    { id }
  )

  if (!rpnp) {
    throw new AppError('RPNP nao encontrado', httpCode.NotFound)
  }

  return rpnp
}

// As tres ganharam TRANSACAO em 2026-08-02, com a rastreabilidade.
controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn
    .tx(async t => {
      const criado = await t.one(
        `INSERT INTO orcamento.rpnp
          (ano, nota_empenho_id, empenho_label, finalidade,
           valor_empenhado, valor_a_liquidar, usuario_cadastramento_uuid)
         VALUES
          ($<ano>, $<notaEmpenhoId>, $<empenhoLabel>, $<finalidade>,
           $<valorEmpenhado>, $<valorALiquidar>, $<usuarioUuid>)
         RETURNING *`,
        {
          ano: dados.ano,
          notaEmpenhoId: dados.nota_empenho_id != null ? dados.nota_empenho_id : null,
          empenhoLabel: dados.empenho_label || null,
          finalidade: dados.finalidade || null,
          valorEmpenhado: dados.valor_empenhado != null ? dados.valor_empenhado : null,
          valorALiquidar: dados.valor_a_liquidar != null ? dados.valor_a_liquidar : null,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.rpnp',
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
      const antes = await auditoriaCtrl.lerAntes(t, 'orcamento.rpnp', id, 'RPNP')

      const depois = await t.one(
        `UPDATE orcamento.rpnp SET
           ano = $<ano>, nota_empenho_id = $<notaEmpenhoId>,
           empenho_label = $<empenhoLabel>, finalidade = $<finalidade>,
           valor_empenhado = $<valorEmpenhado>, valor_a_liquidar = $<valorALiquidar>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          id,
          ano: dados.ano,
          notaEmpenhoId: dados.nota_empenho_id != null ? dados.nota_empenho_id : null,
          empenhoLabel: dados.empenho_label || null,
          finalidade: dados.finalidade || null,
          valorEmpenhado: dados.valor_empenhado != null ? dados.valor_empenhado : null,
          valorALiquidar: dados.valor_a_liquidar != null ? dados.valor_a_liquidar : null,
          dataModificacao: new Date(),
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.rpnp',
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
    const antes = await auditoriaCtrl.lerAntes(t, 'orcamento.rpnp', id, 'RPNP')

    await t.none('DELETE FROM orcamento.rpnp WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.rpnp',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
