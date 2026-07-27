// Path: orcamento\configuracao\configuracao_ctrl.js
'use strict'

const { db } = require('../../database')

const controller = {}

// Tabelas que carregam o campo `ano`, usadas para listar os anos com dado.
const TABELAS_ANO = [
  'orcamento.meta_pit',
  'orcamento.dfd',
  'orcamento.pdr_item',
  'orcamento.nota_credito',
  'orcamento.nota_empenho',
  'orcamento.licitacao',
  'orcamento.rpnp',
  'orcamento.relatorio_rpcmtec'
]

// Configuracao geral (linha unica id=1). Se ano_referencia estiver vazio,
// devolve o ano corrente como default.
controller.get = async () => {
  const cfg = await db.conn.one(
    `SELECT id, uasg, codom, ano_referencia,
            data_modificacao, usuario_modificacao_uuid
     FROM orcamento.configuracao WHERE id = 1`
  )
  if (cfg.ano_referencia == null) {
    cfg.ano_referencia = new Date().getFullYear()
  }
  return cfg
}

controller.atualizar = async (dados, usuarioUuid) => {
  return db.conn.one(
    `UPDATE orcamento.configuracao SET
       uasg = $<uasg>, codom = $<codom>, ano_referencia = $<anoReferencia>,
       data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
     WHERE id = 1
     RETURNING id, uasg, codom, ano_referencia`,
    {
      uasg: dados.uasg != null ? dados.uasg : null,
      codom: dados.codom != null ? dados.codom : null,
      anoReferencia: dados.ano_referencia != null ? dados.ano_referencia : null,
      dataModificacao: new Date(),
      usuarioUuid
    }
  )
}

// Lista os anos distintos que tem dado (qualquer tabela do schema), em ordem
// decrescente. Garante a presenca do ano corrente, para o seletor nunca ficar
// vazio num sistema recem-criado.
controller.getAnos = async () => {
  const union = TABELAS_ANO.map(t => `SELECT ano FROM ${t}`).join(' UNION ')
  const linhas = await db.conn.any(
    `SELECT DISTINCT ano FROM (${union}) AS t WHERE ano IS NOT NULL ORDER BY ano DESC`
  )
  const anos = linhas.map(l => l.ano)
  const atual = new Date().getFullYear()
  if (!anos.includes(atual)) {
    anos.unshift(atual)
    anos.sort((a, b) => b - a)
  }
  return anos
}

module.exports = controller
