// Path: mapoteca\auditoria_ctrl.js
'use strict'

const { db } = require('../database')

const controller = {}

// Colunas de escrituracao, que mudam em TODA atualizacao (o carimbo de quem
// mexeu e de quando). Elas continuam saindo em dados_antes e dados_depois, mas
// ficam FORA de campos_alterados: se entrassem, toda linha do historico traria
// as duas e o campo que a pessoa realmente mudou se perderia no meio.
// As tabelas NOVAS carimbam por UUID (usuario_modificacao_uuid/data_modificacao,
// convencao de mapoteca.etiqueta_envio e anexo_pedido) e as antigas por id
// (usuario_atualizacao_id/data_atualizacao). Os quatro nomes entram aqui: e o
// mesmo carimbo com dois nomes, e o motivo de exclui-los e o mesmo.
const CAMPOS_DE_ESCRITURACAO = new Set([
  'usuario_atualizacao_id',
  'data_atualizacao',
  'usuario_modificacao_uuid',
  'data_modificacao'
])

// Compara valores vindos do banco. Data vira ISO, array e objeto viram JSON, e o
// resto vira texto. O texto e proposital: o driver devolve BIGINT como string e
// SMALLINT como numero, entao comparar por === cru acusaria mudanca onde nao
// houve. Os dois lados saem sempre da MESMA fonte (uma linha do banco), por isso
// a normalizacao nao esconde diferenca real.
const normalizar = valor => {
  if (valor === null || valor === undefined) {
    return null
  }
  if (valor instanceof Date) {
    return valor.toISOString()
  }
  if (typeof valor === 'object') {
    return JSON.stringify(valor)
  }
  return String(valor)
}

/**
 * Campos que mudaram entre duas versoes da linha.
 *
 * CALCULADO, nunca uma lista digitada a mao: lista escrita a mao envelhece na
 * primeira coluna nova e passa a mentir em silencio.
 *
 * Na insercao (antes nulo) devolve os campos que nasceram preenchidos; na
 * exclusao (depois nulo) devolve os que se perderam. E a mesma conta nos tres
 * casos, sem excecao por operacao.
 */
const diffCampos = (antes, depois) => {
  const chaves = new Set([
    ...Object.keys(antes || {}),
    ...Object.keys(depois || {})
  ])

  return [...chaves]
    .filter(c => !CAMPOS_DE_ESCRITURACAO.has(c))
    .filter(c => normalizar(antes ? antes[c] : null) !== normalizar(depois ? depois[c] : null))
    .sort()
}

/**
 * Grava um evento de auditoria de pedido.
 *
 * Recebe a transacao `t` de proposito, e nunca abre conexao propria: a linha da
 * auditoria tem de cair JUNTO com a mudanca que ela descreve, ou nao cair. Com
 * conexao propria, um rollback do pedido deixaria para tras o registro de uma
 * alteracao que nunca aconteceu.
 *
 * Para produto_pedido e impressao_item, `pedidoId` e o do pedido DONO e
 * `registroId` e o id da linha filha. E o que faz o historico do pedido trazer
 * tudo que aconteceu com ele, itens inclusive.
 *
 * @param {object} t - transacao do pg-promise (a mesma da mudanca)
 * @param {object} evento
 * @param {number|string} evento.pedidoId - pedido dono do evento
 * @param {string} evento.tabela - pedido, produto_pedido ou impressao_item
 * @param {number|string} [evento.registroId] - id da linha alterada
 * @param {string} evento.operacao - I, U ou D
 * @param {object} [evento.antes] - linha antes da mudanca
 * @param {object} [evento.depois] - linha depois da mudanca
 * @param {string} [evento.usuarioUuid] - uuid do usuario do token
 */
controller.registrar = async (
  t,
  { pedidoId, tabela, registroId, operacao, antes, depois, usuarioUuid }
) => {
  await t.none(
    `INSERT INTO mapoteca.pedido_auditoria
       (pedido_id, tabela, registro_id, operacao, dados_antes, dados_depois,
        campos_alterados, usuario_uuid)
     VALUES
       ($<pedidoId>, $<tabela>, $<registroId>, $<operacao>, $<dadosAntes>::jsonb,
        $<dadosDepois>::jsonb, $<camposAlterados>::text[], $<usuarioUuid>)`,
    {
      pedidoId,
      tabela,
      registroId: registroId != null ? registroId : null,
      operacao,
      dadosAntes: antes ? JSON.stringify(antes) : null,
      dadosDepois: depois ? JSON.stringify(depois) : null,
      camposAlterados: diffCampos(antes, depois),
      usuarioUuid: usuarioUuid != null ? usuarioUuid : null
    }
  )
}

/**
 * Historico de um pedido, mais novo primeiro.
 *
 * NAO confere se o pedido ainda existe, de proposito: a exclusao e justamente o
 * evento que esta tabela existe para guardar, e um 404 aqui esconderia o unico
 * registro de que o pedido existiu. O LEFT JOIN pela mesma razao: o usuario e
 * nulo em evento de migracao.
 */
controller.listarPorPedido = async pedidoId => {
  return db.conn.any(
    `SELECT a.id, a.pedido_id, a.tabela, a.registro_id, a.operacao,
            a.dados_antes, a.dados_depois, a.campos_alterados, a.data_evento,
            a.usuario_uuid, u.nome AS usuario_nome,
            u.nome_guerra AS usuario_nome_guerra
       FROM mapoteca.pedido_auditoria a
       LEFT JOIN dgeo.usuario u ON u.uuid = a.usuario_uuid
      WHERE a.pedido_id = $<pedidoId>
      ORDER BY a.data_evento DESC, a.id DESC`,
    { pedidoId }
  )
}

// Exportado para teste: e a regra que decide o conteudo de campos_alterados.
controller.diffCampos = diffCampos

module.exports = controller
