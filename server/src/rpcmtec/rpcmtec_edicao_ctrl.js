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

// E o relatorio que o chefe assina: quem trocou o assinante ou a data de
// assinatura de uma edicao e pergunta que se faz depois de o documento ter
// saido, e ate 2026-08-02 nao havia onde responde-la.
const { auditoriaCtrl } = require('../auditoria')

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

// As TRES funcoes de escrita ganharam transacao em 2026-08-02. Nenhuma tinha, e
// a de exclusao chegava a fazer dois comandos em duas conexoes diferentes. O
// rastro tem de cair JUNTO com a mudanca que ele descreve, ou nao cair: com
// conexao propria, um erro depois do INSERT deixaria para tras o registro de uma
// alteracao que nunca aconteceu.
controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criada = await t
      .one(
        `INSERT INTO rpcmtec.edicao
           (ano, mes, assinante, data_assinatura, usuario_cadastramento_uuid)
         VALUES ($<ano>, $<mes>, $<assinante>, $<dataAssinatura>, $<usuarioUuid>)
         RETURNING *`,
        {
          ano: dados.ano,
          mes: dados.mes,
          assinante: dados.assinante || null,
          dataAssinatura: dados.data_assinatura || null,
          usuarioUuid
        }
      )
      .catch(tratarErroEdicao)

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.edicao',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    // A rota continua devolvendo so o id: o RETURNING * e do rastro.
    return { id: criada.id }
  })
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Substitui o `exigirExistente`, que era um `SELECT id` numa conexao propria
    // so para produzir o 404: agora a linha inteira sai pelo mesmo custo, dentro
    // da transacao, e vira o `dados_antes`.
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.edicao', id, 'Edição do RPCMTec'
    )

    const depois = await t
      .one(
        `UPDATE rpcmtec.edicao SET
           ano = $<ano>, mes = $<mes>, assinante = $<assinante>,
           data_assinatura = $<dataAssinatura>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
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

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.edicao',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { id: depois.id }
  })
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.edicao', id, 'Edição do RPCMTec'
    )

    await t.none('DELETE FROM rpcmtec.edicao WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.edicao',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
