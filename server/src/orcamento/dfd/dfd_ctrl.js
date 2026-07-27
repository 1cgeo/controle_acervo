// Path: orcamento\dfd\dfd_ctrl.js
'use strict'

const { db } = require('../../database')

const { AppError, httpCode } = require('../utils')

const controller = {}

// Colunas dos itens usadas para o insert em lote (db.pgp.helpers.insert).
const itemColumns = [
  'dfd_id',
  'tipo_item_id',
  'cod_catmat_catser',
  'descricao',
  'quantidade',
  'valor_unitario',
  'valor_total',
  'usuario_cadastramento_uuid'
]

// Calcula o valor estimado do DFD: usa o informado quando vier preenchido,
// senao soma o valor_total dos itens (DFD nao tem coluna de ND, regra do dominio).
const resolveValorEstimado = (valorEstimado, itens) => {
  if (valorEstimado !== undefined && valorEstimado !== null) {
    return valorEstimado
  }
  if (!itens || itens.length === 0) {
    return null
  }
  const soma = itens.reduce((acc, item) => {
    return acc + (item.valor_total !== undefined && item.valor_total !== null ? Number(item.valor_total) : 0)
  }, 0)
  return soma
}

const getItens = async (conn, dfdId) => {
  return conn.any(
    `SELECT i.id, i.dfd_id, i.tipo_item_id, ti.nome AS tipo_item,
            i.cod_catmat_catser, i.descricao, i.quantidade, i.valor_unitario, i.valor_total,
            i.data_cadastramento, i.usuario_cadastramento_uuid,
            i.data_modificacao, i.usuario_modificacao_uuid
     FROM orcamento.dfd_item AS i
     INNER JOIN dominio.tipo_item_dfd AS ti ON ti.code = i.tipo_item_id
     WHERE i.dfd_id = $<dfdId>
     ORDER BY i.id`,
    { dfdId }
  )
}

const inserirItens = async (t, dfdId, itens, usuarioUuid) => {
  if (!itens || itens.length === 0) {
    return
  }
  const registros = itens.map(item => ({
    dfd_id: dfdId,
    tipo_item_id: item.tipo_item_id,
    cod_catmat_catser: item.cod_catmat_catser !== undefined ? item.cod_catmat_catser : null,
    descricao: item.descricao,
    quantidade: item.quantidade !== undefined ? item.quantidade : null,
    valor_unitario: item.valor_unitario !== undefined ? item.valor_unitario : null,
    valor_total: item.valor_total !== undefined ? item.valor_total : null,
    usuario_cadastramento_uuid: usuarioUuid
  }))

  const cs = new db.pgp.helpers.ColumnSet(itemColumns, {
    table: { table: 'dfd_item', schema: 'orcamento' }
  })

  const query = db.pgp.helpers.insert(registros, cs)

  return t.none(query)
}

controller.listar = async ano => {
  return db.conn.any(
    `SELECT d.id, d.numero, d.ano, d.rotulo, d.objeto, d.justificativa,
            d.area_requisitante, d.grau_prioridade_id, gp.nome AS grau_prioridade,
            d.data_prevista_conclusao, d.responsavel_cpf, d.vinculo_plano_gestao,
            d.consta_pca, d.valor_estimado,
            d.data_cadastramento, d.usuario_cadastramento_uuid,
            d.data_modificacao, d.usuario_modificacao_uuid,
            af.id AS arquivo_id, af.nome_original AS arquivo_nome
     FROM orcamento.dfd AS d
     LEFT JOIN dominio.grau_prioridade AS gp ON gp.code = d.grau_prioridade_id
     LEFT JOIN orcamento.arquivo AS af ON af.dfd_id = d.id
     WHERE ($<ano> IS NULL OR d.ano = $<ano>)
     ORDER BY d.ano DESC, d.numero`,
    { ano: ano !== undefined ? ano : null }
  )
}

controller.getPorId = async id => {
  const dfd = await db.conn.oneOrNone(
    `SELECT d.id, d.numero, d.ano, d.rotulo, d.objeto, d.justificativa,
            d.area_requisitante, d.grau_prioridade_id, gp.nome AS grau_prioridade,
            d.data_prevista_conclusao, d.responsavel_cpf, d.vinculo_plano_gestao,
            d.consta_pca, d.valor_estimado,
            d.data_cadastramento, d.usuario_cadastramento_uuid,
            d.data_modificacao, d.usuario_modificacao_uuid
     FROM orcamento.dfd AS d
     LEFT JOIN dominio.grau_prioridade AS gp ON gp.code = d.grau_prioridade_id
     WHERE d.id = $<id>`,
    { id }
  )
  if (!dfd) {
    throw new AppError('DFD não encontrado', httpCode.NotFound)
  }

  dfd.itens = await getItens(db.conn, id)

  return dfd
}

