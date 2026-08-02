'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// Codigo SQLSTATE do PostgreSQL para violacao de chave estrangeira.
// Usado para traduzir o erro cru do banco numa mensagem amigavel (400),
// por exemplo quando tipo_id nao existe em dominio.tipo_licitacao.
const FK_VIOLATION = '23503'

// Mapa de coluna citada no detalhe do erro -> mensagem amigavel. A constraint
// exata depende do nome gerado pelo banco; por isso casamos pela coluna citada
// em err.detail, que e estavel ("Key (coluna)=...").
const mensagemFk = err => {
  const detalhe = (err && err.detail) || ''
  if (detalhe.includes('(tipo_id)')) {
    return 'O tipo de licitacao informado nao existe'
  }
  return 'Referencia invalida em um dos campos da licitacao'
}

// Reembrulha violacao de FK como AppError 400 (amigavel); demais erros sobem.
const tratarFk = err => {
  if (err && err.code === FK_VIOLATION) {
    throw new AppError(mensagemFk(err), httpCode.BadRequest, err)
  }
  throw err
}

controller.listar = async (filtros = {}) => {
  // Lista as licitacoes com o nome do tipo (JOIN dominio.tipo_licitacao).
  // Filtros opcionais por ano e tipo_id. Ordenado por ano e id.
  return db.conn.any(
    `SELECT li.id, li.ano,
            li.tipo_id,
            tl.nome AS tipo_nome,
            li.objeto, li.fase_atual,
            li.valor_total_estimado, li.valor_final_homologado,
            li.om_gestora
     FROM orcamento.licitacao AS li
     INNER JOIN dominio.tipo_licitacao AS tl ON tl.code = li.tipo_id
     WHERE ($<ano> IS NULL OR li.ano = $<ano>)
       AND ($<tipoId> IS NULL OR li.tipo_id = $<tipoId>)
     ORDER BY li.ano DESC, li.id`,
    {
      ano: filtros.ano != null ? filtros.ano : null,
      tipoId: filtros.tipo_id != null ? filtros.tipo_id : null
    }
  )
}

controller.getPorId = async id => {
  // Uma licitacao com o nome do tipo resolvido.
  const licitacao = await db.conn.oneOrNone(
    `SELECT li.id, li.ano,
            li.tipo_id,
            tl.nome AS tipo_nome,
            li.objeto, li.fase_atual,
            li.valor_total_estimado, li.valor_final_homologado,
            li.om_gestora,
            li.data_cadastramento, li.usuario_cadastramento_uuid,
            li.data_modificacao, li.usuario_modificacao_uuid
     FROM orcamento.licitacao AS li
     INNER JOIN dominio.tipo_licitacao AS tl ON tl.code = li.tipo_id
     WHERE li.id = $<id>`,
    { id }
  )

  if (!licitacao) {
    throw new AppError('Licitacao nao encontrada', httpCode.NotFound)
  }

  return licitacao
}

// As tres funcoes de escrita GANHARAM TRANSACAO em 2026-08-02, com a
// rastreabilidade: a linha do rastro cai junto com a mudanca ou nao cai.
controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn
    .tx(async t => {
      const criada = await t.one(
        `INSERT INTO orcamento.licitacao
          (ano, tipo_id, objeto, fase_atual,
           valor_total_estimado, valor_final_homologado, om_gestora,
           usuario_cadastramento_uuid)
         VALUES
          ($<ano>, $<tipoId>, $<objeto>, $<faseAtual>,
           $<valorTotalEstimado>, $<valorFinalHomologado>, $<omGestora>,
           $<usuarioUuid>)
         RETURNING *`,
        {
          ano: dados.ano,
          tipoId: dados.tipo_id,
          objeto: dados.objeto,
          faseAtual: dados.fase_atual || null,
          valorTotalEstimado:
            dados.valor_total_estimado != null ? dados.valor_total_estimado : null,
          valorFinalHomologado:
            dados.valor_final_homologado != null
              ? dados.valor_final_homologado
              : null,
          omGestora: dados.om_gestora || null,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.licitacao',
        registroId: criada.id,
        operacao: 'I',
        depois: criada,
        usuarioUuid,
        contexto
      })

      // O `RETURNING *` e do rastro; a rota continua devolvendo so o id.
      return { id: criada.id }
    })
    .catch(tratarFk)
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn
    .tx(async t => {
      // Era um `SELECT id` fora de transacao, so para o 404. `lerAntes` faz as
      // duas coisas pelo mesmo custo, e agora dentro da transacao que altera a
      // linha: le-la fora deixaria uma janela em que outra requisicao a muda no
      // meio, e o `dados_antes` descreveria um estado que ninguem viu.
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'orcamento.licitacao',
        id,
        'Licitação'
      )

      const depois = await t.one(
        `UPDATE orcamento.licitacao SET
           ano = $<ano>, tipo_id = $<tipoId>,
           objeto = $<objeto>, fase_atual = $<faseAtual>,
           valor_total_estimado = $<valorTotalEstimado>,
           valor_final_homologado = $<valorFinalHomologado>,
           om_gestora = $<omGestora>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          id,
          ano: dados.ano,
          tipoId: dados.tipo_id,
          objeto: dados.objeto,
          faseAtual: dados.fase_atual || null,
          valorTotalEstimado:
            dados.valor_total_estimado != null ? dados.valor_total_estimado : null,
          valorFinalHomologado:
            dados.valor_final_homologado != null
              ? dados.valor_final_homologado
              : null,
          omGestora: dados.om_gestora || null,
          dataModificacao: new Date(),
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.licitacao',
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
      'orcamento.licitacao',
      id,
      'Licitação'
    )

    await t.none('DELETE FROM orcamento.licitacao WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.licitacao',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
