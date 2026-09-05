"use strict";

const { db } = require("../database");
// DE QUEM É ESTA INSTALAÇÃO, no ponto único. `instituicao/` é de PLATAFORMA e
// não conhece a mapoteca, então não há ciclo.
const instituicaoCtrl = require("../instituicao/instituicao_ctrl");
const {
  domainConstants: {
    TIPO_PRODUTO,
    TIPO_CLIENTE,
    TIPO_MIDIA,
    TIPO_ESCALA,
    STATUS_ARQUIVO
  }
} = require("../utils");
const {
  QTD_EFETIVA,
  MIDIA_EFETIVA,
  META_DO_ITEM,
  PEDIDO_NAO_CANCELADO,
  ESCALA_DISPLAY,
  ESCALA_DISPLAY_ITEM,
  JOIN_PRODUTO_ITEM,
  PRODUTO_NOME,
  PRODUTO_MI,
  PRODUTO_TIPO_ID,
  PRODUTO_ESCALA_ID,
  ITEM_E_AVULSO,
  PIVO_TIPO_ESCALA,
  filtroAno,
  filtroPeriodoMes
} = require("./query_fragments");

const controller = {};

// Tipos de cliente militares (abas Mil) versus civis (abas Civ)
const TIPOS_CLIENTE_MILITAR = [
  TIPO_CLIENTE.OM_EB,
  TIPO_CLIENTE.OM_AERONAUTICA,
  TIPO_CLIENTE.OM_MARINHA
];

const ESCALAS_PADRAO = [
  TIPO_ESCALA.ESCALA_25K,
  TIPO_ESCALA.ESCALA_50K,
  TIPO_ESCALA.ESCALA_100K,
  TIPO_ESCALA.ESCALA_250K
];

// A coluna "OMDS" da aba META4_DETALHADA do RTM: a OM Diretamente Subordinada
// responsável pelo atendimento, que é SEMPRE esta casa.
//
// Ela foi coluna de `mapoteca.pedido` até 2026-08-08, e saiu por medição: 124
// linhas preenchidas e UM único valor distinto em todas ('1º CGEO'), mais 42
// vazias. Era uma constante que o formulário pedia que se redigitasse a cada
// pedido, e as 42 vazias eram o que acontece quando se pede isso.
//
// Continua SAINDO na planilha, porque a aba do RTM tem quinze colunas fixas e
// esta é a primeira delas.
//
// DEIXOU DE SER LITERAL EM 2026-08-09. Ela virou `const OMDS = "1º CGEO"` aqui,
// com a razão escrita de que "quem gera o relatório do 1º CGEO é o 1º CGEO" --
// e a frase era verdadeira e a conclusão, errada: quem gera o relatório desta
// instalação é a instituição DELA, que `dgeo.instituicao` diz qual é. Outro
// Centro que instalasse o SAP mandaria à DSG uma aba com a sigla desta casa em
// todas as linhas.
//
// A SIGLA, e não o nome por extenso: a coluna da aba é estreita e o que a
// planilha do chefe traz nela é '1º CGEO'. A leitura é de `paraDocumento()`, o
// ponto único (ver `instituicao/instituicao_ctrl.js`), e acontece UMA vez por
// relatório gerado -- não por linha, e não em cache.

/**
 * Relatório anual de pedidos militares (reproduz a aba "Mil" da planilha).
 * Uma linha por pedido, com pivô de quantidades por escala × tipo de produto.
 * Colunas Offset saem sempre 0: a mapoteca não fornece mais estoque offset.
 *
 * Classificação (segue a aba Mil): mídia Digital tem coluna própria; itens
 * impressos Topo/Orto fora das escalas padrão contam em "outros_produtos".
 * Difere de getEntregasPorMes (dashboard_ctrl), que classifica só por tipo de
 * produto, como a tabela-resumo mensal da aba Detalhado.
 */
