'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')

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
//
// RECEBE `t`, e nunca le por `db.conn`: fora da transacao que grava a NE, cabe
// entre a validacao e o INSERT outra requisicao mudando a ND de uma daquelas
// NCs, e a NE nasce violando a regra que esta funcao existe para garantir.
const validarNcsHomogeneas = async (t, alocacoes) => {
  if (alocacoes.length <= 1) return
  const ids = alocacoes.map(a => a.nota_credito_id)
  const ncs = await t.any(
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

// Empenhado por NC, somando as DUAS formas de rateio numa NUMERIC do banco.
//
// A forma nova mora em `nota_empenho_nota_credito`. A NE antiga nao tem linha
// nenhuma la: o vinculo dela e o proprio `nota_empenho.nota_credito_id`, com o
// valor empenhado cheio. Contar so a tabela de rateio ignoraria essas NEs, e o
// teto da NC sairia alto demais.
//
// `ignorarNeId` serve ao UPDATE: a NE que esta sendo salva nao pode contar
// contra si mesma, senao editar uma NE sem mudar valor ja estouraria o teto.
//
// A ANULACAO desconta. O que consome o credito da NC e o empenho LIQUIDO, e nao
// o bruto: anular devolve o valor a NC. Medido em 2026, o bruto soma 556.545,40
// e o liquido 483.568,51, uma diferenca de 72.976,89. Tres NEs reais estao
// anuladas por INTEIRO (2026NE000002, 2026NE000152 e 2026NE000153): contando o
// bruto, o teto daria essas NCs por esgotadas e recusaria qualquer empenho novo
// contra credito que esta livre. O painel ja soma liquido
// (dashboard_ctrl.js:146,154), entao o bruto tambem discordaria dele.
//
// A NE anula no total, e o rateio e por NC: a anulacao entra PROPORCIONAL a
// fatia de cada NC. Hoje 81 de 81 NEs tem uma NC so, e a proporcao e exata em
// todos os casos reais.
const EMPENHADO_POR_NC = `
  SELECT v.nota_credito_id, SUM(v.valor) AS empenhado
  FROM (
    SELECT enc.nota_credito_id,
           enc.valor - COALESCE(ne.valor_anulado, 0)
             * (enc.valor / NULLIF(tot.soma, 0)) AS valor
    FROM orcamento.nota_empenho_nota_credito AS enc
    INNER JOIN orcamento.nota_empenho AS ne ON ne.id = enc.nota_empenho_id
    INNER JOIN LATERAL (
      SELECT SUM(x.valor) AS soma
      FROM orcamento.nota_empenho_nota_credito AS x
      WHERE x.nota_empenho_id = enc.nota_empenho_id
    ) AS tot ON TRUE
    WHERE ($<ignorarNeId> IS NULL OR enc.nota_empenho_id <> $<ignorarNeId>)
    UNION ALL
    SELECT ne.nota_credito_id, ne.valor_empenhado - COALESCE(ne.valor_anulado, 0)
    FROM orcamento.nota_empenho AS ne
    WHERE ($<ignorarNeId> IS NULL OR ne.id <> $<ignorarNeId>)
      AND NOT EXISTS (
        SELECT 1 FROM orcamento.nota_empenho_nota_credito AS x
        WHERE x.nota_empenho_id = ne.id
      )
  ) AS v
  WHERE v.nota_credito_id IN ($<ids:csv>)
  GROUP BY v.nota_credito_id`

// Quanto UMA NE especifica consome de cada NC, ja liquido de anulacao. Mesma
// conta do EMPENHADO_POR_NC, invertendo o filtro: aqui SO a NE informada.
const EMPENHADO_DESTA_NE = `
  SELECT v.nota_credito_id, SUM(v.valor) AS empenhado
  FROM (
    SELECT enc.nota_credito_id,
           enc.valor - COALESCE(ne.valor_anulado, 0)
             * (enc.valor / NULLIF(tot.soma, 0)) AS valor
    FROM orcamento.nota_empenho_nota_credito AS enc
    INNER JOIN orcamento.nota_empenho AS ne ON ne.id = enc.nota_empenho_id
    INNER JOIN LATERAL (
      SELECT SUM(x.valor) AS soma
      FROM orcamento.nota_empenho_nota_credito AS x
      WHERE x.nota_empenho_id = enc.nota_empenho_id
    ) AS tot ON TRUE
    WHERE enc.nota_empenho_id = $<neId>
    UNION ALL
    SELECT ne.nota_credito_id, ne.valor_empenhado - COALESCE(ne.valor_anulado, 0)
    FROM orcamento.nota_empenho AS ne
    WHERE ne.id = $<neId>
      AND NOT EXISTS (
        SELECT 1 FROM orcamento.nota_empenho_nota_credito AS x
        WHERE x.nota_empenho_id = ne.id
      )
  ) AS v
  WHERE v.nota_credito_id IN ($<ids:csv>)
  GROUP BY v.nota_credito_id`

// Recusa a NE que faria os empenhos de uma NC passarem do saldo dela.
//
// A checagem OPOSTA (liquidar acima do empenhado) ja existia em
// `liquidacao_ctrl.criar`, e a assimetria ensinava o usuario que o sistema
// barra estouro. O empenho acima da NC passava, e voltava do SIAFI como nota
// devolvida. Roda DENTRO da transacao que grava, pelo mesmo motivo de
// `validarNcsHomogeneas`: fora dela, duas NEs simultaneas passam as duas.
//
// O teto DESCONTA o valor recolhido, e a barreira so vale para quem AUMENTA o
// consumo da NC. Os dois lados vem de fatos medidos em producao, e um sozinho
// erraria:
//  - descontar e obrigatorio, porque credito devolvido nao pode ser empenhado.
//    Sem descontar, o teto aceita gastar dinheiro que voltou, e o painel passa a
//    discordar do servidor (20 NCs de prazo vencido "com saldo" contra 9 reais);
//  - barrar so o AUMENTO e obrigatorio, porque duas NCs reais de 2026
//    (2026NC400698 e 2026NC400702) tiveram o credito devolvido DEPOIS do
//    empenho, e ja nascem acima do teto estrito. Barrar por valor absoluto
//    impediria de corrigir a finalidade ou a data dessas NEs para sempre.
// Corrigir, reduzir ou manter o valor continua livre. Crescer, nao.
//
// O `valorAnulado` DESTA NE entra na conta, e sem ele a barreira comparava duas
// grandezas diferentes. Medido em 2026-08-06 na 2026NE000002: ela vale 1.728,00,
// esta anulada por INTEIRO, e a NC 2026NC400137 teve os mesmos 1.728,00
// recolhidos. O `antes` saia LIQUIDO da consulta (1.728 menos 1.728 = zero) e o
// `desta` saia BRUTO das alocacoes do formulario (1.728), entao `cresce` dava
// verdadeiro comparando 1.728 contra 0. Resultado: nao se conseguia corrigir a
// data de uma NE que nao consome credito nenhum.
//
// A anulacao entra PROPORCIONAL a fatia de cada NC, a mesma regra do
// EMPENHADO_POR_NC: a NE anula no total e o rateio e por NC.
const validarTetoDasNcs = async (t, alocacoes, ignorarNeId = null, valorAnulado = 0) => {
  const ids = alocacoes.map(a => a.nota_credito_id)
  const ncs = await t.any(
    `SELECT id, numero, valor_nc, valor_recolhido
     FROM orcamento.nota_credito
     WHERE id IN ($<ids:csv>)`,
    { ids }
  )
  const jaEmpenhado = await t.any(EMPENHADO_POR_NC, {
    ids,
    // Number: o id chega da rota como texto, e a comparacao contra BIGINT
    // precisa do tipo certo.
    ignorarNeId: ignorarNeId != null ? Number(ignorarNeId) : null
  })

  // Quanto ESTA NE ja consumia de cada NC antes desta gravacao. Zero no create.
  // E a referencia para saber se a edicao CRESCE ou nao.
  const anterior = ignorarNeId == null
    ? []
    : await t.any(EMPENHADO_DESTA_NE, { ids, neId: Number(ignorarNeId) })
  const anteriorPorNc = new Map(
    anterior.map(l => [String(l.nota_credito_id), Number(l.empenhado)])
  )

  const empenhadoPorNc = new Map(
    jaEmpenhado.map(l => [String(l.nota_credito_id), Number(l.empenhado)])
  )

  // O BRUTO DE TODAS AS NCs, que e a base do rateio da anulacao.
  const totalBruto = alocacoes.reduce((s, a) => s + Number(a.valor), 0)
  const anulado = Number(valorAnulado || 0)

  for (const nc of ncs) {
    const outras = empenhadoPorNc.get(String(nc.id)) || 0
    const bruto = alocacoes
      .filter(a => String(a.nota_credito_id) === String(nc.id))
      .reduce((s, a) => s + Number(a.valor), 0)
    // LIQUIDO, na mesma unidade do `antes` e do `outras`: o que consome o
    // credito da NC e o empenho menos a anulacao, nunca o bruto.
    const desta = totalBruto > 0 ? bruto - anulado * (bruto / totalBruto) : 0
    // Teto = recebido menos devolvido. Credito recolhido voltou e nao se empenha.
    const teto = Number(nc.valor_nc) - Number(nc.valor_recolhido || 0)
    const antes = anteriorPorNc.get(String(nc.id)) || 0
    // Tolerancia de centavo: a soma em ponto flutuante deixa residuo de 1e-13,
    // e sem ela um empenho exato do saldo seria recusado.
    const passaDoTeto = outras + desta > teto + 0.005
    // A NE que ja estava acima do teto (credito devolvido depois do empenho)
    // continua editavel, desde que nao consuma MAIS do que ja consumia.
    const cresce = desta > antes + 0.005
    if (passaDoTeto && cresce) {
      throw new AppError(
        `O empenho excede o saldo da nota de credito ${nc.numero}. ` +
          `Valor da NC: ${Number(nc.valor_nc).toFixed(2)}; ` +
          `recolhido: ${Number(nc.valor_recolhido || 0).toFixed(2)}; ` +
          `ja empenhado: ${outras.toFixed(2)}; ` +
          `saldo: ${(teto - outras).toFixed(2)}; ` +
          // LIQUIDO, e o rotulo diz isso: sem ele, o numero da mensagem nao bate
          // com o que o usuario digitou na tela quando ha anulacao.
          `tentativa (liquida de anulacao): ${desta.toFixed(2)}`,
        httpCode.BadRequest
      )
    }
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

// --- A auditoria do RATEIO, que e da NE -------------------------------------
//
// `nota_empenho_nota_credito` e "apaga tudo e reinsere": salvar a NE destroi as
// linhas de rateio e cria outras, com ids novos. Auditar linha a linha faria o
// historico da NE dizer "removeu 2 alocacoes, acrescentou 2 alocacoes" em todo
// salvamento, mesmo sem mudanca nenhuma. Por isso o evento e UM so, da NE, com
// o antes e o depois da LISTA. E o mesmo desenho dos itens do DFD.
//
// O campo `alocacoes` esta declarado `sintetico: true` no mapa: nao ha coluna
// com esse nome na tabela.
const descreverAlocacao = a => `NC #${a.nota_credito_id}: ${a.valor}`

const lerLinhaDoRateio = async (t, neId) => {
  const linhas = await t.any(
    `SELECT nota_credito_id, valor
     FROM orcamento.nota_empenho_nota_credito
     WHERE nota_empenho_id = $<neId>
     ORDER BY nota_credito_id`,
    { neId }
  )
  return { nota_empenho_id: neId, alocacoes: linhas.map(descreverAlocacao) }
}

controller.listar = async (filtros = {}) => {
  // Lista as NEs com o numero da NC, a ND HERDADA da NC e o total ja liquidado
  // (subselect SUM em orcamento.liquidacao). Filtros opcionais por
  // nota_credito_id e ano. Ordenado por ano e numero.
  //
  // `finalidade` entra na listagem porque o numero NAO distingue as NEs: tres
  // NEs reais de 2026 compartilham o numero 2026NE000024. Sem a finalidade, a
  // busca da tela nao alcanca o unico texto que diz para que serve o empenho.
  return db.conn.any(
    `SELECT ne.id, ne.numero, ne.ano, ne.data_empenho,
            ne.nota_credito_id,
            nc.numero AS nota_credito_numero,
            nc.cod_nd,
            nd.nome AS nd_nome,
            nc.cod_pi,
            ne.finalidade,
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
  //
  // O SALDO E SOMADO NO BANCO, e nunca por `reduce` em Number sobre os NUMERIC
  // do Postgres: em ponto flutuante sobra residuo (2499.01 - 339.16 - 2159.85 da
  // 4.5e-13 em vez de zero), e a NE quitada aparece em aberto.
  //
  // O bloco `nc_*` existe para responder a pergunta da DECISAO: antes de emitir
  // uma NE nova, quanto resta do credito daquela NC. Sem ele a ficha mostrava
  // tres valores, todos da propria NE.
  const ne = await db.conn.oneOrNone(
    `SELECT ne.id, ne.numero, ne.ano, ne.data_empenho,
            ne.nota_credito_id,
            nc.numero AS nota_credito_numero,
            nc.cod_nd,
            nd.nome AS nd_nome,
            nd.gnd,
            nc.cod_pi,
            pi.nome AS pi_nome,
            ne.finalidade,
            ne.valor_empenhado, ne.valor_anulado,
            nc.valor_nc AS nc_valor_nc,
            nc.valor_recolhido AS nc_valor_recolhido,
            COALESCE((
              SELECT SUM(v.valor)
              FROM (
                SELECT enc2.valor - COALESCE(ne2.valor_anulado, 0)
                         * (enc2.valor / NULLIF(tot.soma, 0)) AS valor
                FROM orcamento.nota_empenho_nota_credito AS enc2
                INNER JOIN orcamento.nota_empenho AS ne2 ON ne2.id = enc2.nota_empenho_id
                INNER JOIN LATERAL (
                  SELECT SUM(x.valor) AS soma
                    FROM orcamento.nota_empenho_nota_credito AS x
                   WHERE x.nota_empenho_id = enc2.nota_empenho_id
                ) AS tot ON TRUE
                WHERE enc2.nota_credito_id = nc.id
                UNION ALL
                SELECT ne2.valor_empenhado - COALESCE(ne2.valor_anulado, 0)
                FROM orcamento.nota_empenho AS ne2
                WHERE ne2.nota_credito_id = nc.id
                  AND NOT EXISTS (
                    SELECT 1 FROM orcamento.nota_empenho_nota_credito AS x
                    WHERE x.nota_empenho_id = ne2.id
                  )
              ) AS v
            ), 0) AS nc_empenhado,
            af.id AS nc_arquivo_id, af.nome_original AS nc_arquivo_nome,
            COALESCE((SELECT SUM(li.valor_liquidado)
                      FROM orcamento.liquidacao AS li
                      WHERE li.nota_empenho_id = ne.id), 0) AS total_liquidado,
            ne.valor_empenhado - ne.valor_anulado
              - COALESCE((SELECT SUM(li2.valor_liquidado)
                          FROM orcamento.liquidacao AS li2
                          WHERE li2.nota_empenho_id = ne.id), 0) AS saldo_a_liquidar,
            ne.data_cadastramento, ne.usuario_cadastramento_uuid,
            uc.nome AS usuario_cadastramento_nome,
            ne.data_modificacao, ne.usuario_modificacao_uuid,
            um.nome AS usuario_modificacao_nome
     FROM orcamento.nota_empenho AS ne
     INNER JOIN orcamento.nota_credito AS nc ON nc.id = ne.nota_credito_id
     LEFT JOIN dominio.natureza_despesa AS nd ON nd.code = nc.cod_nd
     LEFT JOIN dominio.plano_interno AS pi ON pi.code = nc.cod_pi
     LEFT JOIN orcamento.arquivo AS af ON af.nota_credito_id = nc.id
     LEFT JOIN dgeo.usuario AS uc ON uc.uuid = ne.usuario_cadastramento_uuid
     LEFT JOIN dgeo.usuario AS um ON um.uuid = ne.usuario_modificacao_uuid
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

  // Saldo da NC pela MESMA regua de `validarTetoDasNcs`: recebido, menos o
  // recolhido, menos o empenhado LIQUIDO de anulacao. A tela nao pode mostrar um
  // saldo que a validacao nao reconhece, e mostrava: a conta daqui somava o
  // empenho BRUTO e ignorava o recolhido, enquanto o teto da gravacao ja fazia as
  // duas coisas. Uma NE anulada por inteiro aparecia consumindo a NC, e a tela
  // dizia "sem saldo" sobre credito que o servidor aceita empenhar.
  ne.nc_saldo =
    Number(ne.nc_valor_nc) -
    Number(ne.nc_valor_recolhido || 0) -
    Number(ne.nc_empenhado)

  return ne
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  const alocacoes = normalizarAlocacoes(dados)
  const valorEmpenhado = somaAlocacoes(alocacoes)
  const valorAnulado = dados.valor_anulado != null ? Number(dados.valor_anulado) : 0
  if (valorAnulado > valorEmpenhado) {
    throw new AppError(
      'O valor anulado nao pode exceder o valor empenhado total',
      httpCode.BadRequest
    )
  }
  // NC representativa (dirige ND/PI/classificacao e a 3.1).
  const notaCreditoId = alocacoes[0].nota_credito_id

  return db.conn
    .tx(async t => {
      // A validacao entrou PARA DENTRO da transacao (era `db.conn.any`): ver o
      // comentario de `validarNcsHomogeneas`.
      await validarNcsHomogeneas(t, alocacoes)
      await validarTetoDasNcs(t, alocacoes, null, valorAnulado)

      const ne = await t.one(
        `INSERT INTO orcamento.nota_empenho
          (numero, ano, data_empenho, nota_credito_id,
           finalidade, valor_empenhado, valor_anulado,
           usuario_cadastramento_uuid)
         VALUES
          ($<numero>, $<ano>, $<dataEmpenho>, $<notaCreditoId>,
           $<finalidade>, $<valorEmpenhado>, $<valorAnulado>,
           $<usuarioUuid>)
         RETURNING *`,
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

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.nota_empenho',
        registroId: ne.id,
        operacao: 'I',
        depois: ne,
        usuarioUuid,
        contexto
      })

      await inserirAlocacoes(t, ne.id, alocacoes)

      const rateioDepois = await lerLinhaDoRateio(t, ne.id)
      if (rateioDepois.alocacoes.length) {
        await auditoriaCtrl.registrar(t, {
          tabela: 'orcamento.nota_empenho_nota_credito',
          operacao: 'I',
          depois: rateioDepois,
          usuarioUuid,
          contexto
        })
      }

      // O `RETURNING *` e do rastro; a rota continua devolvendo so o id.
      return { id: ne.id }
    })
    .catch(tratarFk)
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  const alocacoes = normalizarAlocacoes(dados)
  const valorEmpenhado = somaAlocacoes(alocacoes)
  const valorAnulado = dados.valor_anulado != null ? Number(dados.valor_anulado) : 0
  if (valorAnulado > valorEmpenhado) {
    throw new AppError(
      'O valor anulado nao pode exceder o valor empenhado total',
      httpCode.BadRequest
    )
  }

  const notaCreditoId = alocacoes[0].nota_credito_id

  return db.conn
    .tx(async t => {
      // AS TRES LEITURAS FICAM DENTRO DA TRANSACAO: o teste de existencia, a
      // soma das liquidacoes e a validacao das NCs. Em conexao avulsa, cabe
      // entre qualquer uma delas e o UPDATE outra requisicao lancando uma
      // liquidacao, e o `valor_anulado` deixa o saldo negativo.
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'orcamento.nota_empenho',
        id,
        'Nota de empenho'
      )
      const rateioAntes = await lerLinhaDoRateio(t, id)

      // O valor_anulado nao pode deixar o saldo negativo: o total ja liquidado
      // nao pode exceder valor_empenhado - valor_anulado.
      const liquidado = await t.one(
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

      await validarNcsHomogeneas(t, alocacoes)
      // `id` entra como `ignorarNeId`: a NE que esta sendo salva nao conta
      // contra o proprio teto, senao salvar sem mudar valor ja estouraria.
      await validarTetoDasNcs(t, alocacoes, id, valorAnulado)

      const ne = await t.one(
        `UPDATE orcamento.nota_empenho SET
           numero = $<numero>, ano = $<ano>, data_empenho = $<dataEmpenho>,
           nota_credito_id = $<notaCreditoId>, finalidade = $<finalidade>,
           valor_empenhado = $<valorEmpenhado>, valor_anulado = $<valorAnulado>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
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

      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.nota_empenho',
        registroId: id,
        operacao: 'U',
        antes,
        depois: ne,
        usuarioUuid,
        contexto
      })

      // Regrava o rateio: limpa o anterior e insere as alocacoes atuais.
      await t.none(
        'DELETE FROM orcamento.nota_empenho_nota_credito WHERE nota_empenho_id = $<id>',
        { id }
      )
      await inserirAlocacoes(t, id, alocacoes)

      const rateioDepois = await lerLinhaDoRateio(t, id)
      // So registra quando o rateio MUDOU: regravar o mesmo rateio nao pode
      // produzir uma linha de historico dizendo que ele mudou.
      if (JSON.stringify(rateioAntes.alocacoes) !== JSON.stringify(rateioDepois.alocacoes)) {
        await auditoriaCtrl.registrar(t, {
          tabela: 'orcamento.nota_empenho_nota_credito',
          operacao: 'U',
          antes: rateioAntes,
          depois: rateioDepois,
          usuarioUuid,
          contexto
        })
      }

      return { id: ne.id }
    })
    .catch(tratarFk)
}

// EM TRANSACAO: sao quatro comandos (o teste de existencia, as duas checagens de
// dependencia e o DELETE), e fora dela cabe entre a checagem e o DELETE outra
// requisicao lancando a liquidacao que a checagem acabara de nao encontrar.
controller.deletar = async (id, usuarioUuid, contexto) => {
  await db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'orcamento.nota_empenho',
      id,
      'Nota de empenho'
    )
    const rateioAntes = await lerLinhaDoRateio(t, id)

    // Bloqueia exclusao se houver liquidacao referenciando esta NE.
    const liquidacao = await t.oneOrNone(
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
    const recebimento = await t.oneOrNone(
      'SELECT 1 FROM orcamento.recebimento_material WHERE nota_empenho_id = $<id> LIMIT 1',
      { id }
    )
    if (recebimento) {
      throw new AppError(
        'Nota de empenho possui recebimentos de material vinculados e nao pode ser excluida',
        httpCode.Conflict
      )
    }

    // O rateio cai por ON DELETE CASCADE, sem DELETE explicito. Sem este evento,
    // a divisao do empenho entre as NCs desapareceria sem rastro nenhum.
    if (rateioAntes.alocacoes.length) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'orcamento.nota_empenho_nota_credito',
        operacao: 'D',
        antes: rateioAntes,
        usuarioUuid,
        contexto
      })
    }

    await t.none('DELETE FROM orcamento.nota_empenho WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.nota_empenho',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
