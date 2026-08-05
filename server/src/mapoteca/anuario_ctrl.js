"use strict";

// Anuário Estatístico: a Tabela 5.4.9 do "O Exército em Números", que o 1º CGEO
// remete mensalmente à DSG junto com o RTM.
//
// "Suprimento cartográfico convencional e digital distribuído, segundo as
// Regiões Militares, Estabelecimentos de Ensino e Comando de Operações
// Terrestres, Outras Forças, Órgãos Públicos, Empresas Privadas e Profissionais
// Autônomos".
//
// A tabela é uma matriz de linha fixa por coluna fixa. As LINHAS são o tipo de
// suprimento (escala da carta, ou uma categoria como "Produtos Diversos"), em
// dois blocos: Convencional (o que saiu impresso) e Digital (o que saiu em
// arquivo). As COLUNAS são a natureza de quem recebeu.
//
// A fonte é a mapoteca do próprio SCA, que é onde a entrega é registrada. O
// recorte é por DATA DE ATENDIMENTO do pedido (a entrega, e não o pedido), e o
// padrão é o MÊS.
//
// ---------------------------------------------------------------------------
// O QUE ESTA TABELA NÃO SABE PREENCHER, e por quê
// ---------------------------------------------------------------------------
// 1. RM e EE do Exército. O `mapoteca.tipo_cliente` distingue OM do EB de OM de
//    outra Força, mas NÃO separa Região Militar de Estabelecimento de Ensino
//    dentro do EB. As duas colunas saem vazias, com a lacuna declarada no rodapé
//    do arquivo. Preenchê-las exige valor novo de domínio e reclassificar os
//    clientes já cadastrados.
// 2. Carta de orientação, Mapa Índice, Mosaico, Ortofocarta. Não há tipo de
//    produto correspondente em `dominio.tipo_produto`. Item impresso que não
//    case com nenhuma linha cai em "Produtos Diversos", e nunca some.
// 3. Downloads BDGEx. É contador do BDGEx, não do acervo. Sai sempre vazio.
//
// Uma célula vazia diz "o SCA não sabe", e um zero diria "não houve entrega".
// São coisas diferentes, e por isso o vazio não vira 0.

const { db } = require("../database");
const {
  domainConstants: { TIPO_CLIENTE, TIPO_MIDIA, TIPO_ESCALA, TIPO_PRODUTO }
} = require("../utils");
const { QTD_EFETIVA, MIDIA_EFETIVA, filtroPeriodoMes } = require("./query_fragments");

const controller = {};

// --------------------------------------------------------------------------
// Colunas: a natureza de quem recebeu
// --------------------------------------------------------------------------
//
// `tipos` nulo = coluna que o SCA não sabe preencher (ver a nota 1 acima).
const COLUNAS_ANUARIO = [
  { key: "exercito", label: "Exército", tipos: [TIPO_CLIENTE.OM_EB] },
  { key: "rm", label: "RM", tipos: null },
  { key: "ee_exercito", label: "EE do Exército", tipos: null },
  {
    key: "outras_forcas",
    label: "Outras Forças",
    tipos: [TIPO_CLIENTE.OM_AERONAUTICA, TIPO_CLIENTE.OM_MARINHA]
  },
  {
    key: "orgao_publico",
    label: "Órgão Público",
    tipos: [
      TIPO_CLIENTE.ORGAO_PUBLICO_FEDERAL,
      TIPO_CLIENTE.ORGAO_PUBLICO_ESTADUAL,
      TIPO_CLIENTE.ORGAO_PUBLICO_MUNICIPAL
    ]
  },
  { key: "empresa_privada", label: "Empresa Privada", tipos: [TIPO_CLIENTE.PESSOA_JURIDICA] },
  {
    key: "prof_autonomo",
    label: "Prof. Autônomo",
    // O cidadão que pede pela LAI é atendido como pessoa, e é assim que a
    // tabela de junho de 2026 o contou.
    tipos: [TIPO_CLIENTE.PESSOA_FISICA, TIPO_CLIENTE.LAI]
  }
];

