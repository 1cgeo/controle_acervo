// Path: orcamento\nota_empenho\nota_empenho_ctrl.js
'use strict'

const { db } = require('../../database')

const { AppError, httpCode } = require('../utils')

const controller = {}

// Codigo SQLSTATE do PostgreSQL para violacao de chave estrangeira.
// Usado para traduzir o erro cru do banco numa mensagem amigavel (400),
// quando nota_credito_id aponta para uma NC inexistente.
const FK_VIOLATION = '23503'

// Mapa de coluna -> mensagem amigavel. A constraint exata depende do nome
// gerado pelo banco; por isso casamos pela coluna citada no detalhe do erro
// (err.detail), que e estavel ("Key (coluna)=...").
const mensagemFk = err => {
  const detalhe = (err && err.detail) || ''
  if (detalhe.includes('(nota_credito_id)')) {
    return 'A nota de credito informada nao existe'
  }
  return 'Referencia invalida em um dos campos da nota de empenho'
}

// Reembrulha violacao de FK como AppError 400 (amigavel); demais erros sobem.
const tratarFk = err => {
  if (err && err.code === FK_VIOLATION) {
    throw new AppError(mensagemFk(err), httpCode.BadRequest, err)
  }
  throw err
}

// Normaliza a entrada nas duas formas (legada: nota_credito_id + valor_empenhado;
// nova: notas_credito[]) numa lista unica de alocacoes [{nota_credito_id, valor}].
const normalizarAlocacoes = dados => {
  if (Array.isArray(dados.notas_credito) && dados.notas_credito.length) {
    return dados.notas_credito.map(a => ({
      nota_credito_id: a.nota_credito_id,
      valor: Number(a.valor)
    }))
  }
  return [
    { nota_credito_id: dados.nota_credito_id, valor: Number(dados.valor_empenhado) }
  ]
}

// Soma das alocacoes = valor empenhado total da NE.
const somaAlocacoes = alocacoes =>
  alocacoes.reduce((s, a) => s + Number(a.valor), 0)

// Quando ha mais de uma NC, todas precisam existir e compartilhar a mesma ND e a
// mesma classificacao (regra de negocio). NC unica dispensa a checagem (a FK ja
// garante a existencia e "mesma ND" e trivial).
const validarNcsHomogeneas = async alocacoes => {
  if (alocacoes.length <= 1) return
  const ids = alocacoes.map(a => a.nota_credito_id)
  const ncs = await db.conn.any(
    `SELECT id, cod_nd, classificacao_id
     FROM orcamento.nota_credito
     WHERE id IN ($<ids:csv>)`,
    { ids }
  )
  if (ncs.length !== new Set(ids).size) {
    throw new AppError(
      'Uma das notas de credito informadas nao existe',
      httpCode.BadRequest
    )
  }
  const cods = new Set(ncs.map(n => n.cod_nd))
  const classes = new Set(ncs.map(n => Number(n.classificacao_id)))
  if (cods.size > 1 || classes.size > 1) {
    throw new AppError(
      'As notas de credito de uma mesma NE devem ter a mesma ND e a mesma classificacao',
      httpCode.BadRequest
    )
  }
}

// Grava as linhas de rateio NE-NC (sequencial: uma conexao por transacao).
const inserirAlocacoes = async (t, neId, alocacoes) => {
  for (const a of alocacoes) {
    await t.none(
      `INSERT INTO orcamento.nota_empenho_nota_credito
         (nota_empenho_id, nota_credito_id, valor)
       VALUES ($<neId>, $<ncId>, $<valor>)`,
      { neId, ncId: a.nota_credito_id, valor: a.valor }
    )
  }
}

controller.listar = async (filtros = {}) => {
  // Lista as NEs com o numero da NC, a ND HERDADA da NC e o total ja liquidado
  // (subselect SUM em orcamento.liquidacao). Filtros opcionais por
  // nota_credito_id e ano. Ordenado por ano e numero.
  return db.conn.any(
    `SELECT ne.id, ne.numero, ne.ano, ne.data_empenho,
            ne.nota_credito_id,
            nc.numero AS nota_credito_numero,
            nc.cod_nd,
            nd.nome AS nd_nome,
            nc.cod_pi,
            ne.valor_empenhado, ne.valor_anulado,
            COALESCE((SELECT SUM(li.valor_liquidado)
                      FROM orcamento.liquidacao AS li
                      WHERE li.nota_empenho_id = ne.id), 0) AS total_liquidado,
            (SELECT COUNT(*)
               FROM orcamento.nota_empenho_nota_credito AS enc
               WHERE enc.nota_empenho_id = ne.id) AS qtd_nc
     FROM orcamento.nota_empenho AS ne
     INNER JOIN orcamento.nota_credito AS nc ON nc.id = ne.nota_credito_id
     LEFT JOIN dominio.natureza_despesa AS nd ON nd.code = nc.cod_nd
     WHERE ($<notaCreditoId> IS NULL OR ne.nota_credito_id = $<notaCreditoId>)
       AND ($<ano> IS NULL OR ne.ano = $<ano>)
     ORDER BY ne.ano, ne.numero`,
    {
      notaCreditoId:
        filtros.nota_credito_id != null ? filtros.nota_credito_id : null,
      ano: filtros.ano != null ? filtros.ano : null
    }
  )
}