controller.getRelatorioPedidosMil = async (ano) => {
  return db.conn.any(
    `
    WITH pedidos_mil AS (
      SELECT p.*, c.nome AS cliente_nome, c.endereco_entrega_principal
      FROM mapoteca.pedido p
      JOIN mapoteca.cliente c ON c.id = p.cliente_id
      WHERE c.tipo_cliente_id IN ($<tiposMilitar:csv>)
        AND ${filtroAno("p.data_pedido")}
    ),
    itens AS (
      SELECT pp.pedido_id,
             ${QTD_EFETIVA} AS qtd,
             ${PRODUTO_TIPO_ID} AS tipo_produto_id,
             ${PRODUTO_ESCALA_ID} AS tipo_escala_id,
             (${MIDIA_EFETIVA} = $<midiaDigital>) AS digital
      FROM mapoteca.produto_pedido pp
      JOIN pedidos_mil pm ON pm.id = pp.pedido_id
      -- LEFT, e nao INNER: o item avulso nao tem versao, e um INNER o apagaria
      -- da coluna Total da aba Mil. Sem tipo nem escala do dominio, ele cai no
      -- FILTER de "outros_produtos", que e exatamente onde a aba o espera.
      ${JOIN_PRODUTO_ITEM}
      -- Fora do WHERE, e nunca dentro dos treze FILTER do PIVO_TIPO_ESCALA:
      -- a coluna outros_produtos e definida por NEGACAO, e um FILTER esquecido
      -- linha nao fechar.
      WHERE ${PEDIDO_NAO_CANCELADO("pm")}
    ),
    agregado AS (
      SELECT pedido_id,${PIVO_TIPO_ESCALA}
      FROM itens
      GROUP BY pedido_id
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY p.data_pedido, p.id)::int AS numero,
      p.id AS pedido_id,
      p.localizador_pedido,
      -- Pergunta ao banco, e nao ao agregado: desde que a CTE itens exclui o
      -- pedido cancelado, derivar daqui faria um cancelado COM itens sair como
      -- "ninguem detalhou". A coluna diz se ha item, e as treze de quantidade
      -- e que dizem quanto conta.
      EXISTS (
        SELECT 1 FROM mapoteca.produto_pedido pp2 WHERE pp2.pedido_id = p.id
      ) AS possui_detalhamento,
      p.data_pedido,
      p.documento_solicitacao,
      p.previsto_pit,
      sp.nome AS situacao,
      p.cliente_nome AS unidade,
      COALESCE(p.endereco_entrega, p.endereco_entrega_principal) AS endereco,
      p.data_atendimento AS data_envio,
      CASE WHEN p.data_atendimento IS NOT NULL
           -- Dias inteiros. O ::date vale para TIMESTAMPTZ e para DATE,
           -- entao a migracao das colunas nao quebra esta conta.
           THEN (p.data_atendimento::date - p.data_pedido::date)
      END AS tempo_atendimento_dias,
      p.localizador_envio AS informacoes_remessa,
      p.observacao,
      p.operacao,
      0 AS off_25k, 0 AS off_50k, 0 AS off_100k, 0 AS off_250k, 0 AS total_offset,
      COALESCE(a.topo_25k, 0)::int AS topo_25k,
      COALESCE(a.topo_50k, 0)::int AS topo_50k,
      COALESCE(a.topo_100k, 0)::int AS topo_100k,
      COALESCE(a.topo_250k, 0)::int AS topo_250k,
      COALESCE(a.total_topo, 0)::int AS total_topo,
      COALESCE(a.orto_25k, 0)::int AS orto_25k,
      COALESCE(a.orto_50k, 0)::int AS orto_50k,
      COALESCE(a.orto_100k, 0)::int AS orto_100k,
      COALESCE(a.orto_250k, 0)::int AS orto_250k,
      COALESCE(a.total_orto, 0)::int AS total_orto,
      COALESCE(a.outros_produtos, 0)::int AS outros_produtos,
      COALESCE(a.produtos_digitais, 0)::int AS produtos_digitais,
      COALESCE(a.total, 0)::int AS total
    FROM pedidos_mil p
    JOIN mapoteca.situacao_pedido sp ON sp.code = p.situacao_pedido_id
    LEFT JOIN agregado a ON a.pedido_id = p.id
    ORDER BY p.data_pedido, p.id
    `,
    {
      ano,
      tiposMilitar: TIPOS_CLIENTE_MILITAR,
      escalasPadrao: ESCALAS_PADRAO,
      midiaDigital: TIPO_MIDIA.DIGITAL,
      tipoTopo: TIPO_PRODUTO.CARTA_TOPOGRAFICA,
      tipoOrto: TIPO_PRODUTO.CARTA_ORTOIMAGEM,
      escala25k: TIPO_ESCALA.ESCALA_25K,
      escala50k: TIPO_ESCALA.ESCALA_50K,
      escala100k: TIPO_ESCALA.ESCALA_100K,
      escala250k: TIPO_ESCALA.ESCALA_250K
    }
  );
};

