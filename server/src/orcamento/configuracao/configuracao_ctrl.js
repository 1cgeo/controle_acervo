'use strict'

const { db } = require('../../database')


const controller = {}

// Tabelas que carregam o campo `ano`, usadas para listar os anos com dado.
const TABELAS_ANO = [
  // pit.meta entra mesmo morando fora do schema: o filtro de ano das telas do
  // orcamento tem de oferecer o ano em que so existe meta cadastrada, que e o
  // primeiro registro de todo exercicio novo.
  'pit.meta',
  'orcamento.dfd',
  'orcamento.pdr_item',
  'orcamento.nota_credito',
  'orcamento.nota_empenho',
  'orcamento.licitacao',
  'orcamento.rpnp',
  // `rpcmtec.edicao` e a antiga `orcamento.relatorio_rpcmtec`, renomeada e
  // movida de schema pela migracao 2026-08-01. O nome velho ficou aqui e a
  // consulta passou a falhar inteira: um `SELECT` de tabela inexistente derruba
  // a UNION, e o seletor de ano de todas as telas do orcamento levava 500.
  'rpcmtec.edicao'
]

// SO SOBROU O `getAnos` NESTE MODULO, e o nome do diretorio ficou maior que
// ele. A tabela `orcamento.configuracao` foi podada em 2026-08-06: ela guardava
// `uasg` e `codom`, preenchidas, corretas e sem um unico leitor fora da propria
// tela. Ver migrations/2026-08-06_poda_configuracao_orcamento.sql.
//
// O `getAnos` NAO lia aquela tabela e por isso sobreviveu inteiro: ele varre o
// `ano` das tabelas de negocio e alimenta o seletor de ano de TODAS as telas do
// modulo. Mover o arquivo agora trocaria uma rota que 8 telas chamam por um
// nome mais bonito, e o nome nao vale a troca.

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
