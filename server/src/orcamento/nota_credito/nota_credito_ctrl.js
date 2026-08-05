'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')
const arquivoCtrl = require('../arquivo/arquivo_ctrl')

const { AppError, httpCode, domainConstants: { CLASSIFICACAO_NC } } = require('../utils')

const controller = {}

// Codigo SQLSTATE do PostgreSQL para violacao de chave estrangeira.
// Usado para traduzir o erro cru do banco numa mensagem amigavel (400),
// por exemplo quando cod_nd / cod_pi / ug_emitente / pdr_item_id /
// nc_complementada_id apontam para um registro inexistente.
const FK_VIOLATION = '23503'
// Violacao de unicidade (ano+numero+cod_nd+ug_emitente e unico na NC: a
// numeracao do SIAFI e por UG emitente, entao o mesmo numero+ND pode existir
// para emitentes distintos).
const UNIQUE_VIOLATION = '23505'

// Mapa de constraint/coluna -> mensagem amigavel. A constraint exata depende
// do nome gerado pelo banco; por isso casamos tambem pela coluna citada no
// detalhe do erro (err.detail), que e estavel ("Key (coluna)=...").
const mensagemFk = err => {
  const detalhe = (err && err.detail) || ''
  if (detalhe.includes('(cod_nd)')) {
    return 'A natureza de despesa (cod_nd) informada nao existe'
  }
  if (detalhe.includes('(cod_pi)')) {
    return 'O plano interno (cod_pi) informado nao existe'
  }
  if (detalhe.includes('(ug_emitente)')) {
    return 'A unidade gestora emitente informada nao existe'
  }
  if (detalhe.includes('(classificacao_id)')) {
    return 'A classificacao informada nao existe'
  }
  if (detalhe.includes('(meta_pit_id)')) {
    return 'A meta do PIT informada nao existe'
  }
  if (detalhe.includes('(pdr_item_id)')) {
    return 'O item do PDR informado nao existe'
  }
  if (detalhe.includes('(nc_complementada_id)')) {
    return 'A nota de credito complementada informada nao existe'
  }
  return 'Referencia invalida em um dos campos da nota de credito'
}

// Reembrulha violacao de FK como AppError 400 (amigavel) e violacao de
// unicidade (ano+numero+cod_nd+ug_emitente) como 409; demais erros sobem.
const tratarFk = err => {
  if (err && err.code === FK_VIOLATION) {
    throw new AppError(mensagemFk(err), httpCode.BadRequest, err)
  }
  if (err && err.code === UNIQUE_VIOLATION) {
    throw new AppError(
      'Já existe uma nota de crédito com este número, esta ND e esta UG emitente (o trio número/ND/UG emitente deve ser único)',
      httpCode.Conflict,
      err
    )
  }
  throw err
}

// Normaliza pdr_item_id de acordo com a classificacao. O schema ja remove
// (strip) pdr_item_id quando classificacao = Extra-PDR, deixando undefined;
// aqui garantimos null explicito para o banco, e reforcamos o invariante
// "classificacao = PDR (1) => pode ter pdr_item_id; senao => null".
const normalizarPdrItemId = dados => {
  if (dados.classificacao_id !== CLASSIFICACAO_NC.PDR) {
    return null
  }
  return dados.pdr_item_id == null ? null : dados.pdr_item_id
}

