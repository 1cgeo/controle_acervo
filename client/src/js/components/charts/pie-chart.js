import { Chart, PieController, ArcElement, Tooltip, Legend } from 'chart.js';
import { el } from '@utils/dom.js';
import { EVENTO_TEMA_MUDOU } from '@utils/theme.js';

Chart.register(PieController, ArcElement, Tooltip, Legend);

const CHART_COLORS = [
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--chart-6', '--chart-7', '--chart-8', '--chart-9', '--chart-10',
];

/**
 * Create a pie chart wrapped in a card.
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {Array<{label:string, value:number, color?:string}>} [options.data]
 * @param {boolean} [options.loading]
 * @param {boolean} [options.showLegend]
 * @returns {HTMLElement} - element with .update({ data, loading }) and ._cleanup()
 */
export function createPieChart({
  title,
  data = [],
  loading = false,
  showLegend = true,
}) {
  let chartInstance = null;

  const chartBody = el('div', { className: 'chart-card__body' });
  const loadingEl = el('div', { className: 'chart-card__loading' }, [
    el('div', { className: 'spinner' }),
  ]);
  const emptyEl = el('div', { className: 'chart-card__empty', textContent: 'Sem dados disponíveis' });

  const titleEl = el('div', { className: 'chart-card__title', textContent: title });
  const card = el('div', { className: 'chart-card' }, [titleEl, chartBody]);

  function render() {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    chartBody.innerHTML = '';

    if (loading) {
      chartBody.appendChild(loadingEl);
      return;
    }

    if (!data.length) {
      chartBody.appendChild(emptyEl);
      return;
    }

    const canvas = el('canvas');
    const container = el('div', { className: 'chart-container' }, [canvas]);
    chartBody.appendChild(container);

    const style = getComputedStyle(document.documentElement);
    const colors = CHART_COLORS.map(c => style.getPropertyValue(c).trim());

    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'pie',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.value),
          backgroundColor: data.map((d, i) => d.color || colors[i % colors.length]),
          borderWidth: 2,
          borderColor: style.getPropertyValue('--bg-paper').trim(),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: showLegend,
            position: window.innerWidth > 900 ? 'right' : 'bottom',
            labels: {
              color: style.getPropertyValue('--text-secondary').trim(),
              usePointStyle: true,
              padding: 12,
              font: { size: 12 },
            },
          },
          tooltip: {
            backgroundColor: style.getPropertyValue('--bg-elevated').trim(),
            titleColor: style.getPropertyValue('--text-primary').trim(),
            bodyColor: style.getPropertyValue('--text-secondary').trim(),
            borderColor: style.getPropertyValue('--border-color').trim(),
            borderWidth: 1,
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : '0.0';
                return ` ${ctx.label}: ${ctx.parsed.toLocaleString('pt-BR')} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  /**
   * Update chart data.
   * @param {{data?:Array, loading?:boolean}} state
   */
  card.update = ({ data: newData, loading: newLoading }) => {
    if (newData !== undefined) data = newData;
    if (newLoading !== undefined) loading = newLoading;
    render();
  };

  card._cleanup = () => {
    window.removeEventListener(EVENTO_TEMA_MUDOU, aoTrocarTema);
    if (chartInstance) chartInstance.destroy();
  };

  // O TEMA MUDA DEPOIS DE O GRAFICO NASCER, e as cores do Chart.js sao lidas UMA
  // vez, no `render()`: a paleta, a tinta do eixo, a da legenda e a do tooltip
  // saem de `getComputedStyle` na hora de desenhar, e ficam congeladas no que o
  // Chart.js recebeu. Sem repintar, trocar para o tema escuro com um dashboard
  // aberto deixava o rotulo do eixo em `--text-secondary` CLARO sobre o cartao
  // escuro -- ou, no caminho contrario, cinza claro sobre branco. Repintar e so
  // refazer o render, que ja rele os tokens.
  const aoTrocarTema = () => render();
  window.addEventListener(EVENTO_TEMA_MUDOU, aoTrocarTema);

  render();
  return card;
}