/**
 * Relatório detalhado por item (reproduz a aba "Detalhado" da planilha), que é a
 * mesma aba META4_DETALHADA do RTM.
 *
 * O `mes` é OPCIONAL e ACUMULA: com mes = 3 saem os itens de janeiro, fevereiro
 * e março; sem mes, o ano inteiro. É o que o RTM exige, porque ele sobe para a
 * DSG todo mês com o acumulado do exercício até ali.
 *
 * O recorte é por `p.data_pedido`, a MESMA coluna do filtro de ano.
 *
 * Sem `mes`, a consulta não muda em nada -- é o caminho de
 * `GET /api/mapoteca/relatorio/impressao_detalhada_ods`, que continua anual.
 *
 * Tipo/escala/MI sempre via catálogo do acervo (RN08).
 *
 * @param {number} ano
 * @param {number} [mes] - 1 a 12; acumula de janeiro até ele
 */
controller.getRelatorioPedidosDetalhado = async (ano, mes = null) => {
  const instituicao = await instituicaoCtrl.paraDocumento();

  return db.conn.any(
    `
    SELECT
      -- Parametro, e nao coluna: ver o bloco OMDS no topo deste arquivo.
      $<omds> AS omds,
      p.demandante,
      c.nome AS om_destino,
      p.previsto_pit,
      -- A coluna "Meta" da aba guarda o CODIGO do item do PIT ('4.1', '4.2'), e
      -- so vem preenchida no item coberto pelo PIT. E do ITEM: quando ele
      -- declara meta propria, e a dele que sai aqui, e nao a do pedido.
      --
      -- O pedido aponta o item por CHAVE (pit.meta_item), e o codigo sai do
      -- proprio cadastro do PIT: nunca texto digitado a mao, e nunca p.prazo, que
      -- poria uma DATA sob o rotulo "Meta". Nao se deriva do material, porque a
      -- correlacao entre midia e meta vale num ano e o PIT e reescrito todo ano.
      COALESCE(mp.item, mp.numero_meta::text) AS meta,
      -- O DIEx alimenta a coluna "Observações" da aba META4_DETALHADA, que na
      -- planilha do chefe traz quase sempre o número do documento.
      p.documento_solicitacao,
      -- O item avulso não tem tipo de produto no domínio, e sai com o próprio
      -- nome na coluna Produto: é o que a aba precisa mostrar para não ficar uma
      -- linha em branco.
      COALESCE(tp.nome, pp.nome_avulso) AS produto,
      ${PRODUTO_NOME} AS produto_nome,
      ${PRODUTO_MI} AS mi,
      ${ESCALA_DISPLAY_ITEM} AS escala,
      ${ITEM_E_AVULSO} AS item_avulso,
      pp.quantidade AS quantidade_prevista,
      tm.nome AS material_previsto,
      -- A coluna "Qnt Fornecida" da aba, que era pp.quantidade_fornecida até
      -- 2026-08-08 (sem crase: template literal). A coluna saiu, igual à
      -- prevista em 1759 de 1759 linhas preenchidas, e quem responde a pergunta
      -- passa a ser o fragmento de sempre.
      --
      -- O que MUDA na planilha, e é a única mudança visível desta poda: onde a
      -- coluna era NULA (795 itens de 2026) a célula saía em BRANCO e agora sai
      -- com o número. Nenhum valor já escrito muda; some o branco, que dizia
      -- "ninguém redigitou" e se lia como "não foi entregue".
      ${QTD_EFETIVA} AS quantidade_fornecida,
      -- A MÍDIA fornecida continua sendo coluna, com as 25 divergências dela.
      tmf.nome AS material_fornecido,
      -- As colunas "Data da Entrega" e "Forma da Entrega" da aba saem do PEDIDO,
      -- e nao do item. O nome da chave (data_entrega, forma_entrega) e o rotulo
      -- da aba do RTM, e trocar o nome so quebraria a exportacao.
      p.data_atendimento AS data_entrega,
      fe.nome AS forma_entrega,
      pp.observacao,
      CASE WHEN p.data_atendimento IS NOT NULL
           THEN EXTRACT(MONTH FROM p.data_atendimento)::int
      END AS mes,
      p.id AS pedido_id,
      p.localizador_pedido
    FROM mapoteca.produto_pedido pp
    JOIN mapoteca.pedido p ON p.id = pp.pedido_id
    -- A VIEW pit.meta_vigente, e nao a tabela pit.meta_item. A view junta o
    -- grupo (numero_meta, nome) com o item e com a declaracao em vigor, entao
    -- mp.descricao, mp.quantidade_prevista e mp.prazo saem preenchidos; pela
    -- tabela do item viriam NULOS, porque esses tres mudaram de casa para
    -- pit.meta_item_revisao. Erro que nao da erro: da coluna vazia no RTM.
    --
    -- O PEDIDO SEM DECLARACAO PUBLICADA sai com meta nula, e isso e deliberado:
    -- a view usa INNER JOIN LATERAL, e o item que revisao publicada nenhuma
    -- declarou ainda nao esta no plano.
    --
    -- A META E DO ITEM, com a do pedido de fallback (META_DO_ITEM). Junta-la so
    -- pela do pedido (sem crase: template literal) fazia o pedido MISTO sair
    -- inteiro na meta do pedido: as 8 folhas de tyvek do pedido 140 saiam
    -- rotuladas 4.1 nesta aba enquanto a tela do PIT ja as contava na 4.2, e o
    -- documento que sobe para a DSG contradizia a tela sem nada acusar. O
    -- fragmento e o mesmo que a execucao do PIT usa, e e por isso que ele mora
    -- em query_fragments.js.
    LEFT JOIN pit.meta_vigente mp ON mp.id = ${META_DO_ITEM}
    JOIN mapoteca.cliente c ON c.id = p.cliente_id
    -- LEFT, e não INNER: impressão avulsa conta na Meta 4 como qualquer outra, e
    -- um INNER aqui a apagaria da aba sem avisar.
    ${JOIN_PRODUTO_ITEM}
    JOIN mapoteca.tipo_midia tm ON tm.code = pp.tipo_midia_id
    LEFT JOIN mapoteca.tipo_midia tmf ON tmf.code = pp.tipo_midia_fornecida_id
    LEFT JOIN mapoteca.forma_entrega fe ON fe.code = p.forma_entrega_id
    WHERE ${mes ? filtroPeriodoMes("p.data_pedido", { cumulativo: true }) : filtroAno("p.data_pedido")}
      AND ${PEDIDO_NAO_CANCELADO("p")}
    ORDER BY p.data_pedido, p.id, pp.id
    `,
    { ano, mes, omds: instituicao.sigla }
  );
};

