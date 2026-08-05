'use strict'

// Execução orçamentária por natureza de despesa: a fonte das três abas do
// dashboard do orçamento (cards, gráfico por ND e as duas tabelas).
//
// POR QUE ELA NÃO MORA NO RPCMTec. São DUAS telas com necessidades diferentes:
//
//   o RPCMTec  quer a visão do PDR, em texto já formatado, sem linha de total
//              (o modelo da Divisão não tem uma), e é lido por quem administra
//   o dashboard  quer NÚMEROS, quebrados em PDR e Extra-PDR lado a lado, COM
//              linha de TOTAL para os cards, e é lido por quem tem perfil de
//              consulta no orçamento
//
// São perguntas distintas, com público distinto. Servir as duas do mesmo
// endpoint obrigaria a mais fraca das duas guardas a valer para as duas: ou o
// RPCMTec ficaria aberto a quem só consulta o orçamento, ou o dashboard passaria
// a exigir administrador. Por isso o RPCMTec tem a versão dele em
// `rpcmtec/rpcmtec_ctrl.js` e esta ficou aqui, no módulo dono do dado.
//
// O recorte é sempre CUMULATIVO no ano até o mês de corte: a pergunta do painel
// é "quanto do crédito do ano já foi executado".

const { db } = require('../../database')
const { domainConstants: { CLASSIFICACAO_NC } } = require('../utils')

const controller = {}

// Último dia do mês. new Date(ano, mes, 0) devolve o dia 0 do mês seguinte, que
// é o último do mês pedido, e trata ano bissexto.
const ultimoDiaDoMes = (ano, mes) => new Date(ano, mes, 0).getDate()

const recorteDoAno = (ano, mes) => {
  const dois = n => String(n).padStart(2, '0')
  return {
    inicio: `${ano}-01-01`,
    cutoff: `${ano}-${dois(mes)}-${dois(ultimoDiaDoMes(ano, mes))}`
  }
}

// Empenhado LÍQUIDO contra a NC `nc`, nas duas formas de vínculo: as linhas do
// rateio (nota_empenho_nota_credito) e as NEs antigas, que apontam a NC direto.
// A anulação desconta, e é proporcional à fatia de cada NC.
//
// É a MESMA conta de `nota_credito_ctrl.listar` e do EMPENHADO_POR_NC em
// `nota_empenho_ctrl.js`. Contar o bruto daria 556.545,40 contra os 483.568,51
// que o próprio painel soma, e o painel se contradiria consigo mesmo.
const EMPENHADO_LIQUIDO_DA_NC = `
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
  ), 0)`

/**
 * As pendências de dado do ano, cada uma com o total do seu fluxo.
 *
 * O painel mostra estes defeitos À VISTA, para chamar a ação.
 *
 * As três pendências de DATA existem por causa do `IS NULL` que cada filtro da
 * consulta principal carrega: o registro sem data entra em TODOS os meses,
 * então o painel de janeiro mostra o empenho de dezembro. A regra do corte NÃO
 * muda aqui, porque a decisão é do chefe. Esta contagem só torna o efeito
 * visível, para o usuário ler o número sabendo o que ele contém.
 *
 * As outras três apontam dado que falta ou crédito prestes a se perder.
 *
 * O recolhido não tem contagem própria: ele usa o mesmo recorte do recebido
 * (data_emissao da NC), então a contagem do recebido já o descreve.
 *
 * O prazo vencido usa o saldo LÍQUIDO da NC, e desconta também o recolhido:
 * crédito devolvido não se empenha, e empenhar sobre ele volta do SIAFI como
 * nota devolvida. É o mesmo critério do card "Saldo a empenhar" desta tela.
 *
 * @param {number} ano
 * @returns {Promise<Object<string, {n:number, total:number}>>}
 */
