// Path: mapoteca\query_fragments.js
"use strict";

const {
  domainConstants: { TIPO_ESCALA }
} = require("../utils");

/**
 * Fragmentos SQL com as regras de negócio compartilhadas entre os relatórios
 * (relatorio_ctrl.js) e o dashboard (dashboard_ctrl.js) da mapoteca.
 * São strings estáticas (sem entrada de usuário), interpoladas via template
 * literal nas queries. Aliases esperados: pp = mapoteca.produto_pedido,
 * prod = acervo.produto, te = dominio.tipo_escala.
 */

// Quantidade efetivamente entregue: fornecida com fallback na prevista
const QTD_EFETIVA = "COALESCE(pp.quantidade_fornecida, pp.quantidade)";

// Mídia efetivamente usada: fornecida com fallback na prevista
const MIDIA_EFETIVA = "COALESCE(pp.tipo_midia_fornecida_id, pp.tipo_midia_id)";

// Data efetiva de entrega por item: data do item com fallback no fechamento do pedido
const dataEntregaEfetiva = (pedidoAlias = "ped") =>
  `COALESCE(pp.data_entrega, ${pedidoAlias}.data_atendimento::date)`;

// Exibição de escala: personalizada vira '1:<denominador>', senão o nome do domínio
const ESCALA_DISPLAY = `CASE WHEN prod.tipo_escala_id = ${TIPO_ESCALA.ESCALA_PERSONALIZADA} AND prod.denominador_escala_especial IS NOT NULL
           THEN '1:' || prod.denominador_escala_especial
           ELSE te.nome
      END`;

// Filtro sargável de ano sobre uma coluna de data/timestamp (usa índice btree,
// ao contrário de EXTRACT(YEAR FROM col) = ano). Requer parâmetro $<ano>.
const filtroAno = (coluna) =>
  `${coluna} >= make_date($<ano>, 1, 1) AND ${coluna} < make_date($<ano> + 1, 1, 1)`;

// Filtro sargável por mês de um ano, com modo cumulativo (acumulado no ano até
// o mês, como exige o RPCMTec). Requer os parâmetros $<ano> e $<mes>.
//  - cumulativo = false: apenas o mês $<mes> (>= 1º dia, < 1º dia do mês seguinte).
//  - cumulativo = true:  de 1º de janeiro até o fim do mês $<mes> (inclusive).
// O limite superior é sempre o início do mês seguinte ($<mes> + 1 via interval),
// que o Postgres normaliza quando $<mes> = 12 (vira janeiro do ano seguinte).
const filtroPeriodoMes = (coluna, { cumulativo = false } = {}) => {
  const inicio = cumulativo
    ? "make_date($<ano>, 1, 1)"
    : "make_date($<ano>, $<mes>, 1)";
  const fim = "(make_date($<ano>, $<mes>, 1) + interval '1 month')";
  return `${coluna} >= ${inicio} AND ${coluna} < ${fim}`;
};

module.exports = {
  QTD_EFETIVA,
  MIDIA_EFETIVA,
  dataEntregaEfetiva,
  ESCALA_DISPLAY,
  filtroAno,
  filtroPeriodoMes
};
