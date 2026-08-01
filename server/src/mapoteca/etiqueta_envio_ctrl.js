'use strict'

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')
const auditoriaCtrl = require('./auditoria_ctrl')

const controller = {}

// Uma etiqueta por pedido, entao a leitura e sempre por pedido_id. O id da
// propria linha sai junto porque a auditoria o usa como registro_id.
const COLUNAS = `id, pedido_id, destinatario, aos_cuidados, endereco, cep,
       data_cadastramento, usuario_cadastramento_uuid,
       data_modificacao, usuario_modificacao_uuid`

// Campo de texto vazio vira NULL na gravacao. Sem isto, um CEP apagado na tela
// gravaria '' e a etiqueta seguinte leria "tem CEP" onde nao ha nenhum.
const vazioVirouNulo = valor =>
  valor === undefined || valor === null || String(valor).trim() === ''
    ? null
    : String(valor).trim()

const conferePedido = async (conn, pedidoId) => {
  const pedido = await conn.oneOrNone(
    'SELECT 1 FROM mapoteca.pedido WHERE id = $1',
    [pedidoId]
  )
  if (!pedido) {
    throw new AppError('Pedido não encontrado', httpCode.NotFound)
  }
}

/**
 * Etiqueta salva de um pedido, ou null quando ainda não houver.
 *
 * Devolve null, e não 404, quando o pedido não tem etiqueta: a primeira abertura
 * do diálogo é o caso NORMAL, e um 404 ali viraria erro na tela de quem só quer
 * digitar a primeira etiqueta. O 404 fica para o pedido que não existe.
 */
controller.getPorPedido = async pedidoId => {
  await conferePedido(db.conn, pedidoId)

  return db.conn.oneOrNone(
    `SELECT ${COLUNAS}
       FROM mapoteca.etiqueta_envio
      WHERE pedido_id = $<pedidoId>`,
    { pedidoId }
  )
}

/**
 * Grava a etiqueta do pedido: cria na primeira vez, substitui nas seguintes.
 *
 * Upsert num INSERT ... ON CONFLICT só, e não "consulta e depois decide": entre
 * a consulta e a escrita, duas pessoas embalando o mesmo pacote criariam duas
 * etiquetas, e o UNIQUE derrubaria a segunda com erro de banco cru.
 *
 * A criadora fica gravada em usuario_cadastramento_uuid e NÃO se sobrescreve no
 * UPDATE; quem corrige depois entra em usuario_modificacao_uuid.
 *
 * @param {number|string} pedidoId
 * @param {{destinatario:string, aos_cuidados?:string, endereco?:string, cep?:string}} dados
 * @param {string} usuarioUuid - uuid do usuário do token
 */
controller.salvar = async (pedidoId, dados, usuarioUuid) => {
  return db.conn.tx(async t => {
    await conferePedido(t, pedidoId)

    // A linha ANTES sai do banco, e não do corpo da requisição: o corpo traz o
    // que o cliente PEDIU, e o diff da auditoria só faz sentido com os dois
    // lados vindos da mesma fonte.
    const antes = await t.oneOrNone(
      'SELECT * FROM mapoteca.etiqueta_envio WHERE pedido_id = $1',
      [pedidoId]
    )

    const depois = await t.one(
      `INSERT INTO mapoteca.etiqueta_envio
         (pedido_id, destinatario, aos_cuidados, endereco, cep,
          usuario_cadastramento_uuid)
       VALUES
         ($<pedidoId>, $<destinatario>, $<aosCuidados>, $<endereco>, $<cep>,
          $<usuarioUuid>)
       ON CONFLICT ON CONSTRAINT unique_etiqueta_por_pedido DO UPDATE SET
         destinatario = EXCLUDED.destinatario,
         aos_cuidados = EXCLUDED.aos_cuidados,
         endereco = EXCLUDED.endereco,
         cep = EXCLUDED.cep,
         usuario_modificacao_uuid = EXCLUDED.usuario_cadastramento_uuid,
         data_modificacao = now()
       RETURNING *`,
      {
        pedidoId,
        destinatario: vazioVirouNulo(dados.destinatario),
        aosCuidados: vazioVirouNulo(dados.aos_cuidados),
        endereco: vazioVirouNulo(dados.endereco),
        cep: vazioVirouNulo(dados.cep),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      pedidoId,
      tabela: 'etiqueta_envio',
      registroId: depois.id,
      operacao: antes ? 'U' : 'I',
      antes,
      depois,
      usuarioUuid
    })

    return depois
  })
}

module.exports = controller
