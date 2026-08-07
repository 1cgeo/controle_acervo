'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')
const arquivoCtrl = require('../arquivo/arquivo_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// Codigo SQLSTATE do PostgreSQL para violacao de chave estrangeira. Os casos
// possiveis aqui sao nota_credito_id, cod_nd e ug_emitente apontando registro
// inexistente.
const FK_VIOLATION = '23503'
// Violacao de unicidade: `uniq_recolhimento_por_alvo` cobre (ano, numero,
// nota_credito_id).
const UNIQUE_VIOLATION = '23505'

const mensagemFk = err => {
  const detalhe = (err && err.detail) || ''
  if (detalhe.includes('(nota_credito_id)')) {
    return 'A nota de credito informada nao existe'
  }
  if (detalhe.includes('(cod_nd)')) {
    return 'A natureza de despesa (cod_nd) informada nao existe'
  }
  if (detalhe.includes('(ug_emitente)')) {
    return 'A unidade gestora emitente informada nao existe'
  }
  return 'Referencia invalida em um dos campos do recolhimento'
}

// Reembrulha violacao de FK como 400 e a colisao da chave (ano, numero, alvo)
// como 409. O 409 explica o RATEIO: o mesmo numero pode entrar de novo, desde
// que para OUTRA nota de credito.
const tratarErro = err => {
  if (err && err.code === FK_VIOLATION) {
    throw new AppError(mensagemFk(err), httpCode.BadRequest, err)
  }
  if (err && err.code === UNIQUE_VIOLATION) {
    throw new AppError(
      'Já existe um recolhimento com este número e este ano para esta nota de crédito. '
        + 'O mesmo documento pode abater outra NC, mas não a mesma duas vezes.',
      httpCode.Conflict,
      err
    )
  }
  throw err
}

// As colunas da leitura, com os nomes resolvidos por JOIN. A NC alvo sai
// identificada pelo TRIO (numero, ND, UG emitente) porque o numero sozinho nao a
// distingue: a numeracao do SIAFI e por UG emitente.
const SELECT_BASE = `
  SELECT rec.id, rec.nota_credito_id,
         nc.numero AS nc_numero, nc.ano AS nc_ano, nc.cod_nd AS nc_cod_nd,
         nc.ug_emitente AS nc_ug_emitente,
         rec.numero, rec.ano, rec.data_emissao,
         rec.cod_nd,
         nd.nome AS nd_nome,
         rec.ug_emitente,
         ug.nome AS ug_nome,
         rec.valor, rec.finalidade_historico, rec.observacao,
         (SELECT COUNT(*) FROM orcamento.arquivo AS af
           WHERE af.recolhimento_id = rec.id) AS qtd_anexos
    FROM orcamento.nota_credito_recolhimento AS rec
    INNER JOIN orcamento.nota_credito AS nc ON nc.id = rec.nota_credito_id
    LEFT JOIN dominio.natureza_despesa AS nd ON nd.code = rec.cod_nd
    LEFT JOIN dominio.ug AS ug ON ug.code = rec.ug_emitente`

// Os parametros de escrita, montados uma vez: o INSERT e o UPDATE gravam
// exatamente os mesmos campos, e duas listas separadas se afastam na primeira
// coluna nova.
const parametrosDeEscrita = (dados, usuarioUuid) => ({
  notaCreditoId: dados.nota_credito_id,
  numero: dados.numero,
  ano: dados.ano,
  dataEmissao: dados.data_emissao || null,
  codNd: dados.cod_nd || null,
  ugEmitente: dados.ug_emitente || null,
  valor: dados.valor,
  finalidadeHistorico: dados.finalidade_historico || null,
  observacao: dados.observacao || null,
  usuarioUuid
})

controller.listar = async (filtros = {}) => {
  // Filtros opcionais e independentes: a ficha de uma NC pede
  // `nota_credito_id`, e o fechamento do exercicio pede `ano`.
  //
  // ORDEM estavel: ano e numero do documento, com desempate pelo id. Sem o
  // desempate, dois recolhimentos do MESMO documento (o rateio entre duas NCs)
  // saem em ordem livre, e a mesma consulta devolve listas diferentes.
  return db.conn.any(
    `${SELECT_BASE}
     WHERE ($<notaCreditoId> IS NULL OR rec.nota_credito_id = $<notaCreditoId>)
       AND ($<ano> IS NULL OR rec.ano = $<ano>)
     ORDER BY rec.ano DESC, rec.numero, rec.id`,
    {
      notaCreditoId:
        filtros.nota_credito_id != null ? filtros.nota_credito_id : null,
      ano: filtros.ano != null ? filtros.ano : null
    }
  )
}

controller.getPorId = async id => {
  const recolhimento = await db.conn.oneOrNone(
    `${SELECT_BASE}
     WHERE rec.id = $<id>`,
    { id }
  )

  if (!recolhimento) {
    throw new AppError('Recolhimento nao encontrado', httpCode.NotFound)
  }

  return recolhimento
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn
    .tx(async t => {
      const criado = await t.one(
        `INSERT INTO orcamento.nota_credito_recolhimento
          (nota_credito_id, numero, ano, data_emissao, cod_nd, ug_emitente,
           valor, finalidade_historico, observacao, usuario_cadastramento_uuid)
         VALUES
          ($<notaCreditoId>, $<numero>, $<ano>, $<dataEmissao>, $<codNd>,
           $<ugEmitente>, $<valor>, $<finalidadeHistorico>, $<observacao>,
           $<usuarioUuid>)
         RETURNING *`,
        parametrosDeEscrita(dados, usuarioUuid)
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.nota_credito_recolhimento',
        registroId: criado.id,
        operacao: 'I',
        depois: criado,
        usuarioUuid,
        contexto
      })

      return { id: criado.id }
    })
    .catch(tratarErro)
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn
    .tx(async t => {
      // `lerAntes` no lugar do SELECT que so existia para o 404: numa tabela em
      // que o campo mais provavel de mudar e um VALOR, "de quanto para quanto" e
      // a pergunta inteira.
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'orcamento.nota_credito_recolhimento',
        id,
        'Recolhimento'
      )

      const depois = await t.one(
        `UPDATE orcamento.nota_credito_recolhimento SET
           nota_credito_id = $<notaCreditoId>, numero = $<numero>, ano = $<ano>,
           data_emissao = $<dataEmissao>, cod_nd = $<codNd>,
           ug_emitente = $<ugEmitente>, valor = $<valor>,
           finalidade_historico = $<finalidadeHistorico>,
           observacao = $<observacao>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          id,
          ...parametrosDeEscrita(dados, usuarioUuid),
          dataModificacao: new Date()
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.nota_credito_recolhimento',
        registroId: id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })

      return { id: depois.id }
    })
    .catch(tratarErro)
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  await db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'orcamento.nota_credito_recolhimento',
      id,
      'Recolhimento'
    )

    // O DELETE remove as linhas de anexo (com os bytes) por ON DELETE CASCADE, e
    // o anexo tem rastro proprio: sem esta chamada, o unico registro de que o
    // extrato do SIAFI existiu sumiria em silencio junto com o recolhimento. E o
    // mesmo desenho do `deletar` da nota de credito.
    await arquivoCtrl.auditarCascata(t, 'recolhimento_id', id, usuarioUuid, contexto)

    await t.none(
      'DELETE FROM orcamento.nota_credito_recolhimento WHERE id = $<id>',
      { id }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.nota_credito_recolhimento',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

/**
 * O rastro dos recolhimentos que caem por ON DELETE CASCADE quando a NC sai.
 *
 * `nota_credito_recolhimento.nota_credito_id` e ON DELETE CASCADE, entao apagar
 * a NC apaga os documentos de recolhimento dela sem DELETE nenhum no controller.
 * Cada um deles arrasta os proprios anexos, tambem por cascata. Sem esta funcao,
 * o unico registro de que aqueles documentos existiram sumiria em silencio, e a
 * exclusao e justamente o evento que o rastro existe para guardar.
 *
 * Chamada ANTES do DELETE da NC, dentro da mesma transacao.
 *
 * @param {object} t - a transacao do dono
 * @param {number|string} notaCreditoId
 * @param {string} usuarioUuid
 * @param {object} contexto
 */
controller.auditarCascata = async (t, notaCreditoId, usuarioUuid, contexto) => {
  const linhas = await t.any(
    `SELECT * FROM orcamento.nota_credito_recolhimento
      WHERE nota_credito_id = $<notaCreditoId>`,
    { notaCreditoId }
  )

  for (const linha of linhas) {
    await arquivoCtrl.auditarCascata(
      t, 'recolhimento_id', linha.id, usuarioUuid, contexto
    )
    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.nota_credito_recolhimento',
      registroId: linha.id,
      operacao: 'D',
      antes: linha,
      usuarioUuid,
      contexto
      // SEM `entidadeId` a mao: o agregado sai da PROPRIA linha lida
      // (`nota_credito_id`), pelo mapa. Passa-lo aqui seria a mesma coisa dita
      // duas vezes, e as duas livres para discordar.
    })
  }
}

module.exports = controller
