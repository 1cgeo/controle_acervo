'use strict'

const path = require('path')

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')
const { TIPO_ANEXO_PEDIDO } = require('../utils/domain_constants')
const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const controller = {}

// Toda coluna de `mapoteca.anexo_pedido` MENOS `conteudo`. É o que a
// rastreabilidade lê nos dois sentidos (criação e exclusão).
//
// O BYTEA fica de fora da LEITURA, e não só do JSON: `SELECT *` traria o arquivo
// inteiro de volta pela conexão só para o helper o descartar, e um anexo de
// dezenas de MB pagaria esse trajeto duas vezes (na gravação e no evento). O
// `omitir: ['conteudo']` do mapa de entidades continua valendo como rede, para o
// dia em que alguém trocar esta lista por um `*`. O diff continua acusando a
// mudança do conteúdo, porque `tamanho_bytes` e `nome_original` estão aqui.
const COLUNAS_AUDITAVEIS = `id, pedido_id, tipo_anexo_id, nome_original, extensao,
  mimetype, tamanho_bytes, descricao, data_cadastramento,
  usuario_cadastramento_uuid, data_modificacao, usuario_modificacao_uuid`

// O multer/busboy entrega file.originalname decodificado como latin1; refaz
// para UTF-8 para não corromper nomes com acento (ex.: "relatório.pdf"). Para
// nomes ASCII é um no-op.
const decodeNome = nome => Buffer.from(nome, 'latin1').toString('utf8')

// Colunas devolvidas ao client (NUNCA o conteudo BYTEA: a listagem traz só os
// metadados; os bytes saem apenas no download).
const COLUNAS = `
  a.id, a.pedido_id, a.tipo_anexo_id, ta.nome AS tipo_anexo_nome,
  a.nome_original, a.extensao, a.mimetype, a.tamanho_bytes, a.descricao,
  a.data_cadastramento, a.usuario_cadastramento_uuid, u.nome AS usuario_cadastramento_nome`

const listarPorPedido = async (pedidoId, conn = db.conn) => {
  return conn.any(
    `SELECT ${COLUNAS}
       FROM mapoteca.anexo_pedido a
       JOIN mapoteca.tipo_anexo_pedido ta ON ta.code = a.tipo_anexo_id
       LEFT JOIN dgeo.usuario u ON u.uuid = a.usuario_cadastramento_uuid
      WHERE a.pedido_id = $<pedidoId>
      ORDER BY a.tipo_anexo_id, a.data_cadastramento, a.id`,
    { pedidoId }
  )
}

controller.listarPorPedido = async pedidoId => {
  const pedido = await db.conn.oneOrNone(
    'SELECT 1 FROM mapoteca.pedido WHERE id = $1',
    [pedidoId]
  )
  if (!pedido) {
    throw new AppError('Pedido não encontrado', httpCode.NotFound)
  }
  return listarPorPedido(pedidoId)
}

// Cria o registro do anexo gravando os bytes (file.buffer) no banco. Um pedido
// admite vários anexos (não substitui). Devolve a lista atualizada do pedido.
controller.criar = async (pedidoId, file, dados, usuarioUuid, contexto) => {
  const nomeOriginal = decodeNome(file.originalname)
  const meta = {
    pedidoId,
    tipoAnexoId:
      dados && dados.tipo_anexo_id != null
        ? dados.tipo_anexo_id
        : TIPO_ANEXO_PEDIDO.OUTROS,
    nomeOriginal,
    extensao: path.extname(nomeOriginal).replace('.', '').toLowerCase(),
    mimetype: file.mimetype || null,
    tamanhoBytes:
      file.buffer != null ? file.buffer.length : file.size != null ? file.size : null,
    conteudo: file.buffer,
    descricao: dados && dados.descricao != null ? dados.descricao : null,
    usuarioUuid
  }

  return db.conn.tx(async t => {
    const pedido = await t.oneOrNone(
      'SELECT 1 FROM mapoteca.pedido WHERE id = $1',
      [pedidoId]
    )
    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound)
    }

    const criado = await t.one(
      `INSERT INTO mapoteca.anexo_pedido
         (pedido_id, tipo_anexo_id, nome_original, extensao, mimetype,
          tamanho_bytes, conteudo, descricao, usuario_cadastramento_uuid)
       VALUES
         ($<pedidoId>, $<tipoAnexoId>, $<nomeOriginal>, $<extensao>, $<mimetype>,
          $<tamanhoBytes>, $<conteudo>, $<descricao>, $<usuarioUuid>)
       RETURNING ${COLUNAS_AUDITAVEIS}`,
      meta
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.anexo_pedido',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    })

    return listarPorPedido(pedidoId, t)
  })
}

// Metadados + bytes de um anexo, para download. Valida existência no banco.
controller.getParaDownload = async id => {
  const arquivo = await db.conn.oneOrNone(
    `SELECT id, nome_original, mimetype, conteudo
       FROM mapoteca.anexo_pedido WHERE id = $1`,
    [id]
  )
  if (!arquivo) {
    throw new AppError('Anexo não encontrado', httpCode.NotFound)
  }
  return arquivo
}

/**
 * Remove um anexo do pedido.
 *
 * A TRANSAÇÃO É OBRIGATÓRIA por duas razões: entre a conferência e o DELETE,
 * outra requisição pode apagar o mesmo anexo, e o segundo comando sairia sem
 * erro sobre uma linha que já não existe; e a linha do rastro tem de cair junto
 * com a exclusão que ela descreve, ou não cair.
 *
 * @param {number|string} id
 * @param {string} [usuarioUuid] - uuid do usuário do token
 * @param {object} [contexto] - { origem, rota, loteId } montado pelo guarda
 */
controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // A linha inteira (menos os bytes), e não `SELECT id`: depois do DELETE não
    // há mais de onde tirá-la, e uma exclusão sem `dados_antes` não diz o que se
    // perdeu, que é o caso principal deste rastro.
    const antes = await t.oneOrNone(
      `SELECT ${COLUNAS_AUDITAVEIS} FROM mapoteca.anexo_pedido WHERE id = $1`,
      [id]
    )
    if (!antes) {
      throw new AppError('Anexo não encontrado', httpCode.NotFound)
    }

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.anexo_pedido',
      registroId: antes.id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })

    await t.none('DELETE FROM mapoteca.anexo_pedido WHERE id = $1', [id])
  })
}

// EXPORTADA porque a exclusão do PEDIDO também precisa dela: `deletePedidos`
// lê os anexos que vão cair por ON DELETE CASCADE para auditá-los, e tem de ler
// as MESMAS colunas que este arquivo lê (o BYTEA de fora). Duas listas seriam
// duas trilhas com formatos diferentes para a mesma tabela.
controller.COLUNAS_AUDITAVEIS = COLUNAS_AUDITAVEIS

module.exports = controller
