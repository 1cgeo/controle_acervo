'use strict'

const { db } = require('../../database')
const { preserveOmitted } = require('../utils')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')

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

// Configuracao geral (linha unica id=1).
//
// SEM `ano_referencia`: nao ha ano padrao do modulo, e cada tela tem o proprio
// filtro, sempre no ano atual. A coluna segue no banco, orfa, e o DROP vai em
// migracao propria. Nao confundir com
// `orcamento.recebimento_material.ano_referencia`, que diz em que RPCMTec o
// material consta e permanece em uso.
//
// O NOME de quem alterou vem junto do uuid, porque a tela precisa dizer
// "Alterado em DD/MM/AAAA por Fulano". LEFT JOIN porque a linha nasce no DDL sem
// autor, e porque a pessoa pode ter sido apagada depois.
controller.get = async () => {
  return db.conn.one(
    `SELECT c.id, c.uasg, c.codom,
            c.data_modificacao, c.usuario_modificacao_uuid,
            u.nome AS usuario_modificacao
     FROM orcamento.configuracao AS c
     LEFT JOIN dgeo.usuario AS u ON u.uuid = c.usuario_modificacao_uuid
     WHERE c.id = 1`
  )
}

// Singleton (`CHECK (id = 1)`): a linha nasce no DDL e aqui so ha UPDATE.
//
// A TRANSACAO e obrigatoria: a linha do rastro tem de cair JUNTO com a mudanca
// que ela descreve, ou nao cair.
//
// CHAVE AUSENTE PRESERVA, e `null` explicito limpa. E a semantica de PUT de toda
// a casa (`utils/preserve_omitted.js`), e aqui ela faltava: o `!= null` antigo
// nao distinguia "nao mandei o campo" de "mandei nulo", e os dois viravam NULL.
// Quem enviasse so `{uasg}` apagava o `codom` gravado, com 200 e sem aviso.
//
// A conta e no lugar CERTO: o formulario de hoje tem dois campos e manda os
// dois juntos, entao a troca nao muda nada agora. Ela existe para o dia em que
// um terceiro campo entrar na tabela, ou em que um CLI mandar so um campo.
controller.atualizar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'orcamento.configuracao',
      1,
      'Configuração'
    )

    // Le da MESMA transacao o valor gravado de quem o corpo omitiu, e o escreve
    // em `dados` antes do UPDATE. Nao ha `.default()` nos dois campos do
    // `configuracao_schema`, que e o pre-requisito da funcao.
    const corpo = { ...dados }
    await preserveOmitted(t, {
      schema: 'orcamento',
      table: 'configuracao',
      id: 1,
      fields: ['uasg', 'codom'],
      body: corpo
    })

    const depois = await t.one(
      `UPDATE orcamento.configuracao SET
         uasg = $<uasg>, codom = $<codom>,
         data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = 1
       RETURNING *`,
      {
        uasg: corpo.uasg != null ? corpo.uasg : null,
        codom: corpo.codom != null ? corpo.codom : null,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.configuracao',
      registroId: 1,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    // O `RETURNING *` existe para o rastro (os dois lados do diff saem do
    // BANCO), e a ROTA devolve so os campos de negocio: o carimbo de
    // escrituracao nao e resposta de API, e o `ano_referencia` saiu.
    return {
      id: depois.id,
      uasg: depois.uasg,
      codom: depois.codom
    }
  })
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
