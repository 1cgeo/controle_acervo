// Path: rpcmtec\rpcmtec_edicao_ctrl.js
'use strict'

// CRUD da edição mensal (`rpcmtec.edicao`): o metadado do relatório, quem
// assina e quando. As TABELAS do relatório não moram aqui nem em lugar nenhum:
// são consultas recortadas por ano e mês, montadas por `rpcmtec_ctrl.js` a cada
// pedido. Gravá-las faria a edição envelhecer em silêncio no primeiro pedido
// corrigido depois de fechada.
//
// Esteve em `orcamento/relatorio/relatorio_ctrl.js` até 2026-08-01, misturado
// com o gerador da seção do PDR. Ver migrations/2026-08-01_rpcmtec_schema_proprio.sql.

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')

const controller = {}

// SQLSTATE de violação de UNIQUE. Traduz o erro cru da constraint
// unique_edicao_ano_mes numa mensagem que diz o que houve.
const UNIQUE_VIOLATION = '23505'

const tratarErroEdicao = err => {
  if (err && err.code === UNIQUE_VIOLATION) {
    throw new AppError(
      'Já existe uma edição do RPCMTec para este ano e mês',
      httpCode.Conflict,
      err
    )
  }
  throw err
}

const CAMPOS = `id, ano, mes, assinante, data_assinatura,
                data_cadastramento, usuario_cadastramento_uuid,
                data_modificacao, usuario_modificacao_uuid`

const exigirExistente = async id => {
  const existente = await db.conn.oneOrNone(
    'SELECT id FROM rpcmtec.edicao WHERE id = $<id>', { id }
  )
  if (!existente) {
    throw new AppError('Edição do RPCMTec não encontrada', httpCode.NotFound)
  }
}

controller.listar = async (filtros = {}) => {
  return db.conn.any(
    `SELECT ${CAMPOS}
     FROM rpcmtec.edicao
     WHERE ($<ano> IS NULL OR ano = $<ano>)
     ORDER BY ano DESC, mes DESC`,
    { ano: filtros.ano != null ? filtros.ano : null }
  )
}

controller.getPorId = async id => {
  const edicao = await db.conn.oneOrNone(
    `SELECT ${CAMPOS} FROM rpcmtec.edicao WHERE id = $<id>`, { id }
  )
  if (!edicao) {
    throw new AppError('Edição do RPCMTec não encontrada', httpCode.NotFound)
  }
  return edicao
}

controller.criar = async (dados, usuarioUuid) => {
  return db.conn
    .one(
      `INSERT INTO rpcmtec.edicao
         (ano, mes, assinante, data_assinatura, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<mes>, $<assinante>, $<dataAssinatura>, $<usuarioUuid>)
       RETURNING id`,
      {
        ano: dados.ano,
        mes: dados.mes,
        assinante: dados.assinante || null,
        dataAssinatura: dados.data_assinatura || null,
        usuarioUuid
      }
    )
    .catch(tratarErroEdicao)
}

controller.atualizar = async (id, dados, usuarioUuid) => {
  await exigirExistente(id)

  return db.conn
    .one(
      `UPDATE rpcmtec.edicao SET
         ano = $<ano>, mes = $<mes>, assinante = $<assinante>,
         data_assinatura = $<dataAssinatura>,
         data_modificacao = $<dataModificacao>,
         usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING id`,
      {
        id,
        ano: dados.ano,
        mes: dados.mes,
        assinante: dados.assinante || null,
        dataAssinatura: dados.data_assinatura || null,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )
    .catch(tratarErroEdicao)
}

controller.deletar = async id => {
  await exigirExistente(id)
  return db.conn.none('DELETE FROM rpcmtec.edicao WHERE id = $<id>', { id })
}

module.exports = controller