controller.listar = async (filtros = {}) => {
  // Lista as NCs com nomes resolvidos por JOIN: natureza de despesa,
  // classificacao, UG emitente e a meta do PIT (numero_meta) quando houver.
  // Filtros opcionais por ano e classificacao_id.
  //
  // ug_emitente entra porque ela FAZ PARTE da identidade da NC: a unicidade e
  // (ano, numero, cod_nd, COALESCE(ug_emitente,'')), e sem a UG duas NCs
  // legitimamente distintas aparecem identicas na tela.
  //
  // prazo_empenho entra porque e a data que decide se ainda da para empenhar o
  // credito; sem ela a lista nao diz o que esta prestes a se perder.
  //
  // ORDEM: data_emissao DESC NULLS LAST com desempate por numero e ND. Sem o
  // desempate a ordem e INSTAVEL onde a data se repete ou e nula (todas as NCs
  // de 2025 tem data nula), e a mesma consulta devolve ordens diferentes.
  return db.conn.any(
    `SELECT nc.id, nc.numero, nc.ano, nc.data_emissao, nc.cod_nd,
            nd.nome AS nd_nome,
            nc.ug_emitente,
            ug.nome AS ug_nome,
            nc.valor_nc, nc.valor_recolhido, nc.prazo_empenho,
            nc.classificacao_id,
            cl.nome AS classificacao_nome,
            nc.pdr_item_id, nc.meta_pit_id,
            mp.numero_meta, mp.item AS meta_item, mp.descricao AS meta_descricao,
            nc.marcador, nc.nc_complementada_id,
            -- Empenhado LIQUIDO contra esta NC, nas duas formas de vinculo: as
            -- linhas do rateio e as NEs antigas, que apontam a NC direto. Sem
            -- ele a tela de empenho so sabe o VALOR da NC, e nao o saldo, que e
            -- o numero da decisao de empenhar.
            -- A anulacao desconta, e proporcional a fatia de cada NC: anular
            -- devolve o valor a NC. Mesma conta de EMPENHADO_POR_NC em
            -- nota_empenho_ctrl.js, e mesmo criterio liquido do painel.
            COALESCE((
              SELECT SUM(v.valor) FROM (
                SELECT enc.valor - COALESCE(ne.valor_anulado, 0)
                         * (enc.valor / NULLIF(tot.soma, 0)) AS valor
                  FROM orcamento.nota_empenho_nota_credito AS enc
                  INNER JOIN orcamento.nota_empenho AS ne ON ne.id = enc.nota_empenho_id
                  INNER JOIN LATERAL (
                    SELECT SUM(x.valor) AS soma
                      FROM orcamento.nota_empenho_nota_credito AS x
                     WHERE x.nota_empenho_id = enc.nota_empenho_id
                  ) AS tot ON TRUE
                 WHERE enc.nota_credito_id = nc.id
                UNION ALL
                SELECT ne.valor_empenhado - COALESCE(ne.valor_anulado, 0)
                  FROM orcamento.nota_empenho AS ne
                 WHERE ne.nota_credito_id = nc.id
                   AND NOT EXISTS (SELECT 1 FROM orcamento.nota_empenho_nota_credito AS x
                                    WHERE x.nota_empenho_id = ne.id)
              ) AS v
            ), 0) AS empenhado,
            af.id AS arquivo_id, af.nome_original AS arquivo_nome
     FROM orcamento.nota_credito AS nc
     INNER JOIN dominio.natureza_despesa AS nd ON nd.code = nc.cod_nd
     INNER JOIN dominio.classificacao_nc AS cl ON cl.code = nc.classificacao_id
     LEFT JOIN dominio.ug AS ug ON ug.code = nc.ug_emitente
     -- meta_vigente, e nao pit.meta: a descricao da meta mora em meta_revisao e
     -- so sai pela view. Sem ela a tela escreve o algarismo "3" solto, e a mesma
     -- meta aparece com nome no PDR e sem nome aqui. O pdr_ctrl ja usa a view.
     LEFT JOIN pit.meta_vigente AS mp ON mp.id = nc.meta_pit_id
     LEFT JOIN orcamento.arquivo AS af ON af.nota_credito_id = nc.id
     WHERE ($<ano> IS NULL OR nc.ano = $<ano>)
       AND ($<classificacaoId> IS NULL OR nc.classificacao_id = $<classificacaoId>)
     ORDER BY nc.data_emissao DESC NULLS LAST, nc.numero, nc.cod_nd`,
    {
      ano: filtros.ano != null ? filtros.ano : null,
      classificacaoId:
        filtros.classificacao_id != null ? filtros.classificacao_id : null
    }
  )
}

