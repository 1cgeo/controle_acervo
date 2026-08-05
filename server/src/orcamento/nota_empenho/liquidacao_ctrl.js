'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// Codigo SQLSTATE do PostgreSQL para violacao de chave estrangeira.
const FK_VIOLATION = '23503'

// Carrega a NE dentro da transacao e devolve o valor disponivel para liquidar
// (valor_empenhado - valor_anulado) mais o total ja liquidado, opcionalmente
// ignorando uma liquidacao (no UPDATE, para nao contar a propria duas vezes).
const carregarDisponivel = async (t, notaEmpenhoId, ignorarLiquidacaoId) => {
  const ne = await t.oneOrNone(
    `SELECT valor_empenhado, valor_anulado
     FROM orcamento.nota_empenho
     WHERE id = $<notaEmpenhoId>`,
    { notaEmpenhoId }
  )
  if (!ne) {
    throw new AppError('Nota de empenho nao encontrada', httpCode.NotFound)
  }

  const liquidado = await t.one(
    `SELECT COALESCE(SUM(valor_liquidado), 0) AS total
     FROM orcamento.liquidacao
     WHERE nota_empenho_id = $<notaEmpenhoId>
       AND ($<ignorarLiquidacaoId> IS NULL OR id <> $<ignorarLiquidacaoId>)`,
    {
      notaEmpenhoId,
      ignorarLiquidacaoId:
        ignorarLiquidacaoId != null ? ignorarLiquidacaoId : null
    }
  )

  return {
    disponivel: Number(ne.valor_empenhado) - Number(ne.valor_anulado),
    totalOutras: Number(liquidado.total)
  }
}

controller.listar = async (filtros = {}) => {
  // Lista as liquidacoes, opcionalmente filtradas por nota de empenho.
  // Traz o numero da NE para contexto. Ordenado por data.
  //
  // A data de cadastro e o nome de quem lancou entram aqui porque a ficha da NE
  // consome ESTA rota, e nao a `getPorId`. As colunas ja existiam na tabela e
  // so o `getPorId` as lia: quem olhava a ficha nao tinha como saber quando um
  // valor foi lancado nem por quem.
  return db.conn.any(
    `SELECT li.id, li.nota_empenho_id,
            ne.numero AS nota_empenho_numero,
            li.valor_liquidado, li.data, li.documento_ns,
            li.data_cadastramento,
            u.nome AS usuario_cadastramento_nome
     FROM orcamento.liquidacao AS li
     INNER JOIN orcamento.nota_empenho AS ne ON ne.id = li.nota_empenho_id
     LEFT JOIN dgeo.usuario AS u ON u.uuid = li.usuario_cadastramento_uuid
     WHERE ($<notaEmpenhoId> IS NULL OR li.nota_empenho_id = $<notaEmpenhoId>)
     ORDER BY li.data, li.id`,
    {
      notaEmpenhoId:
        filtros.nota_empenho_id != null ? filtros.nota_empenho_id : null
    }
  )
}

controller.getPorId = async id => {
  const li = await db.conn.oneOrNone(
    `SELECT li.id, li.nota_empenho_id,
            ne.numero AS nota_empenho_numero,
            li.valor_liquidado, li.data, li.documento_ns,
            li.data_cadastramento, li.usuario_cadastramento_uuid,
            li.data_modificacao, li.usuario_modificacao_uuid
     FROM orcamento.liquidacao AS li
     INNER JOIN orcamento.nota_empenho AS ne ON ne.id = li.nota_empenho_id
     WHERE li.id = $<id>`,
    { id }
  )

  if (!li) {
    throw new AppError('Liquidacao nao encontrada', httpCode.NotFound)
  }

  return li
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  // Transacao: valida que a soma das liquidacoes (incluindo esta) nao excede
  // o valor empenhado disponivel, e so entao insere.
  return db.conn
    .tx(async t => {
      const { disponivel, totalOutras } = await carregarDisponivel(
        t,
        dados.nota_empenho_id,
        null
      )

      if (totalOutras + Number(dados.valor_liquidado) > disponivel) {
        throw new AppError(
          'Liquidação excede o valor empenhado disponível',
          httpCode.BadRequest
        )
      }

      const criada = await t.one(
        `INSERT INTO orcamento.liquidacao
          (nota_empenho_id, valor_liquidado, data, documento_ns,
           usuario_cadastramento_uuid)
         VALUES
          ($<notaEmpenhoId>, $<valorLiquidado>, $<data>, $<documentoNs>,
           $<usuarioUuid>)
         RETURNING *`,
        {
          notaEmpenhoId: dados.nota_empenho_id,
          valorLiquidado: dados.valor_liquidado,
          data: dados.data || null,
          documentoNs: dados.documento_ns || null,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.liquidacao',
        registroId: criada.id,
        operacao: 'I',
        depois: criada,
        usuarioUuid,
        contexto
      })

      return { id: criada.id }
    })
    .catch(err => {
      if (err && err.code === FK_VIOLATION) {
        throw new AppError(
          'A nota de empenho informada nao existe',
          httpCode.BadRequest,
          err
        )
      }
      throw err
    })
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  // Transacao: valida o saldo desconsiderando a propria liquidacao, e atualiza.
  return db.conn
    .tx(async t => {
      // `lerAntes` no lugar do `SELECT id`: mesma ida ao banco, mesmo 404, e o
      // estado anterior deixa de se perder. Numa tabela em que o campo que muda
      // e um VALOR, "de quanto para quanto" e a pergunta inteira.
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'orcamento.liquidacao',
        id,
        'Liquidação'
      )

      const { disponivel, totalOutras } = await carregarDisponivel(
        t,
        dados.nota_empenho_id,
        id
      )

      if (totalOutras + Number(dados.valor_liquidado) > disponivel) {
        throw new AppError(
          'Liquidação excede o valor empenhado disponível',
          httpCode.BadRequest
        )
      }

      const depois = await t.one(
        `UPDATE orcamento.liquidacao SET
           nota_empenho_id = $<notaEmpenhoId>,
           valor_liquidado = $<valorLiquidado>,
           data = $<data>, documento_ns = $<documentoNs>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          id,
          notaEmpenhoId: dados.nota_empenho_id,
          valorLiquidado: dados.valor_liquidado,
          data: dados.data || null,
          documentoNs: dados.documento_ns || null,
          dataModificacao: new Date(),
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.liquidacao',
        registroId: id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })

      return { id: depois.id }
    })
    .catch(err => {
      if (err && err.code === FK_VIOLATION) {
        throw new AppError(
          'A nota de empenho informada nao existe',
          httpCode.BadRequest,
          err
        )
      }
      throw err
    })
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'orcamento.liquidacao',
      id,
      'Liquidação'
    )

    await t.none('DELETE FROM orcamento.liquidacao WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.liquidacao',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
