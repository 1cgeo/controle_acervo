'use strict'

const { db } = require('../../database')

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
  'orcamento.relatorio_rpcmtec'
]

// Configuracao geral (linha unica id=1).
//
// O `ano_referencia` SAIU em 2026-08-04 (chefe). Ele era o ano padrao de todas
// as telas do modulo, e cada tela agora tem o seu filtro, sempre no ano atual.
// A COLUNA continua no banco, e o DROP vai em migracao propria: o codigo apenas
// parou de ler e de gravar. Nao confundir com
// `orcamento.recebimento_material.ano_referencia`, que diz em que RPCMTec o
// material consta e permanece em uso.
//
// O NOME de quem alterou vem junto desde 2026-08-04. A rota ja devolvia
// `usuario_modificacao_uuid`, e UUID cru nao serve a ninguem: a tela precisa
// dizer "Alterado em DD/MM/AAAA por Fulano". LEFT JOIN porque a linha nasce no
// DDL sem autor, e porque a pessoa pode ter sido apagada depois.
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
// GANHOU TRANSACAO em 2026-08-02, com a rastreabilidade. A linha do rastro tem
// de cair JUNTO com a mudanca que ela descreve, ou nao cair: com conexao
// propria, um erro depois do UPDATE deixaria para tras o registro de uma
// alteracao que nao aconteceu.
controller.atualizar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'orcamento.configuracao',
      1,
      'Configuração'
    )

    const depois = await t.one(
      `UPDATE orcamento.configuracao SET
         uasg = $<uasg>, codom = $<codom>,
         data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = 1
       RETURNING *`,
      {
        uasg: dados.uasg != null ? dados.uasg : null,
        codom: dados.codom != null ? dados.codom : null,
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
