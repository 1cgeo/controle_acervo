'use strict'

const { db } = require('../../database')

const { AppError, httpCode } = require('../utils')

const controller = {}

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'

// Codigo duplicado na criacao vira 409 amigavel.
const tratarCriar = err => {
  if (err && err.code === UNIQUE_VIOLATION) {
    throw new AppError('Já existe um registro com este código', httpCode.Conflict, err)
  }
  throw err
}

// Tentar excluir um codigo em uso (FK de NC/NE/PDR) vira 409 amigavel.
const tratarDeletar = err => {
  if (err && err.code === FK_VIOLATION) {
    throw new AppError('Não é possível excluir: há lançamentos vinculados a este código', httpCode.Conflict, err)
  }
  throw err
}

controller.getTipoPostoGrad = async () => {
  return db.conn.any('SELECT code, nome, nome_abrev FROM dominio.tipo_posto_grad ORDER BY code')
}

controller.getNaturezaDespesa = async () => {
  return db.conn.any('SELECT code, nome, gnd, grupo FROM dominio.natureza_despesa ORDER BY code')
}

controller.getPlanoInterno = async () => {
  return db.conn.any('SELECT code, nome, alinea FROM dominio.plano_interno ORDER BY code')
}

controller.getUg = async () => {
  return db.conn.any('SELECT code, nome FROM dominio.ug ORDER BY code')
}

controller.getTipoLicitacao = async () => {
  return db.conn.any('SELECT code, nome FROM dominio.tipo_licitacao ORDER BY code')
}

controller.getClassificacaoNc = async () => {
  return db.conn.any('SELECT code, nome FROM dominio.classificacao_nc ORDER BY code')
}

controller.getTipoItemDfd = async () => {
  return db.conn.any('SELECT code, nome FROM dominio.tipo_item_dfd ORDER BY code')
}

controller.getGrauPrioridade = async () => {
  return db.conn.any('SELECT code, nome FROM dominio.grau_prioridade ORDER BY code')
}

// ---------------------------------------------------------------------------
// CRUD dos dominios editaveis pela Configuracao: natureza de despesa, plano
// interno e UG emitente. O `code` e a chave (informado pelo usuario). Nao ha
// auditoria nessas tabelas de dominio.
// ---------------------------------------------------------------------------

// grupo (custeio/capital) e derivado do GND (3 = custeio, 4 = capital).
const grupoDoGnd = gnd => (Number(gnd) === 4 ? 'capital' : 'custeio')

controller.criarNaturezaDespesa = async ({ code, nome, gnd }) => {
  return db.conn
    .none(
      'INSERT INTO dominio.natureza_despesa (code, nome, gnd, grupo) VALUES ($<code>, $<nome>, $<gnd>, $<grupo>)',
      { code, nome, gnd, grupo: grupoDoGnd(gnd) }
    )
    .catch(tratarCriar)
}

controller.atualizarNaturezaDespesa = async (code, { nome, gnd }) => {
  const r = await db.conn.result(
    'UPDATE dominio.natureza_despesa SET nome = $<nome>, gnd = $<gnd>, grupo = $<grupo> WHERE code = $<code>',
    { code, nome, gnd, grupo: grupoDoGnd(gnd) }
  )
  if (!r.rowCount) throw new AppError('Natureza de despesa não encontrada', httpCode.NotFound)
}

controller.deletarNaturezaDespesa = async code => {
  const r = await db.conn
    .result('DELETE FROM dominio.natureza_despesa WHERE code = $<code>', { code })
    .catch(tratarDeletar)
  if (!r.rowCount) throw new AppError('Natureza de despesa não encontrada', httpCode.NotFound)
}

controller.criarPlanoInterno = async ({ code, nome, alinea }) => {
  return db.conn
    .none(
      'INSERT INTO dominio.plano_interno (code, nome, alinea) VALUES ($<code>, $<nome>, $<alinea>)',
      { code, nome, alinea: alinea || null }
    )
    .catch(tratarCriar)
}

controller.atualizarPlanoInterno = async (code, { nome, alinea }) => {
  const r = await db.conn.result(
    'UPDATE dominio.plano_interno SET nome = $<nome>, alinea = $<alinea> WHERE code = $<code>',
    { code, nome, alinea: alinea || null }
  )
  if (!r.rowCount) throw new AppError('Plano interno não encontrado', httpCode.NotFound)
}

controller.deletarPlanoInterno = async code => {
  const r = await db.conn
    .result('DELETE FROM dominio.plano_interno WHERE code = $<code>', { code })
    .catch(tratarDeletar)
  if (!r.rowCount) throw new AppError('Plano interno não encontrado', httpCode.NotFound)
}

controller.criarUg = async ({ code, nome }) => {
  return db.conn
    .none('INSERT INTO dominio.ug (code, nome) VALUES ($<code>, $<nome>)', { code, nome })
    .catch(tratarCriar)
}

controller.atualizarUg = async (code, { nome }) => {
  const r = await db.conn.result(
    'UPDATE dominio.ug SET nome = $<nome> WHERE code = $<code>',
    { code, nome }
  )
  if (!r.rowCount) throw new AppError('Unidade gestora não encontrada', httpCode.NotFound)
}

controller.deletarUg = async code => {
  const r = await db.conn
    .result('DELETE FROM dominio.ug WHERE code = $<code>', { code })
    .catch(tratarDeletar)
  if (!r.rowCount) throw new AppError('Unidade gestora não encontrada', httpCode.NotFound)
}

module.exports = controller
