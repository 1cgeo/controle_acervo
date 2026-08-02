'use strict'

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

// As metas do ano alimentam o RPCMTec e sao apontadas pelo PDR, pela NC e pelo
// pedido de impressao: mudar uma meta muda o que os tres modulos contam.
const { auditoriaCtrl } = require('../auditoria')

const controller = {}

const colunas = `id, ano, numero_meta, item, descricao,
  data_cadastramento, usuario_cadastramento_uuid, data_modificacao, usuario_modificacao_uuid`

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas}
       FROM pit.meta
       WHERE ano = $<ano>
       ORDER BY numero_meta, item`,
      { ano }
    )
  }

  return db.conn.any(
    `SELECT ${colunas}
     FROM pit.meta
     ORDER BY ano DESC, numero_meta, item`
  )
}

// Os anos que TEM meta cadastrada. A tela de metas e de plataforma e nao tem o
// seletor de ano da navbar do orcamento, entao monta o proprio filtro a partir
// desta lista, em vez de adivinhar um intervalo.
controller.anos = async () => {
  const linhas = await db.conn.any(
    'SELECT DISTINCT ano FROM pit.meta ORDER BY ano DESC'
  )
  return linhas.map(l => l.ano)
}

controller.getPorId = async id => {
  return db.conn.oneOrNone(
    `SELECT ${colunas}
     FROM pit.meta
     WHERE id = $<id>`,
    { id }
  )
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // RETURNING *, e nao `RETURNING id`: a linha gravada e o `dados_depois`, e o
    // que se audita e o que o banco GRAVOU.
    const criada = await t.one(
      `INSERT INTO pit.meta
         (ano, numero_meta, item, descricao, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<numero_meta>, $<item>, $<descricao>, $<usuarioUuid>)
       RETURNING *`,
      {
        ano: dados.ano,
        numero_meta: dados.numero_meta,
        item: dados.item,
        descricao: dados.descricao,
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    // A rota continua devolvendo so o id, como antes: o RETURNING * e do rastro.
    return { id: criada.id }
  })
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Substitui o `SELECT id`, que existia so para o 404: a linha inteira sai
    // pela mesma ida ao banco e vira o `dados_antes`.
    const antes = await auditoriaCtrl.lerAntes(t, 'pit.meta', id, 'Meta do PIT')

    const depois = await t.one(
      `UPDATE pit.meta
       SET ano = $<ano>, numero_meta = $<numero_meta>, item = $<item>,
           descricao = $<descricao>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      {
        id,
        ano: dados.ano,
        numero_meta: dados.numero_meta,
        item: dados.item,
        descricao: dados.descricao,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta',
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

// Ganhou TRANSACAO, e nao so por causa do rastro: eram tres comandos em tres
// conexoes diferentes (o `SELECT id`, a contagem de dependentes e o DELETE), e
// entre a contagem e o DELETE cabia o cadastro de um pedido apontando esta meta.
controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'pit.meta', id, 'Meta do PIT')

    // Bloqueia a exclusao quando algum consumidor aponta para esta meta. Os tres
    // vivem em schemas diferentes, e a lista cresce quando um modulo novo passar a
    // amarrar trabalho ao PIT. Sem isto o erro chegaria como 500 do banco (FK).
    const dependentes = await t.one(
      `SELECT
         (SELECT COUNT(*) FROM orcamento.pdr_item WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM orcamento.nota_credito WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM mapoteca.pedido WHERE meta_pit_id = $<id>) AS n`,
      { id }
    )
    if (parseInt(dependentes.n, 10) > 0) {
      throw new AppError(
        'Meta do PIT possui registros vinculados e não pode ser excluída',
        httpCode.Conflict
      )
    }

    await t.none('DELETE FROM pit.meta WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