const COLUNA_POR_TIPO_CLIENTE = (() => {
  const mapa = {};
  for (const coluna of COLUNAS_ANUARIO) {
    for (const tipo of coluna.tipos || []) mapa[tipo] = coluna.key;
  }
  return mapa;
})();

// --------------------------------------------------------------------------
// Linhas: o tipo de suprimento
// --------------------------------------------------------------------------
//
// `denominador` casa a escala do produto do acervo. `slot` é o balde de quem
// não tem escala na lista. A ordem é a do arquivo que a DSG recebe, e não se
// reordena por conveniência: quem confere compara linha a linha.
const LINHAS_CONVENCIONAL = [
  { rotulo: "Escala 1:1 000 000", denominador: 1000000 },
  { rotulo: "Escala 1:250 000", denominador: 250000 },
  { rotulo: "Escala 1:100 000", denominador: 100000 },
  { rotulo: "Escala 1:50 000", denominador: 50000 },
  { rotulo: "Escala 1:25 000", denominador: 25000 },
  { rotulo: "Escala 1:15.000", denominador: 15000 },
  { rotulo: "Escala 1:10.000", denominador: 10000 },
  { rotulo: "Escala 1:7.000", denominador: 7000 },
  { rotulo: "Escala 1:5.000", denominador: 5000 },
  { rotulo: "Escala 1:4.000", denominador: 4000 },
  { rotulo: "Escala 1:3.000", denominador: 3000 },
  { rotulo: "Escala 1:2.000", denominador: 2000 },
  { rotulo: "Escala 1:1.000", denominador: 1000 },
  { rotulo: "Carta de orientação", semFonte: true },
  { rotulo: "Imagem de Satélite", slot: "imagem" },
  { rotulo: "Mapa Índice", semFonte: true },
  { rotulo: "Mosaico", semFonte: true },
  { rotulo: "Produtos Diversos", slot: "diversos" }
];

const LINHAS_DIGITAL = [
  { rotulo: "Escala 1:1 000 000", denominador: 1000000 },
  { rotulo: "Escala 1:250 000", denominador: 250000 },
  { rotulo: "Escala 1:100 000", denominador: 100000 },
  { rotulo: "Escala 1:50 000", denominador: 50000 },
  { rotulo: "Escala 1:25 000", denominador: 25000 },
  { rotulo: "Escala 1:10 000", denominador: 10000 },
  { rotulo: "Escala 1:7.000", denominador: 7000 },
  { rotulo: "Escala 1:5.000", denominador: 5000 },
  { rotulo: "Escala 1:4.000", denominador: 4000 },
  { rotulo: "Escala 1:3.000", denominador: 3000 },
  { rotulo: "Escala 1:2.000", denominador: 2000 },
  { rotulo: "Escala 1:1.000", denominador: 1000 },
  // A foto aérea entregue por LAI não vira item de acervo: ela é contada no
  // próprio pedido (mapoteca.pedido.qtd_imagens). É a linha que recebe essa
  // contagem, somada à Ortoimagem entregue em meio digital.
  { rotulo: "Imagem de Satélite / Fotografia aérea", slot: "imagem" },
  { rotulo: "Mapa Produto Digital", slot: "diversos" },
  { rotulo: "Ortofocarta", semFonte: true },
  { rotulo: "Downloads BDGEx", semFonte: true }
];

// Denominador da escala do produto, para casar com a linha da tabela. A escala
// personalizada guarda o denominador em coluna própria.
const DENOMINADOR_ESCALA = `
  CASE prod.tipo_escala_id
    WHEN ${TIPO_ESCALA.ESCALA_25K} THEN 25000
    WHEN ${TIPO_ESCALA.ESCALA_50K} THEN 50000
    WHEN ${TIPO_ESCALA.ESCALA_100K} THEN 100000
    WHEN ${TIPO_ESCALA.ESCALA_250K} THEN 250000
    WHEN ${TIPO_ESCALA.ESCALA_PERSONALIZADA} THEN prod.denominador_escala_especial
  END`;

