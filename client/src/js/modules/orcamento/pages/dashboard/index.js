import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, monthName } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createStatsCard } from '@components/stats-card.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { getSecao3 } from '@modules/orcamento/services/orcamento-service.js';
import { getAno, onAnoChange } from '@modules/orcamento/store/year-store.js';

/**
 * Dashboard da execucao orcamentaria do ano de contexto (#/).
 * Carrega a secao 3.1 (execucao por ND) cumulativa ate o mes selecionado e
 * mostra os totais em cards, a tabela completa e um grafico comparando
 * previsto x recebido x empenhado x liquidado por ND. O ano vem do contexto
 * global (@modules/orcamento/store/year-store); a troca de ano recarrega a tela.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderDashboard(container, _ctx) {
  let disposed = false;
  let mes = new Date().getMonth() + 1; // 1-12

  // ---------------------------------------------------------------------------
  // Seletor de mes (recarrega a secao 3)
  // ---------------------------------------------------------------------------
  const mesSelect = el('select', {
    className: 'chart-card__select',
    'aria-label': 'Selecionar mês',
    onChange: (e) => {
      mes = parseInt(e.target.value, 10);
      load();
    },
  }, Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return el('option', { value: String(m), textContent: monthName(m) });
  }));
  mesSelect.value = String(mes);

  // ---------------------------------------------------------------------------
  // Cards (linha TOTAL da tabela 3.1), em tres blocos: Totais, depois PDR (3.2),
  // depois Extra-PDR (3.7). O previsto so existe no PDR.
  // ---------------------------------------------------------------------------
  const mkCard = (title, color, icon) => createStatsCard({
    title, value: '-', icon: svgIcon(icon, 24), color, loading: true,
  });

  const cardPrevisto = mkCard('Previsto', 'info', ICONS.assignment);
  const cardRecebido = mkCard('Recebido', 'primary', ICONS.download);
  const cardEmpenhado = mkCard('Empenhado', 'warning', ICONS.description);
  const cardLiquidado = mkCard('Liquidado', 'success', ICONS.checkCircle);

  const cardRecebidoPdr = mkCard('Recebido PDR', 'primary', ICONS.download);
  const cardEmpenhadoPdr = mkCard('Empenhado PDR', 'warning', ICONS.description);
  const cardLiquidadoPdr = mkCard('Liquidado PDR', 'success', ICONS.checkCircle);

  const cardRecebidoExtra = mkCard('Recebido Extra-PDR', 'primary', ICONS.download);
  const cardEmpenhadoExtra = mkCard('Empenhado Extra-PDR', 'warning', ICONS.description);
  const cardLiquidadoExtra = mkCard('Liquidado Extra-PDR', 'success', ICONS.checkCircle);

  const todosCards = [
    cardPrevisto, cardRecebido, cardEmpenhado, cardLiquidado,
    cardRecebidoPdr, cardEmpenhadoPdr, cardLiquidadoPdr,
    cardRecebidoExtra, cardEmpenhadoExtra, cardLiquidadoExtra,
  ];

  const grupoCards = (titulo, cards) => el('div', { className: 'dashboard-cards-group' }, [
    el('h3', { className: 'dashboard-cards-group__title', textContent: titulo }),
    el('div', { className: 'stats-grid' }, cards),
  ]);

  const statsGrid = el('div', { className: 'dashboard-cards' }, [
    grupoCards('Totais', [cardRecebido, cardEmpenhado, cardLiquidado]),
    grupoCards('PDR (3.2)', [cardPrevisto, cardRecebidoPdr, cardEmpenhadoPdr, cardLiquidadoPdr]),
    grupoCards('Extra-PDR (3.7)', [cardRecebidoExtra, cardEmpenhadoExtra, cardLiquidadoExtra]),
  ]);

  // ---------------------------------------------------------------------------
  // Grafico de barras por ND
  // ---------------------------------------------------------------------------
  const execucaoChart = createBarChart({
    title: 'Execução por Natureza de Despesa',
    data: [],
    xKey: 'cod_nd',
    series: [
      { dataKey: 'previsto', label: 'Previsto' },
      { dataKey: 'recebido', label: 'Recebido' },
      { dataKey: 'empenhado', label: 'Empenhado' },
      { dataKey: 'liquidado', label: 'Liquidado' },
    ],
    loading: true,
  });

  // ---------------------------------------------------------------------------
  // Tabela 3.1 completa
  // ---------------------------------------------------------------------------
  // Duas tabelas: uma PDR (com previsto) e uma Extra-PDR, para evitar uma tabela
  // larga demais. Ambas se alimentam da tabela_31 (mesma linha por ND).
  const colsBase = [
    { key: 'cod_nd', label: 'Cód. ND' },
    { key: 'nd_nome', label: 'Natureza de Despesa', render: (row) => row.nd_nome || '-' },
  ];
  const execucaoTablePdr = createDataTable({
    columns: [
      ...colsBase,
      { key: 'previsto', label: 'Previsto', render: (row) => formatCurrency(row.previsto) },
      { key: 'recebido_pdr', label: 'Recebido', render: (row) => formatCurrency(row.recebido_pdr) },
      { key: 'empenhado_pdr', label: 'Empenhado', render: (row) => formatCurrency(row.empenhado_pdr) },
      { key: 'liquidado_pdr', label: 'Liquidado', render: (row) => formatCurrency(row.liquidado_pdr) },
    ],
    rows: [],
    pageSize: 25,
    loading: true,
    emptyMessage: 'Sem execução PDR para o mês selecionado',
  });
  const execucaoTableExtra = createDataTable({
    columns: [
      ...colsBase,
      { key: 'recebido_extra', label: 'Recebido', render: (row) => formatCurrency(row.recebido_extra) },
      { key: 'empenhado_extra', label: 'Empenhado', render: (row) => formatCurrency(row.empenhado_extra) },
      { key: 'liquidado_extra', label: 'Liquidado', render: (row) => formatCurrency(row.liquidado_extra) },
    ],
    rows: [],
    pageSize: 25,
    loading: true,
    emptyMessage: 'Sem execução Extra-PDR para o mês selecionado',
  });

  const conteudo = el('div', {}, [
    statsGrid,
    el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Execução por Natureza de Despesa (3.1)' }),
      ]),
      execucaoChart,
    ]),
    el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'PDR (3.2) por Natureza de Despesa' }),
      ]),
      execucaoTablePdr.element,
    ]),
    el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Extra-PDR (3.7) por Natureza de Despesa' }),
      ]),
      execucaoTableExtra.element,
    ]),
  ]);

  const page = el('div', { className: 'dashboard' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Execução Orçamentária' }),
      el('div', { className: 'dashboard-section__controls' }, [
        el('span', { textContent: 'Mês:' }),
        mesSelect,
      ]),
    ]),
    conteudo,
  ]);
  container.appendChild(page);

  /** Localiza a linha TOTAL (ou agrega como fallback) da tabela 3.1. */
  function getTotalRow(rows) {
    const total = rows.find(r => String(r.cod_nd).toUpperCase() === 'TOTAL'
      || String(r.nd_nome).toUpperCase() === 'TOTAL');
    if (total) return total;
    const campos = ['previsto', 'recebido', 'recebido_pdr', 'recebido_extra',
      'empenhado', 'empenhado_pdr', 'empenhado_extra',
      'liquidado', 'liquidado_pdr', 'liquidado_extra'];
    return rows.reduce((acc, r) => {
      for (const k of campos) acc[k] += Number(r[k] || 0);
      return acc;
    }, Object.fromEntries(campos.map(k => [k, 0])));
  }

  function setCardsLoading() {
    todosCards.forEach(c => c.update({ loading: true }));
  }

  async function load() {
    const ano = getAno();
    setCardsLoading();
    execucaoChart.update({ loading: true });
    execucaoTablePdr.update({ loading: true });
    execucaoTableExtra.update({ loading: true });

    try {
      const secao3 = await getSecao3({ ano, mes, cumulativo: true });
      if (disposed) return;

      const rows = (secao3 && secao3.tabela_31) || [];

      const total = getTotalRow(rows);
      cardPrevisto.update({ value: formatCurrency(total.previsto), loading: false });
      cardRecebido.update({ value: formatCurrency(total.recebido), loading: false });
      cardEmpenhado.update({ value: formatCurrency(total.empenhado), loading: false });
      cardLiquidado.update({ value: formatCurrency(total.liquidado), loading: false });
      cardRecebidoPdr.update({ value: formatCurrency(total.recebido_pdr), loading: false });
      cardEmpenhadoPdr.update({ value: formatCurrency(total.empenhado_pdr), loading: false });
      cardLiquidadoPdr.update({ value: formatCurrency(total.liquidado_pdr), loading: false });
      cardRecebidoExtra.update({ value: formatCurrency(total.recebido_extra), loading: false });
      cardEmpenhadoExtra.update({ value: formatCurrency(total.empenhado_extra), loading: false });
      cardLiquidadoExtra.update({ value: formatCurrency(total.liquidado_extra), loading: false });

      // O grafico ignora a linha TOTAL (so as NDs).
      const ndRows = rows.filter(r => String(r.cod_nd).toUpperCase() !== 'TOTAL'
        && String(r.nd_nome).toUpperCase() !== 'TOTAL');
      execucaoChart.update({
        data: ndRows.map(r => ({
          cod_nd: r.cod_nd,
          previsto: Number(r.previsto || 0),
          recebido: Number(r.recebido || 0),
          empenhado: Number(r.empenhado || 0),
          liquidado: Number(r.liquidado || 0),
        })),
        loading: false,
      });

      execucaoTablePdr.update({ rows, loading: false });
      execucaoTableExtra.update({ rows, loading: false });
    } catch (err) {
      if (disposed) return;
      todosCards.forEach(c => c.update({ value: '-', loading: false }));
      execucaoChart.update({ data: [], loading: false });
      execucaoTablePdr.update({ rows: [], loading: false });
      execucaoTableExtra.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar a execução orçamentária');
    }
  }

  // Recarrega quando o ano de contexto muda.
  const offAno = onAnoChange(() => { load(); });

  // Carga inicial com o ano de contexto.
  await load();

  return () => {
    disposed = true;
    offAno();
    execucaoChart._cleanup();
    execucaoTablePdr._cleanup();
    execucaoTableExtra._cleanup();
  };
}
