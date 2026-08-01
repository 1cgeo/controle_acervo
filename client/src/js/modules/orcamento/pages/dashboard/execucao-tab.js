import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createStatsCard } from '@components/stats-card.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { getTotalRow, semTotal } from './secao3-store.js';

/**
 * Aba "Visão Geral": a linha TOTAL da tabela 3.1 em cards, mais a execucao por
 * Natureza de Despesa em barras.
 *
 * Os cards vem em tres blocos (Totais, PDR, Extra-PDR) porque somar PDR com
 * Extra-PDR e o erro classico de leitura: os dois recortes convivem na mesma
 * linha da 3.1. O "Previsto" so existe no PDR, e por isso so aparece la.
 *
 * @param {HTMLElement} container
 * @param {{carregar:Function}} store
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderExecucaoTab(container, store) {
  let disposed = false;

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

  container.appendChild(el('div', { className: 'dashboard-cards' }, [
    grupoCards('Totais', [cardRecebido, cardEmpenhado, cardLiquidado]),
    grupoCards('PDR (3.2)', [cardPrevisto, cardRecebidoPdr, cardEmpenhadoPdr, cardLiquidadoPdr]),
    grupoCards('Extra-PDR (3.7)', [cardRecebidoExtra, cardEmpenhadoExtra, cardLiquidadoExtra]),
  ]));
  container.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', {
        className: 'dashboard-section__title',
        textContent: 'Execução por Natureza de Despesa (3.1)',
      }),
    ]),
    execucaoChart,
  ]));

  async function load() {
    todosCards.forEach(c => c.update({ loading: true }));
    execucaoChart.update({ loading: true });

    try {
      // A rota do painel devolve a LISTA de linhas por ND direto; ate
      // 2026-08-01 ela vinha embrulhada em { tabela_31 }, junto com as outras
      // seis tabelas da secao 3 do RPCMTec, que esta tela nunca leu.
      const rows = (await store.carregar()) || [];
      if (disposed) return;
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

      execucaoChart.update({
        data: semTotal(rows).map(r => ({
          cod_nd: r.cod_nd,
          previsto: Number(r.previsto || 0),
          recebido: Number(r.recebido || 0),
          empenhado: Number(r.empenhado || 0),
          liquidado: Number(r.liquidado || 0),
        })),
        loading: false,
      });
    } catch (err) {
      if (disposed) return;
      todosCards.forEach(c => c.update({ value: '-', loading: false }));
      execucaoChart.update({ data: [], loading: false });
      showError(err.message || 'Erro ao carregar a execução orçamentária');
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      execucaoChart._cleanup();
    },
    refresh: load,
  };
}