/**
 * Relatório anual de pedidos civis (reproduz a aba "Civ" da planilha).
 * Pedidos cujo cliente não é OM militar (LAI, órgãos públicos, pessoas).
 */
controller.getRelatorioPedidosCiv = async (ano) => {
  return db.conn.any(
    `
    SELECT
      ROW_NUMBER() OVER (ORDER BY p.data_pedido, p.id)::int AS ordem,
      p.data_pedido,
      c.nome AS solicitante,
      tc.nome AS tipo_cliente,
      cr.nome AS canal,
      p.documento_solicitacao AS numero_oficio,
      p.documento_solicitacao_nup AS nup_lai,
      p.municipio,
      p.observacao AS resumo_pedido,
      p.qtd_imagens,
      p.data_atendimento AS data_envio,
      sp.nome AS situacao,
      p.observacao_envio AS observacao,
      p.id AS pedido_id,
      p.localizador_pedido
    FROM mapoteca.pedido p
    JOIN mapoteca.cliente c ON c.id = p.cliente_id
    JOIN mapoteca.tipo_cliente tc ON tc.code = c.tipo_cliente_id
    JOIN mapoteca.situacao_pedido sp ON sp.code = p.situacao_pedido_id
    LEFT JOIN mapoteca.canal_recebimento cr ON cr.code = p.canal_recebimento_id
    WHERE c.tipo_cliente_id NOT IN ($<tiposMilitar:csv>)
      AND ${filtroAno("p.data_pedido")}
    ORDER BY p.data_pedido, p.id
    `,
    { ano, tiposMilitar: TIPOS_CLIENTE_MILITAR }
  );
};