/**
 * Itens de pedido entregues no período, já agregados por
 * (convencional/digital, denominador de escala, tipo de produto, tipo de
 * cliente). Uma linha por combinação, com a soma da quantidade efetiva.
 */
const getItensEntregues = ({ ano, mes, cumulativo }) =>
  db.conn.any(
    `
    SELECT
      (${MIDIA_EFETIVA} = $<midiaDigital>) AS digital,
      ${DENOMINADOR_ESCALA} AS denominador,
      prod.tipo_produto_id,
      c.tipo_cliente_id,
      SUM(${QTD_EFETIVA})::int AS quantidade
    FROM mapoteca.produto_pedido pp
    JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
    JOIN mapoteca.cliente c ON c.id = ped.cliente_id
    -- LEFT: o item avulso (papel quadriculado, impresso de ocasião) não tem
    -- produto no acervo. Um INNER o apagaria da conta, calado.
    LEFT JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
    LEFT JOIN acervo.produto prod ON prod.id = v.produto_id
    WHERE ped.data_atendimento IS NOT NULL
      AND ${filtroPeriodoMes("ped.data_atendimento", { cumulativo })}
    GROUP BY 1, 2, 3, 4
    `,
    { ano, mes, midiaDigital: TIPO_MIDIA.DIGITAL }
  );

/**
 * Imagens entregues fora do catálogo (foto aérea da LAI), contadas no pedido.
 * Só entram os pedidos SEM item de acervo: onde há item, a contagem verdadeira
 * é a dos itens, e somar as duas contaria a mesma entrega duas vezes.
 */
const getImagensEntregues = ({ ano, mes, cumulativo }) =>
  db.conn.any(
    `
    SELECT c.tipo_cliente_id, SUM(ped.qtd_imagens)::int AS quantidade
    FROM mapoteca.pedido ped
    JOIN mapoteca.cliente c ON c.id = ped.cliente_id
    WHERE ped.data_atendimento IS NOT NULL
      AND ped.qtd_imagens IS NOT NULL
      AND ped.qtd_imagens > 0
      AND NOT EXISTS (
        SELECT 1 FROM mapoteca.produto_pedido pp WHERE pp.pedido_id = ped.id
      )
      AND ${filtroPeriodoMes("ped.data_atendimento", { cumulativo })}
    GROUP BY 1
    `,
    { ano, mes }
  );

const linhaVazia = (rotulo, semFonte) => {
  const linha = { rotulo };
  for (const coluna of COLUNAS_ANUARIO) {
    // Coluna sem fonte, ou linha sem fonte: fica NULA, e o .ods a escreve como
    // '-'. Zero diria "não houve entrega", que é outra afirmação.
    linha[coluna.key] = semFonte || !coluna.tipos ? null : 0;
  }
  return linha;
};

const somaLinhas = (rotulo, linhas) => {
  const total = { rotulo };
  for (const coluna of COLUNAS_ANUARIO) {
    if (!coluna.tipos) {
      total[coluna.key] = null;
      continue;
    }
    total[coluna.key] = linhas.reduce(
      (soma, l) => soma + (typeof l[coluna.key] === "number" ? l[coluna.key] : 0),
      0
    );
  }
  return total;
};

// Qual linha do bloco recebe este item.
const escolheLinha = (linhas, { denominador, tipo_produto_id: tipoProduto }) => {
  if (denominador != null) {
    const porEscala = linhas.find((l) => l.denominador === denominador);
    if (porEscala) return porEscala;
  }
  if (tipoProduto === TIPO_PRODUTO.ORTOIMAGEM) {
    const imagem = linhas.find((l) => l.slot === "imagem");
    if (imagem) return imagem;
  }
  return linhas.find((l) => l.slot === "diversos");
};

