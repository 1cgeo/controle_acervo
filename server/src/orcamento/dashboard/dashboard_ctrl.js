// Path: orcamento\dashboard\dashboard_ctrl.js
'use strict'

// Execução orçamentária por natureza de despesa: a fonte das três abas do
// dashboard do orçamento (cards, gráfico por ND e as duas tabelas).
//
// POR QUE ELA NÃO FOI PARA O RPCMTec junto com o resto. Esta consulta esteve em
// `orcamento/relatorio/relatorio_ctrl.js` como "tabela 3.1" até 2026-08-01, e
// era usada por DUAS telas com necessidades diferentes:
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
 * ano, e sumir com ele faria o painel mostrar menos do que o banco tem.
 *
 * @param {{ano:number, mes:number}} params
 * @returns {Promise<Array<Object>>}
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

  return norm
}

module.exports = controller