controller.getPorId = async id => {
  // Uma NE com nomes resolvidos, suas liquidacoes (array) e o saldo a
  // liquidar = valor_empenhado - valor_anulado - SUM(liquidado).
  const ne = await db.conn.oneOrNone(
    `SELECT ne.id, ne.numero, ne.ano, ne.data_empenho,
            ne.nota_credito_id,
            nc.numero AS nota_credito_numero,
            nc.cod_nd,
            nd.nome AS nd_nome,
            nc.cod_pi,
            pi.nome AS pi_nome,
            ne.finalidade,
            ne.valor_empenhado, ne.valor_anulado,
            ne.data_cadastramento, ne.usuario_cadastramento_uuid,
            ne.data_modificacao, ne.usuario_modificacao_uuid
     FROM orcamento.nota_empenho AS ne
     INNER JOIN orcamento.nota_credito AS nc ON nc.id = ne.nota_credito_id
     LEFT JOIN dominio.natureza_despesa AS nd ON nd.code = nc.cod_nd
     LEFT JOIN dominio.plano_interno AS pi ON pi.code = nc.cod_pi
     WHERE ne.id = $<id>`,
    { id }
  )

  if (!ne) {
    throw new AppError('Nota de empenho nao encontrada', httpCode.NotFound)
  }

  // Liquidacoes da NE (array, possivelmente vazio).
  ne.liquidacoes = await db.conn.any(
    `SELECT id, valor_liquidado, data, documento_ns
     FROM orcamento.liquidacao
     WHERE nota_empenho_id = $<id>
     ORDER BY data, id`,
    { id }
  )

  // Rateio por NC (forma nova): as NCs que cobrem esta NE e o valor de cada uma.
  // A soma de valor = ne.valor_empenhado. Para NEs antigas (sem rateio gravado),
  // o array sai vazio e a NC representativa (nota_credito_id) continua valendo.
  ne.notas_credito = await db.conn.any(
    `SELECT enc.nota_credito_id, enc.valor,
            nc.numero AS nota_credito_numero, nc.cod_nd
     FROM orcamento.nota_empenho_nota_credito AS enc
     INNER JOIN orcamento.nota_credito AS nc ON nc.id = enc.nota_credito_id
     WHERE enc.nota_empenho_id = $<id>
     ORDER BY enc.id`,
    { id }
  )

  // Saldo a liquidar = valor_empenhado - valor_anulado - SUM(liquidado).
  const totalLiquidado = ne.liquidacoes.reduce(
    (soma, li) => soma + Number(li.valor_liquidado),
    0
  )
  ne.total_liquidado = totalLiquidado
  ne.saldo_a_liquidar =
    Number(ne.valor_empenhado) - Number(ne.valor_anulado) - totalLiquidado

  return ne
}

controller.criar = async (dados, usuarioUuid) => {
  const alocacoes = normalizarAlocacoes(dados)
  const valorEmpenhado = somaAlocacoes(alocacoes)
  const valorAnulado = dados.valor_anulado != null ? Number(dados.valor_anulado) : 0
  if (valorAnulado > valorEmpenhado) {
    throw new AppError(
      'O valor anulado nao pode exceder o valor empenhado total',
      httpCode.BadRequest
    )
  }
  await validarNcsHomogeneas(alocacoes)
  // NC representativa (dirige ND/PI/classificacao e a 3.1).
  const notaCreditoId = alocacoes[0].nota_credito_id

  return db.conn
    .tx(async t => {
      const ne = await t.one(
        `INSERT INTO orcamento.nota_empenho
          (numero, ano, data_empenho, nota_credito_id,
           finalidade, valor_empenhado, valor_anulado,
           usuario_cadastramento_uuid)
         VALUES
          ($<numero>, $<ano>, $<dataEmpenho>, $<notaCreditoId>,
           $<finalidade>, $<valorEmpenhado>, $<valorAnulado>,
           $<usuarioUuid>)
         RETURNING id`,
        {
          numero: dados.numero,
          ano: dados.ano,
          dataEmpenho: dados.data_empenho || null,
          notaCreditoId,
          finalidade: dados.finalidade || null,
          valorEmpenhado,
          valorAnulado,
          usuarioUuid
        }
      )
      await inserirAlocacoes(t, ne.id, alocacoes)
      return ne
    })
    .catch(tratarFk)
}

