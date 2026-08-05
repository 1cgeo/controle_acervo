'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')
const arquivoCtrl = require('../arquivo/arquivo_ctrl')

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

// --- A auditoria dos ITENS, que e do PAI ------------------------------------
//
// `dfd_item` e "apaga tudo e reinsere": salvar um DFD com quatro itens sempre
// destroi as quatro linhas e cria quatro novas, com ids e carimbos novos.
// Auditar linha a linha faria o historico do DFD dizer "removeu 4 itens,
// acrescentou 4 itens" TODA VEZ que alguem abrisse e salvasse, mesmo sem tocar
// em nada. Por isso o evento e UM so, do PAI, com o antes e o depois da LISTA
// INTEIRA descrita em texto: o que muda de verdade e o que esta escrito aqui.
//
// A descricao mora neste controller porque ele e o unico que reescreve a lista;
// o campo `itens` esta declarado `sintetico: true` no mapa de auditoria, ja que
// nao ha coluna com esse nome na tabela.
const descreverItem = item => [
  `tipo ${item.tipo_item_id}`,
  item.cod_catmat_catser ? `cat. ${item.cod_catmat_catser}` : null,
  item.descricao,
  item.quantidade != null ? `qtd ${item.quantidade}` : null,
  item.valor_unitario != null ? `unit. ${item.valor_unitario}` : null,
  item.valor_total != null ? `total ${item.valor_total}` : null
]
  .filter(Boolean)
  .join(' | ')

// A linha SINTETICA que vai ao registrar. `dfd_id` esta nela porque e dele que
// o mapa tira o agregado dono.
const lerLinhaDosItens = async (t, dfdId) => {
  const linhas = await t.any(
    `SELECT tipo_item_id, cod_catmat_catser, descricao,
            quantidade, valor_unitario, valor_total
     FROM orcamento.dfd_item
     WHERE dfd_id = $<dfdId>
     ORDER BY id`,
    { dfdId }
  )
  return { dfd_id: dfdId, itens: linhas.map(descreverItem) }
}

// So registra quando a lista MUDOU. Salvar o cabecalho sem mexer nos itens nao
// pode produzir uma linha de historico dizendo que os itens mudaram.
// Sem `dfdId` na assinatura: a linha sintetica ja o carrega em `antes.dfd_id` e
// `depois.dfd_id`, e o argumento nunca era lido aqui.
const registrarItens = async (t, antes, depois, usuarioUuid, contexto) => {
  if (JSON.stringify(antes.itens) === JSON.stringify(depois.itens)) {
    return
  }
  await auditoriaCtrl.registrar(t, {
    tabela: 'orcamento.dfd_item',
    // Sem `registro_id`: o evento descreve a lista, e nao uma linha. Apontar o
    // id do DFD aqui se leria como "o item numero 42", que nao existe.
    operacao: 'U',
    antes,
    depois,
    usuarioUuid,
    contexto
  })
}

// O NOME de quem cadastrou e de quem alterou sai junto com o uuid: a tela nao
// resolve uuid, e para o DFD anterior ao historico de alteracoes a data de
// cadastro e o nome sao a unica rastreabilidade.
controller.listar = async ano => {
  return db.conn.any(
    `SELECT d.id, d.numero, d.ano, d.rotulo, d.objeto, d.justificativa,
            d.area_requisitante, d.grau_prioridade_id, gp.nome AS grau_prioridade,
            d.data_prevista_conclusao, d.responsavel_cpf, d.vinculo_plano_gestao,
            d.consta_pca, d.valor_estimado,
            d.data_cadastramento, d.usuario_cadastramento_uuid,
            uc.nome AS usuario_cadastramento,
            d.data_modificacao, d.usuario_modificacao_uuid,
            um.nome AS usuario_modificacao,
            af.id AS arquivo_id, af.nome_original AS arquivo_nome
     FROM orcamento.dfd AS d
     LEFT JOIN dominio.grau_prioridade AS gp ON gp.code = d.grau_prioridade_id
     LEFT JOIN orcamento.arquivo AS af ON af.dfd_id = d.id
     LEFT JOIN dgeo.usuario AS uc ON uc.uuid = d.usuario_cadastramento_uuid
     LEFT JOIN dgeo.usuario AS um ON um.uuid = d.usuario_modificacao_uuid
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
            uc.nome AS usuario_cadastramento,
            d.data_modificacao, d.usuario_modificacao_uuid,
            um.nome AS usuario_modificacao
     FROM orcamento.dfd AS d
     LEFT JOIN dominio.grau_prioridade AS gp ON gp.code = d.grau_prioridade_id
     LEFT JOIN dgeo.usuario AS uc ON uc.uuid = d.usuario_cadastramento_uuid
     LEFT JOIN dgeo.usuario AS um ON um.uuid = d.usuario_modificacao_uuid
     WHERE d.id = $<id>`,
    { id }
  )
  if (!dfd) {
    throw new AppError('DFD não encontrado', httpCode.NotFound)
  }

  dfd.itens = await getItens(db.conn, id)

  return dfd
}

