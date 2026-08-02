'use strict'

// Demanda Extra-PIT: a subseção 3.3 do RPCMTec.
//
// O QUE ELA É, e o que ela não é. O relatório não chama de Extra-PIT todo
// trabalho fora do plano: chama a exceção AUTORIZADA, e o modelo tem uma coluna
// "Documento autorização" para provar. É por isso que `documento_autorizacao` é
// obrigatório aqui, e é exatamente o que faltava quando o SCA tentou derivar a
// 3.3 de `mapoteca.pedido.previsto_pit`: aquele campo é falso por omissão, e a
// conta deu 23 linhas onde a edição real de julho/2026 traz 1.
//
// MORA NO SCHEMA `pit` porque é a exceção AO PIT, e só se lê ao lado dele.
//
// Veio do SAP em 2026-08-02 (`macrocontrole.extra_pit`) sem o `lote_id`: lá ele
// serve para a 2.1 não contar duas vezes o mesmo trabalho, e aqui não há o que
// descontar, porque a 2.1 do SCA soma o que foi lançado em `pit.execucao` e o
// Extra-PIT não é lançado lá.

const { db } = require('../database')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

const colunas = `d.id, d.ano, d.demandante, d.tipo_produto, d.quantidade,
  d.situacao_id, s.nome AS situacao, d.documento_autorizacao, d.descricao,
  d.data_entrega::text AS data_entrega,
  d.data_cadastramento, d.usuario_cadastramento_uuid,
  d.data_modificacao, d.usuario_modificacao_uuid`

// A situação sai por JOIN, e não traduzida no cliente: a mesma lista serve à
// tela, ao RPCMTec e ao CLI, e três traduções do mesmo código divergiriam.
const de = `FROM pit.demanda_extra AS d
  INNER JOIN dominio.situacao_extra_pit AS s ON s.code = d.situacao_id`

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas} ${de}
       WHERE d.ano = $<ano>
       ORDER BY d.demandante, d.tipo_produto`,
      { ano }
    )
  }

  return db.conn.any(
    `SELECT ${colunas} ${de}
     ORDER BY d.ano DESC, d.demandante, d.tipo_produto`
  )
}

controller.getPorId = async id => {
  return db.conn.oneOrNone(
    `SELECT ${colunas} ${de} WHERE d.id = $<id>`,
    { id }
  )
}

// Os anos com demanda cadastrada, para a tela montar o filtro sem adivinhar um
// intervalo. Mesmo desenho de `pitCtrl.anos`.
controller.anos = async () => {
  const linhas = await db.conn.any(
    'SELECT DISTINCT ano FROM pit.demanda_extra ORDER BY ano DESC'
  )
  return linhas.map(l => l.ano)
}

const paraBanco = (dados, usuarioUuid) => ({
  ano: dados.ano,
  demandante: dados.demandante,
  tipoProduto: dados.tipo_produto,
  quantidade: dados.quantidade,
  situacaoId: dados.situacao_id,
  documentoAutorizacao: dados.documento_autorizacao,
  descricao: dados.descricao === undefined ? null : dados.descricao,
  dataEntrega: dados.data_entrega === undefined ? null : dados.data_entrega,
  usuarioUuid
})

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criada = await t.one(
      `INSERT INTO pit.demanda_extra
         (ano, demandante, tipo_produto, quantidade, situacao_id,
          documento_autorizacao, descricao, data_entrega, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<demandante>, $<tipoProduto>, $<quantidade>, $<situacaoId>,
               $<documentoAutorizacao>, $<descricao>, $<dataEntrega>, $<usuarioUuid>)
       RETURNING *`,
      paraBanco(dados, usuarioUuid)
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.demanda_extra',
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
      t, 'pit.demanda_extra', id, 'Demanda Extra-PIT'
    )

    const depois = await t.one(
      `UPDATE pit.demanda_extra
       SET ano = $<ano>, demandante = $<demandante>, tipo_produto = $<tipoProduto>,
           quantidade = $<quantidade>, situacao_id = $<situacaoId>,
           documento_autorizacao = $<documentoAutorizacao>, descricao = $<descricao>,
           data_entrega = $<dataEntrega>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      { ...paraBanco(dados, usuarioUuid), id, dataModificacao: new Date() }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.demanda_extra',
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

// Nada aponta para esta tabela, então excluir não esbarra em chave estrangeira
// nenhuma. É deliberado que ela seja mesmo excluível: a demanda cancelada tem
// situação própria ('Cancelado'), e o DELETE fica para o cadastro errado.
controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.demanda_extra', id, 'Demanda Extra-PIT'
    )

    await t.none('DELETE FROM pit.demanda_extra WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.demanda_extra',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