controller.getPorId = async id => {
  // Uma NC com todos os nomes resolvidos: ND, PI, UG, classificacao e meta.
  const nc = await db.conn.oneOrNone(
    `SELECT nc.id, nc.numero, nc.ano, nc.data_emissao, nc.cod_nd,
            nd.nome AS nd_nome,
            nc.ptres, nc.fonte, nc.cod_pi,
            pi.nome AS pi_nome,
            nc.ug_emitente,
            ug.nome AS ug_nome,
            nc.finalidade_historico, nc.meta_pit_id,
            mp.numero_meta, mp.item AS meta_item, mp.descricao AS meta_descricao,
            nc.valor_nc, nc.valor_recolhido, nc.doc_ro, nc.prazo_empenho,
            nc.classificacao_id,
            cl.nome AS classificacao_nome,
            nc.pdr_item_id, nc.nc_complementada_id,
            nc.marcador, nc.observacao,
            nc.data_cadastramento, nc.usuario_cadastramento_uuid,
            nc.data_modificacao, nc.usuario_modificacao_uuid
     FROM orcamento.nota_credito AS nc
     INNER JOIN dominio.natureza_despesa AS nd ON nd.code = nc.cod_nd
     INNER JOIN dominio.classificacao_nc AS cl ON cl.code = nc.classificacao_id
     LEFT JOIN dominio.plano_interno AS pi ON pi.code = nc.cod_pi
     LEFT JOIN dominio.ug AS ug ON ug.code = nc.ug_emitente
     -- Ver o comentario do listar: a descricao da meta so sai pela view.
     LEFT JOIN pit.meta_vigente AS mp ON mp.id = nc.meta_pit_id
     WHERE nc.id = $<id>`,
    { id }
  )

  if (!nc) {
    throw new AppError('Nota de credito nao encontrada', httpCode.NotFound)
  }

  return nc
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  const pdrItemId = normalizarPdrItemId(dados)

  return db.conn
    .tx(async t => {
      const criada = await t.one(
        `INSERT INTO orcamento.nota_credito
          (numero, ano, data_emissao, cod_nd, ptres, fonte, cod_pi, ug_emitente,
           finalidade_historico, meta_pit_id, valor_nc, valor_recolhido, doc_ro, prazo_empenho,
           classificacao_id, pdr_item_id, nc_complementada_id, marcador, observacao,
           usuario_cadastramento_uuid)
         VALUES
          ($<numero>, $<ano>, $<dataEmissao>, $<codNd>, $<ptres>, $<fonte>, $<codPi>,
           $<ugEmitente>, $<finalidadeHistorico>, $<metaPitId>, $<valorNc>, $<valorRecolhido>, $<docRo>,
           $<prazoEmpenho>, $<classificacaoId>, $<pdrItemId>, $<ncComplementadaId>,
           $<marcador>, $<observacao>, $<usuarioUuid>)
         RETURNING *`,
        {
          numero: dados.numero,
          ano: dados.ano,
          dataEmissao: dados.data_emissao || null,
          codNd: dados.cod_nd,
          ptres: dados.ptres || null,
          fonte: dados.fonte || null,
          codPi: dados.cod_pi || null,
          ugEmitente: dados.ug_emitente || null,
          finalidadeHistorico: dados.finalidade_historico || null,
          metaPitId: dados.meta_pit_id != null ? dados.meta_pit_id : null,
          valorNc: dados.valor_nc,
          valorRecolhido: dados.valor_recolhido != null ? dados.valor_recolhido : 0,
          docRo: dados.doc_ro || null,
          prazoEmpenho: dados.prazo_empenho || null,
          classificacaoId: dados.classificacao_id,
          pdrItemId,
          ncComplementadaId:
            dados.nc_complementada_id != null ? dados.nc_complementada_id : null,
          marcador: dados.marcador || null,
          observacao: dados.observacao || null,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.nota_credito',
        registroId: criada.id,
        operacao: 'I',
        depois: criada,
        usuarioUuid,
        contexto
      })

      // O `RETURNING *` e do rastro; a rota continua devolvendo so o id.
      return { id: criada.id }
    })
    .catch(tratarFk)
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  const pdrItemId = normalizarPdrItemId(dados)

  return db.conn
    .tx(async t => {
      // O `SELECT id` que existia so para o 404 virou `lerAntes`: mesma ida ao
      // banco, mesmo 404, e o estado anterior deixa de se perder. Numa tabela em
      // que o campo mais provavel de mudar e um VALOR, "de quanto para quanto" e
      // a pergunta inteira. E agora ele e lido DENTRO da transacao que altera a
      // linha, e nao numa conexao avulsa antes dela.
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'orcamento.nota_credito',
        id,
        'Nota de crédito'
      )

      const depois = await t.one(
        `UPDATE orcamento.nota_credito SET
           numero = $<numero>, ano = $<ano>, data_emissao = $<dataEmissao>,
           cod_nd = $<codNd>, ptres = $<ptres>, fonte = $<fonte>, cod_pi = $<codPi>,
           ug_emitente = $<ugEmitente>, finalidade_historico = $<finalidadeHistorico>,
           meta_pit_id = $<metaPitId>, valor_nc = $<valorNc>,
           valor_recolhido = $<valorRecolhido>, doc_ro = $<docRo>,
           prazo_empenho = $<prazoEmpenho>, classificacao_id = $<classificacaoId>,
           pdr_item_id = $<pdrItemId>, nc_complementada_id = $<ncComplementadaId>,
           marcador = $<marcador>, observacao = $<observacao>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          id,
          numero: dados.numero,
          ano: dados.ano,
          dataEmissao: dados.data_emissao || null,
          codNd: dados.cod_nd,
          ptres: dados.ptres || null,
          fonte: dados.fonte || null,
          codPi: dados.cod_pi || null,
          ugEmitente: dados.ug_emitente || null,
          finalidadeHistorico: dados.finalidade_historico || null,
          metaPitId: dados.meta_pit_id != null ? dados.meta_pit_id : null,
          valorNc: dados.valor_nc,
          valorRecolhido: dados.valor_recolhido != null ? dados.valor_recolhido : 0,
          docRo: dados.doc_ro || null,
          prazoEmpenho: dados.prazo_empenho || null,
          classificacaoId: dados.classificacao_id,
          pdrItemId,
          ncComplementadaId:
            dados.nc_complementada_id != null ? dados.nc_complementada_id : null,
          marcador: dados.marcador || null,
          observacao: dados.observacao || null,
          dataModificacao: new Date(),
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.nota_credito',
        registroId: id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })

      return { id: depois.id }
    })
    .catch(tratarFk)
}

/**
 * A TRANSACAO aqui nao e so pela auditoria. Sao quatro comandos (o `SELECT id`,
 * as duas checagens de dependencia e o `DELETE`), e fora de transacao cabe entre
 * a checagem e o DELETE outra requisicao criando a NE que a checagem acabara de
 * nao encontrar: a NC sairia com empenho vinculado, que e exatamente o que as
 * duas checagens existem para impedir.
 */
controller.deletar = async (id, usuarioUuid, contexto) => {
  await db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'orcamento.nota_credito',
      id,
      'Nota de crédito'
    )

    // Bloqueia exclusao se houver nota de empenho referenciando esta NC, seja como
    // NC representativa (nota_empenho.nota_credito_id) seja no rateio (junção NE-NC).
    const empenho = await t.oneOrNone(
      `SELECT 1
       WHERE EXISTS (SELECT 1 FROM orcamento.nota_empenho WHERE nota_credito_id = $<id>)
          OR EXISTS (SELECT 1 FROM orcamento.nota_empenho_nota_credito WHERE nota_credito_id = $<id>)`,
      { id }
    )
    if (empenho) {
      throw new AppError(
        'Nota de credito possui notas de empenho vinculadas e nao pode ser excluida',
        httpCode.Conflict
      )
    }

    // Bloqueia exclusao se outra NC a referencia como complementada (self-FK).
    const complementacao = await t.oneOrNone(
      'SELECT 1 FROM orcamento.nota_credito WHERE nc_complementada_id = $<id> LIMIT 1',
      { id }
    )
    if (complementacao) {
      throw new AppError(
        'Nota de credito e complementada por outra NC e nao pode ser excluida',
        httpCode.Conflict
      )
    }

    // O DELETE da NC remove as linhas de anexo (com os bytes) por ON DELETE
    // CASCADE, e o anexo tem rastro proprio: sem esta chamada, o unico registro
    // de que o PDF do SIAFI existiu sumiria em silencio junto com a NC.
    await arquivoCtrl.auditarCascata(t, 'nota_credito_id', id, usuarioUuid, contexto)

    await t.none('DELETE FROM orcamento.nota_credito WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.nota_credito',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