const contarPendencias = async ano => {
  const l = await db.conn.one(
    `SELECT
       (SELECT COUNT(*)
        FROM orcamento.nota_empenho AS ne
        WHERE ne.ano = $<ano> AND ne.data_empenho IS NULL) AS ne_sem_data,
       (SELECT COUNT(*)
        FROM orcamento.nota_empenho AS ne
        WHERE ne.ano = $<ano>) AS ne_total,
       (SELECT COUNT(*)
        FROM orcamento.liquidacao AS lq
        INNER JOIN orcamento.nota_empenho AS ne ON ne.id = lq.nota_empenho_id
        WHERE ne.ano = $<ano> AND lq.data IS NULL) AS liquidacao_sem_data,
       (SELECT COUNT(*)
        FROM orcamento.liquidacao AS lq
        INNER JOIN orcamento.nota_empenho AS ne ON ne.id = lq.nota_empenho_id
        WHERE ne.ano = $<ano>) AS liquidacao_total,
       (SELECT COUNT(*)
        FROM orcamento.nota_credito AS nc
        WHERE nc.ano = $<ano> AND nc.data_emissao IS NULL) AS nc_sem_data,
       (SELECT COUNT(*)
        FROM orcamento.nota_credito AS nc
        WHERE nc.ano = $<ano>) AS nc_total,
       (SELECT COUNT(*)
        FROM orcamento.rpnp AS r
        WHERE r.ano = $<ano> AND r.valor_a_liquidar IS NULL) AS rpnp_sem_valor,
       (SELECT COUNT(*)
        FROM orcamento.rpnp AS r
        WHERE r.ano = $<ano>) AS rpnp_total,
       (SELECT COUNT(*)
        FROM orcamento.nota_credito AS nc
        WHERE nc.ano = $<ano> AND nc.meta_pit_id IS NULL) AS nc_sem_meta,
       (SELECT COUNT(*)
        FROM orcamento.nota_credito AS nc
        WHERE nc.ano = $<ano>
          AND nc.prazo_empenho IS NOT NULL
          AND nc.prazo_empenho < CURRENT_DATE
          -- Tolerância de meio centavo: os valores são NUMERIC(15,2), e sem ela
          -- uma NC empenhada por inteiro entraria na conta por um resíduo.
          AND nc.valor_nc - nc.valor_recolhido - ${EMPENHADO_LIQUIDO_DA_NC} > 0.005
       ) AS nc_prazo_vencido`,
    { ano }
  )

  // COUNT do pg chega como string (BIGINT).
  const par = (chave, chaveTotal) => ({
    n: Number(l[chave]),
    total: Number(l[chaveTotal])
  })

  return {
    ne_sem_data: par('ne_sem_data', 'ne_total'),
    liquidacao_sem_data: par('liquidacao_sem_data', 'liquidacao_total'),
    nc_sem_data: par('nc_sem_data', 'nc_total'),
    rpnp_sem_valor: par('rpnp_sem_valor', 'rpnp_total'),
    nc_sem_meta: par('nc_sem_meta', 'nc_total'),
    nc_prazo_vencido: par('nc_prazo_vencido', 'nc_total')
  }
}

/**
 * Execução por ND: uma linha para CADA natureza de despesa do domínio (na ordem
 * do código), mais uma linha de TOTAL ao final.
 *
 * O previsto vem do PDR autorizado do ano. Recebido, recolhido, empenhado e
 * liquidado são quebrados em PDR (classificação 1) e Extra-PDR (classificação
 * 2); o total de cada fluxo é a soma dos dois, calculada em JS já que a
 * classificação só admite esses dois valores.
 *
 * O recolhido (parte do crédito devolvida) usa o mesmo recorte do recebido
 * (data_emissao da NC) e é informativo: NÃO desconta do recebido.
 *
 * Registro sem data entra no acumulado (a visão do ano), e é o que o
 * `IS NULL` de cada filtro faz: crédito ainda sem data de emissão é crédito do
 * ano, e sumir com ele faria o painel mostrar menos do que o banco tem. O preço
 * é que ele entra em todos os meses, e por isso o payload leva junto as
 * pendências de dado do ano (ver contarPendencias).
 *
 * @param {{ano:number, mes:number}} params
 * @returns {Promise<{linhas:Array<Object>, pendencias:Object}>}
 */
