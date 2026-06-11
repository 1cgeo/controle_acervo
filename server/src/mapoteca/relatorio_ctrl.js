// Path: mapoteca\relatorio_ctrl.js
"use strict";

const { db } = require("../database");
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
  dataEntregaEfetiva,
  ESCALA_DISPLAY,
  filtroAno
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

/**
 * Relatório anual de pedidos militares (reproduz a aba "Mil" da planilha).
 * Uma linha por pedido, com pivô de quantidades por escala × tipo de produto.
 * Colunas Offset saem sempre 0: a mapoteca não fornece mais estoque offset.
 *
 * Classificação (segue a aba Mil): mídia Digital tem coluna própria; itens
 * impressos Topo/Orto fora das escalas padrão contam em "outros_produtos".
 * Difere de getEntregasPorMes (dashboard_ctrl), que classifica só por tipo de
 * produto — como a tabela-resumo mensal da aba Detalhado.
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
             prod.tipo_produto_id,
             prod.tipo_escala_id,
             (${MIDIA_EFETIVA} = $<midiaDigital>) AS digital
      FROM mapoteca.produto_pedido pp
      JOIN pedidos_mil pm ON pm.id = pp.pedido_id
      JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
      JOIN acervo.produto prod ON prod.id = v.produto_id
    ),
    agregado AS (
      SELECT pedido_id,
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
        SUM(qtd) AS total
      FROM itens
      GROUP BY pedido_id
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY p.data_pedido, p.id)::int AS numero,
      p.id AS pedido_id,
      p.localizador_pedido,
      (a.pedido_id IS NOT NULL) AS possui_detalhamento,
      p.data_pedido,
      p.documento_solicitacao,
      p.previsto_pit,
      sp.nome AS situacao,
      p.cliente_nome AS unidade,
      COALESCE(p.endereco_entrega, p.endereco_entrega_principal) AS endereco,
      p.data_atendimento AS data_envio,
      CASE WHEN p.data_atendimento IS NOT NULL
           THEN EXTRACT(DAY FROM (p.data_atendimento - p.data_pedido))::int
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
 * Relatório anual detalhado por item (reproduz a aba "Detalhado" da planilha).
 * Tipo/escala/MI sempre via catálogo do acervo (RN08).
 */
controller.getRelatorioPedidosDetalhado = async (ano) => {
  return db.conn.any(
    `
    SELECT
      p.omds,
      p.demandante,
      c.nome AS om_destino,
      p.previsto_pit,
      p.prazo AS meta,
      tp.nome AS produto,
      prod.nome AS produto_nome,
      prod.mi,
      ${ESCALA_DISPLAY} AS escala,
      pp.quantidade AS quantidade_prevista,
      tm.nome AS material_previsto,
      pp.quantidade_fornecida,
      tmf.nome AS material_fornecido,
      pp.data_entrega,
      fe.nome AS forma_entrega,
      pp.observacao,
      CASE WHEN pp.data_entrega IS NOT NULL
           THEN EXTRACT(MONTH FROM pp.data_entrega)::int
      END AS mes,
      p.id AS pedido_id,
      p.localizador_pedido
    FROM mapoteca.produto_pedido pp
    JOIN mapoteca.pedido p ON p.id = pp.pedido_id
    JOIN mapoteca.cliente c ON c.id = p.cliente_id
    JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
    JOIN acervo.produto prod ON prod.id = v.produto_id
    JOIN dominio.tipo_produto tp ON tp.code = prod.tipo_produto_id
    JOIN dominio.tipo_escala te ON te.code = prod.tipo_escala_id
    JOIN mapoteca.tipo_midia tm ON tm.code = pp.tipo_midia_id
    LEFT JOIN mapoteca.tipo_midia tmf ON tmf.code = pp.tipo_midia_fornecida_id
    LEFT JOIN mapoteca.forma_entrega fe ON fe.code = pp.forma_entrega_id
    WHERE ${filtroAno("p.data_pedido")}
    ORDER BY p.data_pedido, p.id, pp.id
    `,
    { ano }
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
      p.documento_solicitacao AS numero_oficio,
      p.documento_solicitacao_nup AS nup_lai,
      p.observacao AS resumo_pedido,
      p.data_atendimento AS data_envio,
      sp.nome AS situacao,
      p.observacao_envio AS observacao,
      p.id AS pedido_id,
      p.localizador_pedido
    FROM mapoteca.pedido p
    JOIN mapoteca.cliente c ON c.id = p.cliente_id
    JOIN mapoteca.tipo_cliente tc ON tc.code = c.tipo_cliente_id
    JOIN mapoteca.situacao_pedido sp ON sp.code = p.situacao_pedido_id
    WHERE c.tipo_cliente_id NOT IN ($<tiposMilitar:csv>)
      AND ${filtroAno("p.data_pedido")}
    ORDER BY p.data_pedido, p.id
    `,
    { ano, tiposMilitar: TIPOS_CLIENTE_MILITAR }
  );
};

/**
 * Relatório anual de produção temática (reproduz a aba "Mapas Temáticos").
 * Itens com producao_especifica = TRUE (RN07 — marcador de produção sob demanda).
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
      ${dataEntregaEfetiva("p")} AS data_entrega,
      COALESCE(v.descricao, prod.descricao) AS descricao_produto,
      v.orgao_produtor AS secao_responsavel,
      v.metadado->>'responsavel' AS militar_responsavel,
      arq.tamanho_mb,
      p.id AS pedido_id,
      p.localizador_pedido
    FROM mapoteca.produto_pedido pp
    JOIN mapoteca.pedido p ON p.id = pp.pedido_id
    JOIN mapoteca.cliente c ON c.id = p.cliente_id
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
             prod.tipo_produto_id,
             prod.tipo_escala_id,
             (${MIDIA_EFETIVA} = $<midiaDigital>) AS digital
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido p ON p.id = pp.pedido_id
      JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
      JOIN acervo.produto prod ON prod.id = v.produto_id
      WHERE ${filtroAno("p.data_pedido")}
    ),
    agregado AS (
      SELECT pedido_id,
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
        SUM(qtd) AS total
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
  { key: "numero_oficio", label: "Número do Ofício" },
  { key: "nup_lai", label: "NUP LAI" },
  { key: "resumo_pedido", label: "Resumo do Pedido" },
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