/**
 * Relatório anual de produção temática (reproduz a aba "Mapas Temáticos").
 * Itens com producao_especifica = TRUE (RN07, marcador de produção sob demanda).
 * Seção/militar responsável vêm de acervo.versao (orgao_produtor e
 * metadado->>'responsavel'); tamanho é a soma dos arquivos carregados da versão.
 */
controller.getRelatorioTematicos = async (ano) => {
  return db.conn.any(
    `
    SELECT
      ROW_NUMBER() OVER (ORDER BY p.data_pedido, p.id, pp.id)::int AS ordem,
      COALESCE(v.nome, prod.nome) AS nome_projeto,
      c.nome AS demandante,
      tp.nome AS tipo_produto,
      p.observacao AS descricao_pedido,
      -- O dia em que o material saiu daqui, que e do PEDIDO: o item nao tem data
      -- de entrega propria, entao nao ha COALESCE.
      p.data_atendimento AS data_entrega,
      COALESCE(v.descricao, prod.descricao) AS descricao_produto,
      v.orgao_produtor AS secao_responsavel,
      v.metadado->>'responsavel' AS militar_responsavel,
      arq.tamanho_mb,
      p.id AS pedido_id,
      p.localizador_pedido
    FROM mapoteca.produto_pedido pp
    JOIN mapoteca.pedido p ON p.id = pp.pedido_id
    JOIN mapoteca.cliente c ON c.id = p.cliente_id
    -- INNER de PROPOSITO, e nao esquecimento do produto avulso: esta aba e
    -- sobre PRODUCAO, e tudo que ela mostra so existe na versao do acervo
    -- (orgao produtor, militar responsavel, MB de arquivo carregado). Um item
    -- avulso entraria como linha de nulos. Ele conta na Meta 4 (impressao), que
    -- e outra aba, e la o JOIN_PRODUTO_ITEM ja o inclui.
    JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
    JOIN acervo.produto prod ON prod.id = v.produto_id
    JOIN dominio.tipo_produto tp ON tp.code = prod.tipo_produto_id
    LEFT JOIN LATERAL (
      SELECT SUM(a.tamanho_mb) AS tamanho_mb
      FROM acervo.arquivo a
      WHERE a.versao_id = v.id
        AND a.tipo_status_id = $<statusCarregado>
    ) arq ON TRUE
    WHERE pp.producao_especifica = TRUE
      AND ${filtroAno("p.data_pedido")}
      AND ${PEDIDO_NAO_CANCELADO("p")}
    ORDER BY p.data_pedido, p.id, pp.id
    `,
    { ano, statusCarregado: STATUS_ARQUIVO.CARREGADO }
  );
};

/**
 * Relatório-resumo anual por pedido (uma linha por pedido), com dados de
 * identificação/envio e o consolidado de produtos entregues por tipo e escala.
 * Diferente do "Mil", abrange TODOS os clientes (não só OM militares) e expõe
 * apenas as colunas de envio + o pivô (sem endereço, remessa detalhada etc.).
 * Quantidade entregue = QTD_EFETIVA (fornecida com fallback na prevista).
 */