controller.getExecucaoPorNd = async ({ ano, mes }) => {
  const { inicio, cutoff } = recorteDoAno(ano, mes)

  const linhas = await db.conn.any(
    `SELECT
       nd.code AS cod_nd,
       nd.nome AS nd_nome,
       COALESCE((
         SELECT SUM(pi.valor_autorizado)
         FROM orcamento.pdr_item AS pi
         WHERE pi.ano = $<ano> AND pi.cod_nd = nd.code
       ), 0) AS previsto,
       COALESCE((
         SELECT SUM(nc.valor_nc)
         FROM orcamento.nota_credito AS nc
         WHERE nc.ano = $<ano> AND nc.classificacao_id = $<pdr> AND nc.cod_nd = nd.code
           AND (nc.data_emissao IS NULL
                OR (nc.data_emissao >= $<inicio> AND nc.data_emissao <= $<cutoff>))
       ), 0) AS recebido_pdr,
       COALESCE((
         SELECT SUM(nc.valor_nc)
         FROM orcamento.nota_credito AS nc
         WHERE nc.ano = $<ano> AND nc.classificacao_id = $<extra> AND nc.cod_nd = nd.code
           AND (nc.data_emissao IS NULL
                OR (nc.data_emissao >= $<inicio> AND nc.data_emissao <= $<cutoff>))
       ), 0) AS recebido_extra,
       COALESCE((
         SELECT SUM(nc.valor_recolhido)
         FROM orcamento.nota_credito AS nc
         WHERE nc.ano = $<ano> AND nc.classificacao_id = $<pdr> AND nc.cod_nd = nd.code
           AND (nc.data_emissao IS NULL
                OR (nc.data_emissao >= $<inicio> AND nc.data_emissao <= $<cutoff>))
       ), 0) AS recolhido_pdr,
       COALESCE((
         SELECT SUM(nc.valor_recolhido)
         FROM orcamento.nota_credito AS nc
         WHERE nc.ano = $<ano> AND nc.classificacao_id = $<extra> AND nc.cod_nd = nd.code
           AND (nc.data_emissao IS NULL
                OR (nc.data_emissao >= $<inicio> AND nc.data_emissao <= $<cutoff>))
       ), 0) AS recolhido_extra,
       COALESCE((
         SELECT SUM(ne.valor_empenhado - ne.valor_anulado)
         FROM orcamento.nota_empenho AS ne
         INNER JOIN orcamento.nota_credito AS ncne ON ncne.id = ne.nota_credito_id
         WHERE ncne.cod_nd = nd.code AND ncne.classificacao_id = $<pdr> AND ne.ano = $<ano>
           AND (ne.data_empenho IS NULL
                OR (ne.data_empenho >= $<inicio> AND ne.data_empenho <= $<cutoff>))
       ), 0) AS empenhado_pdr,
       COALESCE((
         SELECT SUM(ne.valor_empenhado - ne.valor_anulado)
         FROM orcamento.nota_empenho AS ne
         INNER JOIN orcamento.nota_credito AS ncne ON ncne.id = ne.nota_credito_id
         WHERE ncne.cod_nd = nd.code AND ncne.classificacao_id = $<extra> AND ne.ano = $<ano>
           AND (ne.data_empenho IS NULL
                OR (ne.data_empenho >= $<inicio> AND ne.data_empenho <= $<cutoff>))
       ), 0) AS empenhado_extra,
       COALESCE((
         SELECT SUM(lq.valor_liquidado)
         FROM orcamento.liquidacao AS lq
         INNER JOIN orcamento.nota_empenho AS ne ON ne.id = lq.nota_empenho_id
         INNER JOIN orcamento.nota_credito AS ncne ON ncne.id = ne.nota_credito_id
         WHERE ncne.cod_nd = nd.code AND ncne.classificacao_id = $<pdr> AND ne.ano = $<ano>
           AND (lq.data IS NULL OR (lq.data >= $<inicio> AND lq.data <= $<cutoff>))
       ), 0) AS liquidado_pdr,
       COALESCE((
         SELECT SUM(lq.valor_liquidado)
         FROM orcamento.liquidacao AS lq
         INNER JOIN orcamento.nota_empenho AS ne ON ne.id = lq.nota_empenho_id
         INNER JOIN orcamento.nota_credito AS ncne ON ncne.id = ne.nota_credito_id
         WHERE ncne.cod_nd = nd.code AND ncne.classificacao_id = $<extra> AND ne.ano = $<ano>
           AND (lq.data IS NULL OR (lq.data >= $<inicio> AND lq.data <= $<cutoff>))
       ), 0) AS liquidado_extra
     FROM dominio.natureza_despesa AS nd
     ORDER BY nd.code`,
    { ano, inicio, cutoff, pdr: CLASSIFICACAO_NC.PDR, extra: CLASSIFICACAO_NC.EXTRA_PDR }
  )

  // NUMERIC chega como string do pg; normaliza e compõe o total por fluxo.
  const norm = linhas.map(l => {
    const n = campo => Number(l[campo])
    return {
      cod_nd: l.cod_nd,
      nd_nome: l.nd_nome,
      previsto: n('previsto'),
      recebido: n('recebido_pdr') + n('recebido_extra'),
      recebido_pdr: n('recebido_pdr'),
      recebido_extra: n('recebido_extra'),
      recolhido: n('recolhido_pdr') + n('recolhido_extra'),
      recolhido_pdr: n('recolhido_pdr'),
      recolhido_extra: n('recolhido_extra'),
      empenhado: n('empenhado_pdr') + n('empenhado_extra'),
      empenhado_pdr: n('empenhado_pdr'),
      empenhado_extra: n('empenhado_extra'),
      liquidado: n('liquidado_pdr') + n('liquidado_extra'),
      liquidado_pdr: n('liquidado_pdr'),
      liquidado_extra: n('liquidado_extra')
    }
  })

  const campos = [
    'previsto', 'recebido', 'recebido_pdr', 'recebido_extra',
    'recolhido', 'recolhido_pdr', 'recolhido_extra',
    'empenhado', 'empenhado_pdr', 'empenhado_extra',
    'liquidado', 'liquidado_pdr', 'liquidado_extra'
  ]
  const total = norm.reduce((acc, l) => {
    for (const k of campos) acc[k] += l[k]
    return acc
  }, Object.fromEntries(campos.map(k => [k, 0])))

  norm.push({ cod_nd: 'TOTAL', nd_nome: 'TOTAL', ...total })

  return { linhas: norm, pendencias: await contarPendencias(ano) }
}

module.exports = controller