controller.atualizar = async (id, dados, usuarioUuid) => {
  const existente = await db.conn.oneOrNone(
    'SELECT id FROM orcamento.nota_empenho WHERE id = $<id>',
    { id }
  )
  if (!existente) {
    throw new AppError('Nota de empenho nao encontrada', httpCode.NotFound)
  }

  const alocacoes = normalizarAlocacoes(dados)
  const valorEmpenhado = somaAlocacoes(alocacoes)
  const valorAnulado = dados.valor_anulado != null ? Number(dados.valor_anulado) : 0
  if (valorAnulado > valorEmpenhado) {
    throw new AppError(
      'O valor anulado nao pode exceder o valor empenhado total',
      httpCode.BadRequest
    )
  }

  // O valor_anulado nao pode deixar o saldo negativo: o total ja liquidado
  // nao pode exceder valor_empenhado - valor_anulado.
  const liquidado = await db.conn.one(
    `SELECT COALESCE(SUM(valor_liquidado), 0) AS total
     FROM orcamento.liquidacao
     WHERE nota_empenho_id = $<id>`,
    { id }
  )
  const totalLiquidado = Number(liquidado.total)
  const disponivel = valorEmpenhado - valorAnulado
  if (totalLiquidado > disponivel) {
    throw new AppError(
      'Valor empenhado disponivel nao cobre as liquidacoes ja registradas',
      httpCode.BadRequest
    )
  }

  await validarNcsHomogeneas(alocacoes)
  const notaCreditoId = alocacoes[0].nota_credito_id

  return db.conn
    .tx(async t => {
      const ne = await t.one(
        `UPDATE orcamento.nota_empenho SET
           numero = $<numero>, ano = $<ano>, data_empenho = $<dataEmpenho>,
           nota_credito_id = $<notaCreditoId>, finalidade = $<finalidade>,
           valor_empenhado = $<valorEmpenhado>, valor_anulado = $<valorAnulado>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING id`,
        {
          id,
          numero: dados.numero,
          ano: dados.ano,
          dataEmpenho: dados.data_empenho || null,
          notaCreditoId,
          finalidade: dados.finalidade || null,
          valorEmpenhado,
          valorAnulado,
          dataModificacao: new Date(),
          usuarioUuid
        }
      )
      // Regrava o rateio: limpa o anterior e insere as alocacoes atuais.
      await t.none(
        'DELETE FROM orcamento.nota_empenho_nota_credito WHERE nota_empenho_id = $<id>',
        { id }
      )
      await inserirAlocacoes(t, id, alocacoes)
      return ne
    })
    .catch(tratarFk)
}

controller.deletar = async id => {
  const existente = await db.conn.oneOrNone(
    'SELECT id FROM orcamento.nota_empenho WHERE id = $<id>',
    { id }
  )
  if (!existente) {
    throw new AppError('Nota de empenho nao encontrada', httpCode.NotFound)
  }

  // Bloqueia exclusao se houver liquidacao referenciando esta NE.
  const liquidacao = await db.conn.oneOrNone(
    'SELECT 1 FROM orcamento.liquidacao WHERE nota_empenho_id = $<id> LIMIT 1',
    { id }
  )
  if (liquidacao) {
    throw new AppError(
      'Nota de empenho possui liquidacoes vinculadas e nao pode ser excluida',
      httpCode.Conflict
    )
  }

  // Bloqueia exclusao se houver recebimento de material referenciando esta NE.
  const recebimento = await db.conn.oneOrNone(
    'SELECT 1 FROM orcamento.recebimento_material WHERE nota_empenho_id = $<id> LIMIT 1',
    { id }
  )
  if (recebimento) {
    throw new AppError(
      'Nota de empenho possui recebimentos de material vinculados e nao pode ser excluida',
      httpCode.Conflict
    )
  }

  return db.conn.none('DELETE FROM orcamento.nota_empenho WHERE id = $<id>', {
    id
  })
}

module.exports = controller