controller.getRelatorioPedidosResumo = async (ano) => {
  return db.conn.any(
    `
    WITH itens AS (
      SELECT pp.pedido_id,
             ${QTD_EFETIVA} AS qtd,
             ${PRODUTO_TIPO_ID} AS tipo_produto_id,
             ${PRODUTO_ESCALA_ID} AS tipo_escala_id,
             (${MIDIA_EFETIVA} = $<midiaDigital>) AS digital
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido p ON p.id = pp.pedido_id
      -- Mesmo motivo da aba Mil: o item avulso conta como produto entregue, e
      -- um INNER em acervo.versao o apagaria do total deste resumo.
      ${JOIN_PRODUTO_ITEM}
      WHERE ${filtroAno("p.data_pedido")}
        AND ${PEDIDO_NAO_CANCELADO("p")}
    ),
    agregado AS (
      SELECT pedido_id,${PIVO_TIPO_ESCALA}
      FROM itens
      GROUP BY pedido_id
    )
    SELECT
      p.id AS numero_pedido,
      c.nome AS unidade,
      p.documento_solicitacao AS documento,
      sp.nome AS status,
      p.data_atendimento AS data_envio,
      p.localizador_envio AS informacoes_envio,
      COALESCE(a.topo_25k, 0)::int AS topo_25k,
      COALESCE(a.topo_50k, 0)::int AS topo_50k,
      COALESCE(a.topo_100k, 0)::int AS topo_100k,
      COALESCE(a.topo_250k, 0)::int AS topo_250k,
      COALESCE(a.total_topo, 0)::int AS total_topo,
      COALESCE(a.orto_25k, 0)::int AS orto_25k,
      COALESCE(a.orto_50k, 0)::int AS orto_50k,
      COALESCE(a.orto_100k, 0)::int AS orto_100k,
      COALESCE(a.orto_250k, 0)::int AS orto_250k,
      COALESCE(a.total_orto, 0)::int AS total_orto,
      COALESCE(a.outros_produtos, 0)::int AS outros_produtos,
      COALESCE(a.produtos_digitais, 0)::int AS produtos_digitais,
      COALESCE(a.total, 0)::int AS total,
      p.id AS pedido_id,
      p.localizador_pedido
    FROM mapoteca.pedido p
    JOIN mapoteca.cliente c ON c.id = p.cliente_id
    JOIN mapoteca.situacao_pedido sp ON sp.code = p.situacao_pedido_id
    LEFT JOIN agregado a ON a.pedido_id = p.id
    WHERE ${filtroAno("p.data_pedido")}
    ORDER BY p.data_pedido, p.id
    `,
    {
      ano,
      midiaDigital: TIPO_MIDIA.DIGITAL,
      tipoTopo: TIPO_PRODUTO.CARTA_TOPOGRAFICA,
      tipoOrto: TIPO_PRODUTO.CARTA_ORTOIMAGEM,
      escala25k: TIPO_ESCALA.ESCALA_25K,
      escala50k: TIPO_ESCALA.ESCALA_50K,
      escala100k: TIPO_ESCALA.ESCALA_100K,
      escala250k: TIPO_ESCALA.ESCALA_250K,
      escalasPadrao: ESCALAS_PADRAO
    }
  );
};

// Colunas para exportação CSV (rótulos espelham os cabeçalhos da planilha)
controller.COLUNAS_MIL = [
  { key: "numero", label: "Nº" },
  { key: "possui_detalhamento", label: "Det.?" },
  { key: "data_pedido", label: "Data Pedido" },
  { key: "documento_solicitacao", label: "Número do DIEx" },
  { key: "previsto_pit", label: "Previsto no PIT" },
  { key: "situacao", label: "Status" },
  { key: "unidade", label: "Unidade" },
  { key: "endereco", label: "Endereço" },
  { key: "data_envio", label: "Data Envio/Retirada" },
  { key: "tempo_atendimento_dias", label: "Tempo Atendimento (dias)" },
  { key: "informacoes_remessa", label: "Informações de Remessa" },
  { key: "observacao", label: "Observação" },
  { key: "operacao", label: "Operação" },
  { key: "off_25k", label: "25k Off" },
  { key: "off_50k", label: "50k Off" },
  { key: "off_100k", label: "100k Off" },
  { key: "off_250k", label: "250k Off" },
  { key: "total_offset", label: "Total Offset" },
  { key: "topo_25k", label: "25k Topo Imp" },
  { key: "topo_50k", label: "50k Topo Imp" },
  { key: "topo_100k", label: "100k Topo Imp" },
  { key: "topo_250k", label: "250k Topo Imp" },
  { key: "total_topo", label: "Total Topo Imp" },
  { key: "orto_25k", label: "25k Orto Imp" },
  { key: "orto_50k", label: "50k Orto Imp" },
  { key: "orto_100k", label: "100k Orto Imp" },
  { key: "orto_250k", label: "250k Orto Imp" },
  { key: "total_orto", label: "Total Orto Imp" },
  { key: "outros_produtos", label: "Outros Produtos" },
  { key: "produtos_digitais", label: "Produtos Digitais" },
  { key: "total", label: "Total" },
  { key: "localizador_pedido", label: "Localizador" }
];