controller.criar = async (dados, usuarioUuid) => {
  const valorEstimado = resolveValorEstimado(dados.valor_estimado, dados.itens)

  return db.conn.tx(async t => {
    const dfd = await t.one(
      `INSERT INTO orcamento.dfd
        (numero, ano, rotulo, objeto, justificativa, area_requisitante,
         grau_prioridade_id, data_prevista_conclusao, responsavel_cpf, vinculo_plano_gestao,
         consta_pca, valor_estimado, usuario_cadastramento_uuid)
       VALUES
        ($<numero>, $<ano>, $<rotulo>, $<objeto>, $<justificativa>, $<area_requisitante>,
         $<grau_prioridade_id>, $<data_prevista_conclusao>, $<responsavel_cpf>, $<vinculo_plano_gestao>,
         $<consta_pca>, $<valor_estimado>, $<usuarioUuid>)
       RETURNING id`,
      {
        numero: dados.numero,
        ano: dados.ano,
        rotulo: dados.rotulo,
        objeto: dados.objeto,
        justificativa: dados.justificativa,
        area_requisitante: dados.area_requisitante,
        grau_prioridade_id: dados.grau_prioridade_id,
        data_prevista_conclusao: dados.data_prevista_conclusao,
        responsavel_cpf: dados.responsavel_cpf,
        vinculo_plano_gestao: dados.vinculo_plano_gestao,
        consta_pca: dados.consta_pca,
        valor_estimado: valorEstimado,
        usuarioUuid
      }
    )

    await inserirItens(t, dfd.id, dados.itens, usuarioUuid)

    return dfd
  })
}

controller.atualizar = async (id, dados, usuarioUuid) => {
  const valorEstimado = resolveValorEstimado(dados.valor_estimado, dados.itens)

  return db.conn.tx(async t => {
    const existente = await t.oneOrNone(
      'SELECT id FROM orcamento.dfd WHERE id = $<id>',
      { id }
    )
    if (!existente) {
      throw new AppError('DFD não encontrado', httpCode.NotFound)
    }

    const dfd = await t.one(
      `UPDATE orcamento.dfd
       SET numero = $<numero>, ano = $<ano>, rotulo = $<rotulo>,
           objeto = $<objeto>, justificativa = $<justificativa>, area_requisitante = $<area_requisitante>,
           grau_prioridade_id = $<grau_prioridade_id>, data_prevista_conclusao = $<data_prevista_conclusao>,
           responsavel_cpf = $<responsavel_cpf>, vinculo_plano_gestao = $<vinculo_plano_gestao>,
           consta_pca = $<consta_pca>, valor_estimado = $<valor_estimado>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING id`,
      {
        id,
        numero: dados.numero,
        ano: dados.ano,
        rotulo: dados.rotulo,
        objeto: dados.objeto,
        justificativa: dados.justificativa,
        area_requisitante: dados.area_requisitante,
        grau_prioridade_id: dados.grau_prioridade_id,
        data_prevista_conclusao: dados.data_prevista_conclusao,
        responsavel_cpf: dados.responsavel_cpf,
        vinculo_plano_gestao: dados.vinculo_plano_gestao,
        consta_pca: dados.consta_pca,
        valor_estimado: valorEstimado,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )

    // Substitui os itens: remove os antigos do DFD e insere os novos na mesma transacao.
    await t.none('DELETE FROM orcamento.dfd_item WHERE dfd_id = $<id>', { id })

    await inserirItens(t, id, dados.itens, usuarioUuid)

    return dfd
  })
}

controller.deletar = async id => {
  await db.conn.tx(async t => {
    const existente = await t.oneOrNone(
      'SELECT id FROM orcamento.dfd WHERE id = $<id>',
      { id }
    )
    if (!existente) {
      throw new AppError('DFD não encontrado', httpCode.NotFound)
    }

    // Remove primeiro os itens (FK dfd_item.dfd_id) e depois o proprio DFD. As
    // linhas de anexo (com os bytes) saem junto por ON DELETE CASCADE.
    await t.none('DELETE FROM orcamento.dfd_item WHERE dfd_id = $<id>', { id })

    return t.none('DELETE FROM orcamento.dfd WHERE id = $<id>', { id })
  })
}

module.exports = controller
