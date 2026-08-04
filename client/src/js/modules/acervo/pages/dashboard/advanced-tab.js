import { el } from '@utils/dom.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createTabs } from '@components/tabs/tabs.js';
import { formatNumber } from '@utils/format.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';
import { mostrarErro, mostrarErroNoGrafico } from '@components/estado-erro.js';

const PERIODOS = [6, 12, 24];

/**
 * Rotulo curto de um mes 'AAAA-MM' (ex.: 'mar. de 2026').
 * @param {string} mes
 * @returns {string}
 */
function formatMes(mes) {
  if (!mes) return '-';
  const [ano, numero] = String(mes).split('-');
  const data = new Date(Number(ano), Number(numero) - 1, 1);
  if (isNaN(data.getTime())) return String(mes);
  return data.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

/** Select de periodo em meses, usado nos graficos de linha do tempo. */
function seletorPeriodo(onChange) {
  return el('select', {
    className: 'chart-card__select',
    'aria-label': 'Período em meses',
    onChange: (e) => onChange(parseInt(e.target.value, 10)),
  }, PERIODOS.map(m => el('option', { value: String(m), textContent: `${m} meses` })));
}

/**
 * Grafico de barras com um seletor de periodo no cabecalho.
 * O createBarChart monta o card como [titulo, corpo]; aqui o titulo sai e entra
 * um cabecalho com titulo + select, que e o padrao do chart-card__header.
 * @param {{title:string, xKey:string, series:Array, onPeriodo:Function}} cfg
 * @returns {{card:HTMLElement, getPeriodo:()=>number}}
 */
function graficoComPeriodo({ title, xKey, series, onPeriodo }) {
  let periodo = PERIODOS[0];

  const card = createBarChart({ title: '', xKey, series, loading: true });

  const select = seletorPeriodo((meses) => {
    periodo = meses;
    onPeriodo(meses);
  });

  const tituloAntigo = card.querySelector('.chart-card__title');
  if (tituloAntigo) tituloAntigo.remove();
  card.prepend(el('div', { className: 'chart-card__header' }, [
    el('div', { className: 'chart-card__title', textContent: title }),
    select,
  ]));

  return { card, getPeriodo: () => periodo };
}

/**
 * Aba "Análises Avançadas": duas linhas do tempo com seletor de periodo e
 * quatro sub-abas de detalhe (versoes, armazenamento, projetos e usuarios).
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderAdvancedTab(container) {
  let disposed = false;

  // --- Linha do tempo de produtos ---
  const produtos = graficoComPeriodo({
    title: 'Linha do Tempo de Produtos',
    xKey: 'mes_label',
    series: [
      { dataKey: 'new_products', label: 'Novos Produtos' },
      { dataKey: 'modified_products', label: 'Produtos Modificados' },
    ],
    onPeriodo: (meses) => loadProdutos(meses),
  });

  async function loadProdutos(meses, silencioso = false) {
    if (!silencioso) produtos.card.update({ loading: true });
    try {
      const dados = await acervoService.getProdutoActivityTimeline(meses);
      if (disposed) return;
      produtos.card.update({
        data: (Array.isArray(dados) ? dados : []).map(d => ({ ...d, mes_label: formatMes(d.month) })),
        loading: false,
      });
    } catch (erro) {
      if (disposed) return;
      // Estado de ERRO, e nao grafico vazio. Zerar a serie fazia o card mostrar
      // "Sem dados disponiveis", que e a frase do acervo sem producao: a falha
      // da API lia-se como mes sem carta cadastrada. O painel e o que o chefe
      // olha para decidir, e "nao houve" e "nao consegui saber" pedem acoes
      // opostas (2026-08-04, mesma correcao ja feita na aba de Atividade).
      produtos.card.update({ data: [], loading: false });
      mostrarErroNoGrafico(produtos.card, erro, () => loadProdutos(produtos.getPeriodo()));
    }
  }

  // --- Linha do tempo de versoes ---
  const versoes = graficoComPeriodo({
    title: 'Linha do Tempo de Versões Cadastradas',
    xKey: 'mes_label',
    series: [
      { dataKey: 'novas_versoes', label: 'Novas Versões' },
      { dataKey: 'acumulado', label: 'Acumulado' },
    ],
    onPeriodo: (meses) => loadVersoes(meses),
  });

  async function loadVersoes(meses, silencioso = false) {
    if (!silencioso) versoes.card.update({ loading: true });
    try {
      const dados = await acervoService.getVersaoActivityTimeline(meses);
      if (disposed) return;
      versoes.card.update({
        data: (Array.isArray(dados) ? dados : []).map(d => ({
          ...d,
          mes_label: formatMes(d.month),
          novas_versoes: Number(d.novas_versoes),
          acumulado: Number(d.acumulado),
        })),
        loading: false,
      });
    } catch (erro) {
      if (disposed) return;
      versoes.card.update({ data: [], loading: false });
      mostrarErroNoGrafico(versoes.card, erro, () => loadVersoes(versoes.getPeriodo()));
    }
  }

  container.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
    produtos.card,
    versoes.card,
  ]));

  const subAbas = createTabs({
    className: 'sub-tabs',
    ariaLabel: 'Detalhe das análises',
    tabs: [
      { id: 'versoes', label: 'Estatísticas de Versões', render: renderVersionStats },
      { id: 'armazenamento', label: 'Tendências de Armazenamento', render: renderStorageTrends },
      { id: 'projetos', label: 'Status de Projetos', render: renderProjectStatus },
      { id: 'usuarios', label: 'Atividade de Usuários', render: renderUserActivity },
    ],
  });
  container.appendChild(subAbas.element);

  await Promise.all([
    loadProdutos(PERIODOS[0]),
    loadVersoes(PERIODOS[0]),
    subAbas.ready,
  ]);

  return {
    cleanup: () => {
      disposed = true;
      if (produtos.card._cleanup) produtos.card._cleanup();
      if (versoes.card._cleanup) versoes.card._cleanup();
      subAbas._cleanup();
    },
    refresh: async () => {
      await Promise.all([
        loadProdutos(produtos.getPeriodo(), true),
        loadVersoes(versoes.getPeriodo(), true),
        subAbas.refreshActive(),
      ]);
    },
  };
}

/** Card pequeno de resumo (valor em cima, rotulo embaixo). */
function summaryCard(valor, rotulo) {
  return el('div', { className: 'summary-card' }, [
    el('div', { className: 'summary-card__value', textContent: valor }),
    el('div', { className: 'summary-card__label', textContent: rotulo }),
  ]);
}

/**
 * Sub-aba "Estatísticas de Versões".
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderVersionStats(container) {
  let disposed = false;

  const resumo = el('div', { className: 'summary-cards' });
  container.appendChild(resumo);

  const pieDistribuicao = createPieChart({ title: 'Distribuição de Versões por Produto', loading: true });
  const pieTipo = createPieChart({ title: 'Tipos de Versão', loading: true });
  container.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [pieDistribuicao, pieTipo]));

  async function load() {
    try {
      const dados = await acervoService.getVersionStatistics();
      if (disposed) return;
      const stats = (dados && dados.stats) || {};

      resumo.innerHTML = '';
      resumo.appendChild(summaryCard(formatNumber(stats.total_versions), 'Total de Versões'));
      resumo.appendChild(summaryCard(formatNumber(stats.products_with_versions), 'Produtos com Versões'));
      resumo.appendChild(summaryCard(Number(stats.avg_versions_per_product || 0).toFixed(1), 'Média por Produto'));
      resumo.appendChild(summaryCard(formatNumber(stats.max_versions_per_product), 'Máximo por Produto'));

      pieDistribuicao.update({
        data: (Array.isArray(dados?.distribution) ? dados.distribution : []).map(d => ({
          label: `${d.versions_per_product} versões`,
          value: Number(d.product_count),
        })),
        loading: false,
      });

      pieTipo.update({
        data: (Array.isArray(dados?.type_distribution) ? dados.type_distribution : []).map(d => ({
          label: d.version_type || 'Sem tipo',
          value: Number(d.version_count),
        })),
        loading: false,
      });
    } catch (erro) {
      if (disposed) return;
      // Uma chamada so alimenta os quatro cartoes e os dois graficos desta
      // sub-aba. Falhando ela, nada aqui tem valor, entao o erro toma a
      // sub-aba inteira, e nao cada grafico.
      pieDistribuicao.update({ data: [], loading: false });
      pieTipo.update({ data: [], loading: false });
      mostrarErro(container, erro, load);
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      if (pieDistribuicao._cleanup) pieDistribuicao._cleanup();
      if (pieTipo._cleanup) pieTipo._cleanup();
    },
    refresh: load,
  };
}

/**
 * Sub-aba "Tendências de Armazenamento".
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderStorageTrends(container) {
  let disposed = false;

  const grafico = graficoComPeriodo({
    title: 'Tendências de Armazenamento',
    xKey: 'mes_label',
    series: [
      { dataKey: 'gb_added', label: 'GB Adicionados' },
      { dataKey: 'cumulative_gb', label: 'GB Acumulados' },
    ],
    onPeriodo: (meses) => load(meses),
  });
  container.appendChild(grafico.card);

  async function load(meses, silencioso = false) {
    if (!silencioso) grafico.card.update({ loading: true });
    try {
      const dados = await acervoService.getStorageGrowthTrends(meses);
      if (disposed) return;
      grafico.card.update({
        data: (Array.isArray(dados) ? dados : []).map(d => ({
          ...d,
          mes_label: formatMes(d.month),
          gb_added: Number(d.gb_added),
          cumulative_gb: Number(d.cumulative_gb),
        })),
        loading: false,
      });
    } catch (erro) {
      if (disposed) return;
      // No corpo do card, e nao no container: o cabecalho tem o seletor de
      // periodo, e quem ve o erro precisa dele para tentar outra janela.
      grafico.card.update({ data: [], loading: false });
      mostrarErroNoGrafico(grafico.card, erro, () => load(grafico.getPeriodo()));
    }
  }

  await load(PERIODOS[0]);

  return {
    cleanup: () => {
      disposed = true;
      if (grafico.card._cleanup) grafico.card._cleanup();
    },
    refresh: () => load(grafico.getPeriodo(), true),
  };
}

/**
 * Sub-aba "Status de Projetos".
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderProjectStatus(container) {
  let disposed = false;

  const resumo = el('div', { className: 'summary-cards' });
  container.appendChild(resumo);

  const pieProjetos = createPieChart({ title: 'Status dos Projetos', loading: true });
  const pieLotes = createPieChart({ title: 'Status dos Lotes', loading: true });
  container.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [pieProjetos, pieLotes]));

  async function load() {
    try {
      const dados = await acervoService.getProjectStatusSummary();
      if (disposed) return;

      resumo.innerHTML = '';
      resumo.appendChild(summaryCard(formatNumber(dados?.projects_without_lots ?? 0), 'Projetos sem Lotes'));

      pieProjetos.update({
        data: (Array.isArray(dados?.project_status) ? dados.project_status : []).map(d => ({
          label: d.status,
          value: Number(d.project_count),
        })),
        loading: false,
      });

      pieLotes.update({
        data: (Array.isArray(dados?.lot_status) ? dados.lot_status : []).map(d => ({
          label: d.status,
          value: Number(d.lot_count),
        })),
        loading: false,
      });
    } catch (erro) {
      if (disposed) return;
      pieProjetos.update({ data: [], loading: false });
      pieLotes.update({ data: [], loading: false });
      mostrarErro(container, erro, load);
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      if (pieProjetos._cleanup) pieProjetos._cleanup();
      if (pieLotes._cleanup) pieLotes._cleanup();
    },
    refresh: load,
  };
}

/**
 * Sub-aba "Atividade de Usuários": os dez que mais mexeram no acervo.
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderUserActivity(container) {
  let disposed = false;

  container.appendChild(el('div', {
    className: 'data-table-wrapper__title',
    textContent: 'Dez usuários mais ativos',
  }));

  const tabela = createDataTable({
    columns: [
      { key: 'usuario', label: 'Usuário', sortable: true, className: 'data-table__cell--truncate' },
      { key: 'uploads', label: 'Uploads', sortable: true, render: (row) => formatNumber(row.uploads) },
      { key: 'modifications', label: 'Modificações', sortable: true, render: (row) => formatNumber(row.modifications) },
      { key: 'downloads', label: 'Downloads', sortable: true, render: (row) => formatNumber(row.downloads) },
      { key: 'total_activity', label: 'Total', sortable: true, render: (row) => formatNumber(row.total_activity) },
    ],
    rows: [],
    loading: true,
    pageSize: 10,
    searchable: true,
    emptyMessage: 'Sem atividade de usuário registrada',
  });
  container.appendChild(tabela.element);

  async function load() {
    try {
      const dados = await acervoService.getUserActivityMetrics(10);
      if (disposed) return;
      tabela.update({
        rows: (Array.isArray(dados) ? dados : []).map(row => ({
          ...row,
          usuario: row.usuario_nome || row.usuario_login || '-',
        })),
        loading: false,
      });
    } catch (erro) {
      if (disposed) return;
      tabela.update({ rows: [], loading: false });
      mostrarErro(container, erro, load);
    }
  }

  await load();

  return {
    cleanup: () => { disposed = true; tabela._cleanup(); },
    refresh: load,
  };
}
