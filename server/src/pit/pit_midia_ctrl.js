'use strict'

// O de-para da MIDIA impressa para a meta do PIT, por ano.
//
// POR QUE ELE EXISTE, e nao o `mapoteca.pedido.meta_pit_id`. Os dois campos
// respondem perguntas DIFERENTES.
//
// O campo do pedido diz "este pedido estava previsto no PIT, sob esta meta", e o
// CHECK `pedido_meta_pit_id_exige_previsto` deixa isso explicito: so quem marca
// `previsto_pit` e obrigado a dizer a meta, e a maioria dos pedidos nao marca.
//
// A meta 4 do RTM conta o que SAIU, e o que saiu esta no ITEM: a midia entregue,
// com a quantidade fornecida. Somar por `pedido.meta_pit_id` devolve uma fracao
// do que o relatorio publica.
//
// OS DOIS CAMPOS NAO SE SUBSTITUEM nem quando ambos existem: pedido planejado em
// tyvek e atendido em sulfite conta na meta do SULFITE, porque foi ele que saiu.
// O pedido guarda o prometido, o item guarda o entregue, e o de-para daqui serve
// ao segundo.
//
// POR QUE O ANO ESTA NA CHAVE. A numeracao do PIT e reescrita todo ano, entao a
// correlacao midia-meta nao se fixa no codigo, pelo mesmo motivo pelo qual
// `mapoteca.pedido` nao deriva a meta do material.
//
// A TABELA MORA NO SCHEMA `mapoteca` e a ROTA mora aqui. A tabela e da mapoteca
// porque a midia e dela, e a seta aponta do modulo para o `pit`, como todas as
// outras (`mapoteca.pedido`, `orcamento.pdr_item`, `acervo.versao`). A rota fica
// no PIT porque quem preenche isto e quem configura a meta, e nao quem atende
// pedido.
//
// ESCREVER e do administrador global, como o resto do PIT: errar aqui muda o
// numero que a 2.1 do RPCMTec e o EXEC_PIT do RTM publicam.

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

const colunas = `dm.id, dm.ano, dm.tipo_midia_id, tm.nome AS tipo_midia,
  dm.meta_pit_id, m.numero_meta, m.item AS meta_item, m.descricao AS meta_descricao,
  dm.data_cadastramento, dm.usuario_cadastramento_uuid,
  dm.data_modificacao, dm.usuario_modificacao_uuid`

const de = `FROM mapoteca.midia_meta_pit AS dm
  INNER JOIN mapoteca.tipo_midia AS tm ON tm.code = dm.tipo_midia_id
  INNER JOIN pit.meta_vigente AS m ON m.id = dm.meta_pit_id`

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas} ${de} WHERE dm.ano = $<ano> ORDER BY dm.tipo_midia_id`,
      { ano }
    )
  }
  return db.conn.any(`SELECT ${colunas} ${de} ORDER BY dm.ano DESC, dm.tipo_midia_id`)
}

// O `ano` do de-para tem de ser o MESMO da meta. Sao duas colunas dizendo a
// mesma coisa, e a duplicata existe porque a restricao unica (ano, midia) nao
// enxerga coluna de outra tabela. Sem esta conferencia, alguem mapearia a midia
// de 2027 para uma meta de 2026 e a soma cairia no ano errado, sem nada acusar.
const conferirAno = async (t, ano, metaPitId) => {
  const meta = await t.oneOrNone(
    'SELECT ano, item, numero_meta FROM pit.meta WHERE id = $<metaPitId>',
    { metaPitId }
  )
  if (!meta) {
    throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
  }
  if (meta.ano !== ano) {
    throw new AppError(
      `A meta ${meta.numero_meta}${meta.item ? `.${meta.item}` : ''} é de ${meta.ano}, e o de-para é de ${ano}`,
      httpCode.BadRequest
    )
  }
  return meta
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    await conferirAno(t, dados.ano, dados.meta_pit_id)

    // Espelha a UNIQUE (ano, tipo_midia_id) com erro legivel: sem isto o
    // conflito chega como 500 do banco.
    const existente = await t.oneOrNone(
      `SELECT dm.id, m.item FROM mapoteca.midia_meta_pit AS dm
       INNER JOIN pit.meta_vigente AS m ON m.id = dm.meta_pit_id
       WHERE dm.ano = $<ano> AND dm.tipo_midia_id = $<tipoMidiaId>`,
      { ano: dados.ano, tipoMidiaId: dados.tipo_midia_id }
    )
    if (existente) {
      throw new AppError(
        `Esta mídia já aponta a meta ${existente.item || ''} em ${dados.ano}`,
        httpCode.Conflict
      )
    }

    const criada = await t.one(
      `INSERT INTO mapoteca.midia_meta_pit
         (ano, tipo_midia_id, meta_pit_id, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<tipoMidiaId>, $<metaPitId>, $<usuarioUuid>)
       RETURNING *`,
      {
        ano: dados.ano,
        tipoMidiaId: dados.tipo_midia_id,
        metaPitId: dados.meta_pit_id,
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.midia_meta_pit',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    return { id: criada.id }
  })
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'mapoteca.midia_meta_pit', id, 'De-para de mídia'
    )
    await conferirAno(t, dados.ano, dados.meta_pit_id)

    const existente = await t.oneOrNone(
      `SELECT id FROM mapoteca.midia_meta_pit
       WHERE ano = $<ano> AND tipo_midia_id = $<tipoMidiaId> AND id <> $<id>`,
      { ano: dados.ano, tipoMidiaId: dados.tipo_midia_id, id }
    )
    if (existente) {
      throw new AppError(
        `Esta mídia já aponta outra meta em ${dados.ano}`,
        httpCode.Conflict
      )
    }

    const depois = await t.one(
      `UPDATE mapoteca.midia_meta_pit
       SET ano = $<ano>, tipo_midia_id = $<tipoMidiaId>, meta_pit_id = $<metaPitId>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      {
        id,
        ano: dados.ano,
        tipoMidiaId: dados.tipo_midia_id,
        metaPitId: dados.meta_pit_id,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.midia_meta_pit',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  })
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'mapoteca.midia_meta_pit', id, 'De-para de mídia'
    )

    await t.none('DELETE FROM mapoteca.midia_meta_pit WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.midia_meta_pit',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