controller.COLUNAS_DETALHADO = [
  { key: "omds", label: "OMDS" },
  { key: "demandante", label: "Demandante" },
  { key: "om_destino", label: "OM Destino" },
  { key: "previsto_pit", label: "Previsto no PIT" },
  { key: "meta", label: "Meta" },
  { key: "produto", label: "Produto" },
  { key: "produto_nome", label: "Nome do Produto" },
  { key: "mi", label: "MI" },
  { key: "escala", label: "Escala" },
  { key: "quantidade_prevista", label: "Qnt Prevista" },
  { key: "material_previsto", label: "Material Previsto" },
  { key: "quantidade_fornecida", label: "Qnt Fornecida" },
  { key: "material_fornecido", label: "Material Fornecido" },
  { key: "data_entrega", label: "Data da Entrega" },
  { key: "forma_entrega", label: "Forma da Entrega" },
  { key: "observacao", label: "Observações" },
  { key: "mes", label: "Mês" },
  { key: "localizador_pedido", label: "Localizador" }
];

// Exportação "Impressão Detalhada": recorte enxuto do relatório Detalhado com
// exatamente as 15 colunas da planilha impressao_detalhada (sem nome do produto,
// mês ou localizador). Reaproveita a query getRelatorioPedidosDetalhado.
controller.COLUNAS_IMPRESSAO_DETALHADA = [
  { key: "omds", label: "OMDS" },
  { key: "demandante", label: "Demandante" },
  { key: "om_destino", label: "OM Destino" },
  { key: "previsto_pit", label: "Previsto no PIT" },
  { key: "meta", label: "Meta" },
  { key: "produto", label: "Produto" },
  { key: "mi", label: "MI" },
  { key: "escala", label: "Escala" },
  { key: "quantidade_prevista", label: "Qnt Prevista" },
  { key: "material_previsto", label: "Material Previsto" },
  { key: "quantidade_fornecida", label: "Qnt Fornecida" },
  { key: "material_fornecido", label: "Material Fornecido" },
  { key: "data_entrega", label: "Data da Entrega" },
  { key: "forma_entrega", label: "Forma da Entrega" },
  { key: "observacao", label: "Observações" }
];

// ---------------------------------------------------------------------------
// META4_DETALHADA: a mesma "Impressão Detalhada", na FORMA da aba do RTM
// ---------------------------------------------------------------------------
//
// O destino é a aba META4_DETALHADA do RTM mensal do 1º CGEO, que se preenche
// colando linhas. O CSV serve para conferir e para quem quer os dados crus; o
// .ods sai da planilha-SEMENTE da própria aba (`rpcmtec/rtm_ods.js`), com a
// largura de coluna, o painel congelado e os estilos dela.
//
// A aba escreve o material em minúscula e sem a gramatura ('sulfite', e não
// 'Sulfite 90g'), porque ela nunca distinguiu 90g de 120g. Quem precisa da
// gramatura tem o CSV, que traz o nome do domínio como está no banco.
const materialDaAba = (nome) => {
  if (!nome) return null;
  return String(nome)
    .toLowerCase()
    .replace(/\s*\d+\s*g$/, "")
    .replace(/\s*\(tecido\)$/, "")
    .trim();
};

/**
 * Traduz as linhas do relatório Detalhado para o vocabulário da aba.
 *
 * O que muda em relação ao CSV, e por quê:
 *  - previsto_pit: booleano -> 'sim'/'não' minúsculo, como na aba;
 *  - material: 'Sulfite 90g' -> 'sulfite' (ver materialDaAba);
 *  - MI e material fornecido ausentes -> '-', que é o que a aba escreve na
 *    Carta Especial (sem folha MI) e no item sem mídia registrada;
 *  - Meta: '-' quando o item não é do PIT. Quando é, sai o código da meta
 *    apontada por pedido.meta_pit_id ('4.1'). Fica VAZIA só no pedido marcado
 *    como previsto sem meta, o que o CHECK do banco não deixa acontecer;
 *  - Observações: o DIEx do pedido, que é o que a aba costuma trazer nessa
 *    coluna, mais a observação do item quando houver.
 *
 * @param {Array<Object>} linhas - saída de getRelatorioPedidosDetalhado
 * @returns {Array<Object>}
 */