const montaBloco = (definicoes, registros) => {
  const linhas = definicoes.map((d) => linhaVazia(d.rotulo, d.semFonte));
  const porIndice = new Map(definicoes.map((d, i) => [d, i]));

  for (const registro of registros) {
    const coluna = COLUNA_POR_TIPO_CLIENTE[registro.tipo_cliente_id];
    if (!coluna) continue;
    const definicao = escolheLinha(definicoes, registro);
    if (!definicao) continue;
    const linha = linhas[porIndice.get(definicao)];
    linha[coluna] = (linha[coluna] || 0) + registro.quantidade;
  }
  return linhas;
};

/**
 * Monta o Anuário Estatístico do período.
 *
 * @param {Object} opts
 * @param {number} opts.ano
 * @param {number} opts.mes
 * @param {boolean} [opts.cumulativo=false] - acumula de janeiro até o mês
 * @returns {Promise<Object>} título, colunas, blocos e as lacunas declaradas
 */
controller.getAnuarioEstatistico = async ({ ano, mes, cumulativo = false }) => {
  const [itens, imagens] = await Promise.all([
    getItensEntregues({ ano, mes, cumulativo }),
    getImagensEntregues({ ano, mes, cumulativo })
  ]);

  const convencionais = itens.filter((i) => !i.digital);
  const digitais = itens.filter((i) => i.digital);
  // A foto aérea solta é digital por definição: ela é entregue em arquivo.
  const digitaisComImagens = digitais.concat(
    imagens.map((i) => ({
      denominador: null,
      tipo_produto_id: TIPO_PRODUTO.ORTOIMAGEM,
      tipo_cliente_id: i.tipo_cliente_id,
      quantidade: i.quantidade
    }))
  );

  const linhasConvencional = montaBloco(LINHAS_CONVENCIONAL, convencionais);
  const linhasDigital = montaBloco(LINHAS_DIGITAL, digitaisComImagens);

  return {
    ano,
    mes,
    cumulativo,
    titulo:
      `O Exército em Números ${ano} Tabela 5.4.9 – Suprimento cartográfico ` +
      "convencional e digital distribuído, segundo as Regiões Militares, " +
      "Estabelecimentos de Ensino e Comando de Operações Terrestres, Outras " +
      "Forças, Órgãos Públicos, Empresas Privadas e Profissionais Autônomos, " +
      `em ${ano}.`,
    colunas: COLUNAS_ANUARIO.map(({ key, label }) => ({ key, label })),
    total_convencional: somaLinhas("Total (Convencional)", linhasConvencional),
    convencional: linhasConvencional,
    total_digital: somaLinhas("Total (Digital)", linhasDigital),
    digital: linhasDigital,
    lacunas: [
      "RM e EE do Exército: o cadastro de cliente do SCA não separa Região " +
        "Militar de Estabelecimento de Ensino dentro das OM do Exército.",
      "Carta de orientação, Mapa Índice, Mosaico e Ortofocarta: sem tipo de " +
        "produto correspondente no acervo. Entrega desse feitio cai em " +
        "Produtos Diversos.",
      "Downloads BDGEx: contador do BDGEx, fora do controle do acervo."
    ]
  };
};

/**
 * As linhas do Anuário na forma da planilha: uma linha por rótulo, os dois
 * blocos em sequência, com a linha de total abrindo cada bloco (é a ordem do
 * arquivo que a DSG recebe).
 */
controller.paraPlanilha = (anuario) => [
  anuario.total_convencional,
  ...anuario.convencional,
  anuario.total_digital,
  ...anuario.digital
];

controller.COLUNAS_ANUARIO = COLUNAS_ANUARIO;

// Nome do mês para o nome do arquivo, no padrão dos que já subiram para a DSG
// (Anuario_Estatistico_1CGEO_06_Junho_2026.ods). Sem acento: o nome viaja no
// cabeçalho Content-Disposition, e ali acento vira mojibake em cliente antigo.
controller.NOME_MES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

module.exports = controller;