controller.criar = async (dados, usuarioUuid, contexto) => {
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
       RETURNING *`,
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

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.dfd',
      registroId: dfd.id,
      operacao: 'I',
      depois: dfd,
      usuarioUuid,
      contexto
    })

    await inserirItens(t, dfd.id, dados.itens, usuarioUuid)

    const itensDepois = await lerLinhaDosItens(t, dfd.id)
    if (itensDepois.itens.length) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.dfd_item',
        operacao: 'I',
        depois: itensDepois,
        usuarioUuid,
        contexto
      })
    }

    // O `RETURNING *` e do rastro; a rota continua devolvendo so o id.
    return { id: dfd.id }
  })
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  const valorEstimado = resolveValorEstimado(dados.valor_estimado, dados.itens)

  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'orcamento.dfd', id, 'DFD')
    const itensAntes = await lerLinhaDosItens(t, id)

    const dfd = await t.one(
      `UPDATE orcamento.dfd
       SET numero = $<numero>, ano = $<ano>, rotulo = $<rotulo>,
           objeto = $<objeto>, justificativa = $<justificativa>, area_requisitante = $<area_requisitante>,
           grau_prioridade_id = $<grau_prioridade_id>, data_prevista_conclusao = $<data_prevista_conclusao>,
           responsavel_cpf = $<responsavel_cpf>, vinculo_plano_gestao = $<vinculo_plano_gestao>,
           consta_pca = $<consta_pca>, valor_estimado = $<valor_estimado>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
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

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.dfd',
      registroId: id,
      operacao: 'U',
      antes,
      depois: dfd,
      usuarioUuid,
      contexto
    })

    // Substitui os itens: remove os antigos do DFD e insere os novos na mesma transacao.
    await t.none('DELETE FROM orcamento.dfd_item WHERE dfd_id = $<id>', { id })

    await inserirItens(t, id, dados.itens, usuarioUuid)

    const itensDepois = await lerLinhaDosItens(t, id)
    await registrarItens(t, itensAntes, itensDepois, usuarioUuid, contexto)

    return { id: dfd.id }
  })
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  await db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'orcamento.dfd', id, 'DFD')
    const itensAntes = await lerLinhaDosItens(t, id)

    // Remove primeiro os itens (FK dfd_item.dfd_id) e depois o proprio DFD. As
    // linhas de anexo (com os bytes) saem junto por ON DELETE CASCADE.
    await t.none('DELETE FROM orcamento.dfd_item WHERE dfd_id = $<id>', { id })

    if (itensAntes.itens.length) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.dfd_item',
        operacao: 'D',
        antes: itensAntes,
        usuarioUuid,
        contexto
      })
    }

    // O anexo do DFD cai por ON DELETE CASCADE, sem DELETE explicito aqui. Sem
    // esta chamada, o unico registro de que o PDF existiu sumiria em silencio.
    await arquivoCtrl.auditarCascata(t, 'dfd_id', id, usuarioUuid, contexto)

    await t.none('DELETE FROM orcamento.dfd WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.dfd',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