controller.paraAbaMeta4 = (linhas) =>
  // Ordem CRONOLÓGICA pela entrega, que é a da aba, e não a do CSV (por data do
  // pedido). Quem cola no RTM cola em ordem de entrega; item sem data de entrega
  // vai para o fim, porque ainda não aconteceu.
  [...linhas]
    .sort((a, b) => {
      const da = a.data_entrega ? String(a.data_entrega) : "9999-12-31";
      const dbb = b.data_entrega ? String(b.data_entrega) : "9999-12-31";
      if (da !== dbb) return da < dbb ? -1 : 1;
      if (a.pedido_id !== b.pedido_id) return Number(a.pedido_id) - Number(b.pedido_id);
      return 0;
    })
    .map((l) => {
      // A coluna "Observações" da aba leva o DIEx do pedido, e só ele: em branco
      // quando não há. A observação do ITEM é anotação interna de quem imprimiu,
      // e não é o que a aba do RTM documenta; quem precisa dela tem o CSV.
      const diex = l.documento_solicitacao == null
        ? ""
        : String(l.documento_solicitacao).trim();

      return {
        omds: l.omds || null,
        demandante: l.demandante || null,
        om_destino: l.om_destino || null,
        previsto_pit: l.previsto_pit ? "sim" : "não",
        meta: l.previsto_pit ? (l.meta || null) : "-",
        produto: l.produto || null,
        mi: l.mi || "-",
        escala: l.escala || null,
        quantidade_prevista: l.quantidade_prevista,
        material_previsto: materialDaAba(l.material_previsto),
        quantidade_fornecida: l.quantidade_fornecida,
        material_fornecido: materialDaAba(l.material_fornecido) || "-",
        data_entrega: l.data_entrega || null,
        forma_entrega: l.forma_entrega || null,
        observacao: diex || null
      };
    });

// Exportação "Resumo de Pedidos": uma linha por pedido (todos os clientes) com
// dados de envio + consolidado de produtos entregues por tipo e escala.
controller.COLUNAS_PEDIDOS_RESUMO = [
  { key: "numero_pedido", label: "Número do Pedido" },
  { key: "unidade", label: "Unidade" },
  { key: "documento", label: "Documento (DIEx)" },
  { key: "status", label: "Status" },
  { key: "data_envio", label: "Data de Envio" },
  { key: "informacoes_envio", label: "Informações de Envio" },
  { key: "topo_25k", label: "Topo 25k" },
  { key: "topo_50k", label: "Topo 50k" },
  { key: "topo_100k", label: "Topo 100k" },
  { key: "topo_250k", label: "Topo 250k" },
  { key: "total_topo", label: "Total Topo" },
  { key: "orto_25k", label: "Orto 25k" },
  { key: "orto_50k", label: "Orto 50k" },
  { key: "orto_100k", label: "Orto 100k" },
  { key: "orto_250k", label: "Orto 250k" },
  { key: "total_orto", label: "Total Orto" },
  { key: "outros_produtos", label: "Outros Produtos" },
  { key: "produtos_digitais", label: "Produtos Digitais" },
  { key: "total", label: "Total Entregue" }
];

controller.COLUNAS_CIV = [
  { key: "ordem", label: "Ord" },
  { key: "data_pedido", label: "Data Pedido" },
  { key: "solicitante", label: "Solicitante" },
  { key: "tipo_cliente", label: "Tipo de Cliente" },
  { key: "canal", label: "Canal" },
  { key: "numero_oficio", label: "Número do Ofício" },
  { key: "nup_lai", label: "NUP LAI" },
  { key: "municipio", label: "Município/Área" },
  { key: "resumo_pedido", label: "Resumo do Pedido" },
  { key: "qtd_imagens", label: "Nº de Imagens" },
  { key: "data_envio", label: "Data Envio/Retirada" },
  { key: "situacao", label: "Status" },
  { key: "observacao", label: "Observação" },
  { key: "localizador_pedido", label: "Localizador" }
];

controller.COLUNAS_TEMATICOS = [
  { key: "ordem", label: "ID" },
  { key: "nome_projeto", label: "Nome do Projeto" },
  { key: "demandante", label: "Demandante" },
  { key: "tipo_produto", label: "Tipo de Produto" },
  { key: "descricao_pedido", label: "Descrição sumária do pedido" },
  { key: "data_entrega", label: "Data da entrega" },
  { key: "descricao_produto", label: "Descrição sumária do produto" },
  { key: "secao_responsavel", label: "Seção responsável" },
  { key: "militar_responsavel", label: "Militar responsável" },
  { key: "tamanho_mb", label: "Tamanho (MB)" },
  { key: "localizador_pedido", label: "Localizador" }
];

module.exports = controller;
