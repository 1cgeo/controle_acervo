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

// NAO existe mais fragmento de "data efetiva de entrega". Ele era
// COALESCE(pp.data_entrega, ped.data_atendimento), e em 2026-07-30 a coluna do
// item saiu: a data de entrega e do PEDIDO, e chama-se data_atendimento. Quem
// precisa dela escreve `ped.data_atendimento`, sem COALESCE e sem fragmento.

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
// v = acervo.versao, prod = acervo.produto, tp = dominio.tipo_produto,
// te = dominio.tipo_escala. O avulso nao tem tabela: mora em pp.nome_avulso.
const JOIN_PRODUTO_ITEM = `
      LEFT JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
      LEFT JOIN acervo.produto prod ON prod.id = v.produto_id
      LEFT JOIN dominio.tipo_produto tp ON tp.code = prod.tipo_produto_id
      LEFT JOIN dominio.tipo_escala te ON te.code = prod.tipo_escala_id`;

// O produto do item, venha de onde vier. O avulso é descrito no próprio item
// (nome_avulso), e não num catálogo: ele é impresso de ocasião, e o que merecer
// cadastro estável merece estar no acervo.
const PRODUTO_NOME = "COALESCE(prod.nome, pp.nome_avulso)";
const PRODUTO_MI = "prod.mi";        // avulso não tem MI
const PRODUTO_INOM = "prod.inom";    // nem INOM
const PRODUTO_TIPO_ID = "prod.tipo_produto_id";
const PRODUTO_ESCALA_ID = "prod.tipo_escala_id";
const ITEM_E_AVULSO = "(pp.nome_avulso IS NOT NULL)";

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

// Idem, para consultas que partem do ITEM do pedido. Hoje e identico ao de
// cima, porque o item avulso nao tem escala: ele e impresso de ocasiao, e o que
// houver de dimensao vai na descricao. Fica separado de proposito, para que uma
// consulta de item nao passe a depender de um fragmento pensado para o acervo.
const ESCALA_DISPLAY_ITEM = ESCALA_DISPLAY;

// Situações que contam como pedido EM ABERTO: a fila de trabalho da tela de
// atendimento. Ficam de fora Concluído (5), Cancelado (6), Aguardando
// produção (7) e Remetido (4).
//
// A régua é uma só: a fila mostra o que a mapoteca AINDA TEM DE FAZER. As duas
// exclusões vieram do chefe, por esse mesmo critério.
//
// Aguardando produção (7) saiu em 2026-07-30. O pedido nessa situação espera
// carta que AINDA NÃO EXISTE. Não é trabalho de quem imprime, e fila que mostra
// o impossível deixa de ser fila. Na produção eram 2 pedidos assim (ids 127 e
// 128, com 33 e 16 itens), sempre no topo da tela e nunca atendíveis.
//
// Remetido (4) saiu em 2026-07-31. O pedido já foi impresso, etiquetado e
// despachado: as três ações que esta tela oferece já foram feitas, e a linha só
// ocupava a fila. Na produção era 1 pedido, contra 20 Em andamento.
//
// O PREÇO, que é real: pedido Remetido some da fila e depende de alguém marcar
// Concluído pela lista de pedidos, sem nada aqui lembrando disso. Os dois
// continuam visíveis lá, pelo filtro de situação.
const SITUACOES_EM_ABERTO = [1, 2, 3];

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
