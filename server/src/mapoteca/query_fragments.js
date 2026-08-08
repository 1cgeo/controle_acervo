"use strict";

const {
  domainConstants: { TIPO_ESCALA, SITUACAO_PEDIDO }
} = require("../utils");

/**
 * Fragmentos SQL com as regras de negócio compartilhadas entre os relatórios
 * (relatorio_ctrl.js) e o dashboard (dashboard_ctrl.js) da mapoteca.
 * São strings estáticas (sem entrada de usuário), interpoladas via template
 * literal nas queries. Aliases esperados: pp = mapoteca.produto_pedido,
 * prod = acervo.produto, te = dominio.tipo_escala.
 */

// A quantidade efetivamente entregue de um item.
//
// ERA `COALESCE(pp.quantidade_fornecida, pp.quantidade)`, e virou a coluna
// prevista SOZINHA em 2026-08-08, quando `quantidade_fornecida` foi podada:
// medida na produção, ela era IGUAL a `quantidade` em 1759 de 1759 linhas
// preenchidas, sem uma única divergência. Nenhum número publicado mudou -- onde
// a coluna era nula o COALESCE já caía aqui, e onde era preenchida ela valia
// isto mesmo.
//
// O FRAGMENTO CONTINUA EXISTINDO, e não virou `pp.quantidade` escrito nas onze
// consultas que o usam. Ele é o lugar onde a pergunta "quanto se entregou" tem
// UMA resposta; o dia em que ela voltar a ter duas partes (e o candidato natural
// é a soma de `mapoteca.impressao_item`), muda aqui e muda em todas.
const QTD_EFETIVA = "pp.quantidade";

// A mídia efetivamente usada: fornecida com fallback na prevista.
//
// NÃO caiu junto com a quantidade acima, e o sufixo igual é coincidência: esta
// tem 25 DIVERGÊNCIAS reais nas mesmas 1759 linhas (item pedido em tyvek e
// atendido em sulfite). O COALESCE aqui decide de verdade.
const MIDIA_EFETIVA = "COALESCE(pp.tipo_midia_fornecida_id, pp.tipo_midia_id)";

// NAO existe fragmento de "data efetiva de entrega": a data de entrega e do
// PEDIDO, e chama-se `data_atendimento`. Quem precisa dela escreve
// `ped.data_atendimento`, sem COALESCE e sem fragmento.

// ---------------------------------------------------------------------------
// A identidade do item do pedido
// ---------------------------------------------------------------------------
//
// O item aponta o acervo OU um produto avulso, nunca os dois (CHECK
// `produto_pedido_um_destino`). Avulso é o que a mapoteca imprime sem ser nosso:
// papel quadriculado, carta de outro CGEO, impresso de ocasião.
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

// Idem, para consultas que partem do ITEM do pedido, com uma diferenca: o item
// AVULSO nao tem escala, e aqui isso vira 'Sem escala' em vez de NULO.
//
// O avulso e impresso de ocasiao, e o que houver de dimensao vai na descricao
// dele. Como ele nao aponta produto do acervo, `prod.tipo_escala_id` e nulo e o
// CASE acima devolveria NULO, que a tela mostra como a palavra "null" (foi assim
// que nasceu uma fatia chamada `null` no grafico do dashboard).
//
// O COALESCE mora AQUI, e nao em cada consulta, porque a pergunta e sempre a
// mesma: como se ESCREVE a escala deste item. Deixar para o chamador e o que
// permite quatro consultas acertarem e uma esquecer.
const ESCALA_DISPLAY_ITEM = `COALESCE(${ESCALA_DISPLAY}, 'Sem escala')`;

// AS DUAS FILAS DO PEDIDO, e por que não é uma só.
//
// Havia aqui um `SITUACOES_EM_ABERTO` único, com 1, 2 e 3. O nome não dizia EM
// ABERTO PARA QUEM, e a mesma lista respondia a duas perguntas diferentes. As
// situações vêm de `mapoteca.situacao_pedido` (er/mapoteca.sql):
// 2 Pedido Recebido, 3 Em andamento, 4 Remetido, 5 Concluído, 6 Cancelado,
// 7 Aguardando produção. NÃO EXISTE 1: 'Pré cadastramento' saiu em 2026-08-08
// com zero pedidos, e as duas listas perderam um elemento cada.
//
// A pergunta de quem IMPRIME: o que ainda falta imprimir?
// A pergunta de quem ATENDE: o que ainda falta FECHAR?
//
// Remetido (4) separa as duas. O pedido remetido já foi impresso, etiquetado e
// despachado, então some da fila de impressão com razão. Mas ele ainda espera a
// marca de Concluído, e quem atende é quem a dá. Numa lista só, ou o impressor
// via trabalho já feito, ou o atendente perdia o pedido de vista.
//
// Fora das DUAS listas ficam Concluído (5), Cancelado (6) e Aguardando
// produção (7). Aguardando produção fica fora porque o pedido espera carta que
// AINDA NÃO EXISTE: fila que mostra o impossível deixa de ser fila.

