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

// ---------------------------------------------------------------------------
// A identidade do item do pedido
// ---------------------------------------------------------------------------
//
// Desde 2026-07-30 o item aponta o acervo OU um produto avulso, nunca os dois
// (CHECK produto_pedido_um_destino). Avulso é o que a mapoteca imprime sem ser
// nosso: papel quadriculado, carta de outro CGEO, impresso de ocasião.
//
// ATENÇÃO, e é a razão de estes fragmentos existirem: `JOIN acervo.versao` é
// INNER, e num item avulso `pp.uuid_versao` é NULO. Todo INNER JOIN daquele
// tipo APAGA da consulta, calado, cada item avulso. Não dá erro, não dá aviso:
// dá número menor. Quem soma item do pedido usa JOIN_PRODUTO_ITEM e os campos
// abaixo, e não precisa saber que existem dois destinos.
//
// Aliases que estes fragmentos criam e esperam: pp = mapoteca.produto_pedido,
// v = acervo.versao, prod = acervo.produto, pa = mapoteca.produto_avulso,
// tp = dominio.tipo_produto, te = dominio.tipo_escala.
const JOIN_PRODUTO_ITEM = `
      LEFT JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
      LEFT JOIN acervo.produto prod ON prod.id = v.produto_id
      LEFT JOIN mapoteca.produto_avulso pa ON pa.id = pp.produto_avulso_id
      LEFT JOIN dominio.tipo_produto tp ON tp.code = COALESCE(prod.tipo_produto_id, pa.tipo_produto_id)
      LEFT JOIN dominio.tipo_escala te ON te.code = COALESCE(prod.tipo_escala_id, pa.tipo_escala_id)`;

// O produto do item, venha de onde vier.
const PRODUTO_NOME = "COALESCE(prod.nome, pa.nome)";
const PRODUTO_MI = "COALESCE(prod.mi, pa.mi)";
const PRODUTO_INOM = "prod.inom"; // avulso não tem INOM
const PRODUTO_TIPO_ID = "COALESCE(prod.tipo_produto_id, pa.tipo_produto_id)";
const PRODUTO_ESCALA_ID = "COALESCE(prod.tipo_escala_id, pa.tipo_escala_id)";
const ITEM_E_AVULSO = "(pp.produto_avulso_id IS NOT NULL)";

// Exibição de escala do PRODUTO DO ACERVO: personalizada vira '1:<denominador>',
// senão o nome do domínio. Exige só os aliases prod e te.
//
// Use este nas consultas que partem do acervo (mapa, integração, catálogo). Nas
// que partem do ITEM do pedido use ESCALA_DISPLAY_ITEM, abaixo: aquele também lê
// o produto avulso, e por isso exige o alias pa. Trocar um pelo outro numa
// consulta sem pa dá "missing FROM-entry for table pa" na primeira execução.
const ESCALA_DISPLAY = `CASE WHEN prod.tipo_escala_id = ${TIPO_ESCALA.ESCALA_PERSONALIZADA} AND prod.denominador_escala_especial IS NOT NULL
           THEN '1:' || prod.denominador_escala_especial
           ELSE te.nome
      END`;

// Idem, para consultas que partem do ITEM do pedido: lê dos dois destinos,
// porque o avulso também pode ter escala (a carta de outro CGEO tem; o papel
// quadriculado não tem nenhuma, e aí sai nulo). Exige os aliases prod, pa e te,
// todos criados por JOIN_PRODUTO_ITEM.
const ESCALA_DISPLAY_ITEM = `CASE WHEN COALESCE(prod.tipo_escala_id, pa.tipo_escala_id) = ${TIPO_ESCALA.ESCALA_PERSONALIZADA}
            AND COALESCE(prod.denominador_escala_especial, pa.denominador_escala_especial) IS NOT NULL
           THEN '1:' || COALESCE(prod.denominador_escala_especial, pa.denominador_escala_especial)
           ELSE te.nome
      END`;

// Situações que contam como pedido EM ABERTO: todas menos Concluído (5) e
// Cancelado (6). É a fila de trabalho da tela de atendimento.
//
// Remetido (4) fica DENTRO de propósito: o pedido saiu, mas ainda falta fechar.
// Tirá-lo faria o pedido desaparecer da fila no meio do caminho, sem ninguém ter
// marcado nada como concluído.
const SITUACOES_EM_ABERTO = [1, 2, 3, 4, 7];

// O arquivo IMPRIMÍVEL de uma versão: o PDF do produto cartográfico em si.
//
// A regra é uma só, usada pelo download do plugin (prepareDownloadImpressao) e
// pela tela de atendimento (getImpressaoDoPedido). Ela mora aqui porque as duas
// TÊM de escolher o mesmo arquivo: com regras separadas, a tela mandaria imprimir
// um PDF e o plugin baixaria outro.
//
// Só tipo 1 (arquivo principal) e 2 (formato alternativo): sem isso entram os
// PDFs de metadado e de documento, que não são a carta. Aliases esperados:
// `v` = acervo.versao, `a` = acervo.arquivo, `vol` = volume. Requer os
// parâmetros $<statusCarregado> e $<tiposImprimiveis:csv>.
const JOIN_ARQUIVO_IMPRIMIVEL = `
      LEFT JOIN acervo.arquivo a ON a.versao_id = v.id
        AND LOWER(a.extensao) = 'pdf'
        AND a.tipo_status_id = $<statusCarregado>
        AND a.tipo_arquivo_id IN ($<tiposImprimiveis:csv>)
      LEFT JOIN acervo.volume_armazenamento vol ON vol.id = a.volume_armazenamento_id`;

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
  ESCALA_DISPLAY_ITEM,
  JOIN_PRODUTO_ITEM,
  PRODUTO_NOME,
  PRODUTO_MI,
  PRODUTO_INOM,
  PRODUTO_TIPO_ID,
  PRODUTO_ESCALA_ID,
  ITEM_E_AVULSO,
  SITUACOES_EM_ABERTO,
  JOIN_ARQUIVO_IMPRIMIVEL,
  filtroAno,
  filtroPeriodoMes
};