// A fila de IMPRESSÃO: o que a mapoteca ainda tem de imprimir. É o que o plugin
// do QGIS lê (ferramentas_mapoteca/gui/pedidos/pedidos_dialog.py), e ele monta a
// lista de download a partir dela. Remetido NÃO entra: reimprimir o que já saiu
// é o erro que esta lista existe para evitar.
const SITUACOES_FILA_IMPRESSAO = [
  SITUACAO_PEDIDO.PEDIDO_RECEBIDO,
  SITUACAO_PEDIDO.EM_ANDAMENTO
];

// A fila de ATENDIMENTO: o que ainda tem de ser fechado. É a de impressão mais
// Remetido (4). Sem o Remetido aqui, o pedido despachado sumia da tela de
// atendimento e dependia de alguém achá-lo na lista de pedidos, pelo filtro de
// situação, para marcar Concluído. Ele ficava aberto por tempo indefinido.
const SITUACOES_FILA_ATENDIMENTO = [
  ...SITUACOES_FILA_IMPRESSAO,
  SITUACAO_PEDIDO.REMETIDO
];

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

// O pivô de produtos entregues por tipo e escala, agregado por pedido. É o
// corpo da CTE `agregado` das duas abas que o publicam: a "Mil" (só clientes
// militares) e o resumo anual (todos os clientes).
//
// Mora aqui pelo mesmo motivo do ESCALA_DISPLAY_ITEM acima: as duas abas TÊM de
// contar igual. São treze colunas com a mesma régua repetida, e a régua não é
// óbvia -- `outros_produtos` é definido por NEGAÇÃO (o que não é Topo nem Orto
// nas escalas padrão), então acrescentar uma escala ao pivô sem mexer nesse
// FILTER faz a coluna nova entrar em dobro, somada também em "outros". Com duas
// cópias, bastava corrigir uma e as abas passariam a divergir em silêncio.
//
// Espera a CTE `itens` com as colunas qtd, tipo_produto_id, tipo_escala_id e
// digital, e os parâmetros $<tipoTopo>, $<tipoOrto>, $<escala25k>, $<escala50k>,
// $<escala100k>, $<escala250k> e $<escalasPadrao:csv>.
const PIVO_TIPO_ESCALA = `
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoTopo> AND tipo_escala_id = $<escala25k>) AS topo_25k,
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoTopo> AND tipo_escala_id = $<escala50k>) AS topo_50k,
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoTopo> AND tipo_escala_id = $<escala100k>) AS topo_100k,
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoTopo> AND tipo_escala_id = $<escala250k>) AS topo_250k,
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoTopo> AND tipo_escala_id IN ($<escalasPadrao:csv>)) AS total_topo,
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoOrto> AND tipo_escala_id = $<escala25k>) AS orto_25k,
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoOrto> AND tipo_escala_id = $<escala50k>) AS orto_50k,
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoOrto> AND tipo_escala_id = $<escala100k>) AS orto_100k,
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoOrto> AND tipo_escala_id = $<escala250k>) AS orto_250k,
        SUM(qtd) FILTER (WHERE NOT digital AND tipo_produto_id = $<tipoOrto> AND tipo_escala_id IN ($<escalasPadrao:csv>)) AS total_orto,
        SUM(qtd) FILTER (WHERE NOT digital AND NOT (tipo_produto_id IN ($<tipoTopo>, $<tipoOrto>) AND tipo_escala_id IN ($<escalasPadrao:csv>))) AS outros_produtos,
        SUM(qtd) FILTER (WHERE digital) AS produtos_digitais,
        SUM(qtd) AS total`;

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
  PRODUTO_TIPO_ID,
  PRODUTO_ESCALA_ID,
  ITEM_E_AVULSO,
  PIVO_TIPO_ESCALA,
  SITUACOES_FILA_IMPRESSAO,
  SITUACOES_FILA_ATENDIMENTO,
  JOIN_ARQUIVO_IMPRIMIVEL,
  filtroAno,
  filtroPeriodoMes
};
