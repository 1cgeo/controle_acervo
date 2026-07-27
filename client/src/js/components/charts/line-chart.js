import { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler } from 'chart.js';
import { el } from '@utils/dom.js';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

/**
 * Create a line chart wrapped in a card (e.g. orders timeline).
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {Array<Object>} [options.data] - raw data array
 * @param {string} options.xKey - key for X axis labels
 * @param {Array<{dataKey:string, label:string, color?:string, fill?:boolean}>} options.series
 * @param {boolean} [options.loading]
 * @returns {HTMLElement} - element with .update({ data, series, loading }) and ._cleanup()
 */
export function createLineChart({
  title,
  data = [],
  xKey,
  series = [],
  loading = false,
}) {
  let chartInstance = null;

  const chartBody = el('div', { className: 'chart-card__body' });
  const loadingEl = el('div', { className: 'chart-card__loading' }, [
    el('div', { className: 'spinner' }),
  ]);
  const emptyEl = el('div', { className: 'chart-card__empty', textContent: 'Sem dados disponíveis' });

  const titleEl = el('div', { className: 'chart-card__title', textContent: title });
  const card = el('div', { className: 'chart-card' }, [titleEl, chartBody]);

  function hexToRgba(hex, alpha) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!match) return hex;
    const [, r, g, b] = match;
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
  }

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
    const fallbackColors = [];
    for (let i = 1; i <= 10; i++) {
      fallbackColors.push(style.getPropertyValue(`--chart-${i}`).trim());
    }

    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map(d => d[xKey]),
        datasets: series.map((s, i) => {
          const color = s.color || fallbackColors[i % fallbackColors.length];
          return {
            label: s.label,
            data: data.map(d => d[s.dataKey]),
            borderColor: color,
            backgroundColor: s.fill ? hexToRgba(color, 0.12) : color,
            fill: Boolean(s.fill),
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: {
            display: series.length > 1,
            position: 'top',
            labels: {
              color: style.getPropertyValue('--text-secondary').trim(),
              usePointStyle: true,
              padding: 16,
            },
          },
          tooltip: {
            backgroundColor: style.getPropertyValue('--bg-elevated').trim(),
            titleColor: style.getPropertyValue('--text-primary').trim(),
            bodyColor: style.getPropertyValue('--text-secondary').trim(),
            borderColor: style.getPropertyValue('--border-color').trim(),
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: style.getPropertyValue('--text-secondary').trim(),
              maxRotation: 45,
              font: { size: 11 },
            },
          },
          y: {
            beginAtZero: true,
            grid: {
              color: style.getPropertyValue('--border-light').trim(),
            },
            ticks: {
              color: style.getPropertyValue('--text-secondary').trim(),
              font: { size: 11 },
            },
          },
        },
      },
    });
  }

  /**
   * Update chart data.
   * @param {{data?:Array<Object>, series?:Array, loading?:boolean}} state
   */
  card.update = ({ data: newData, loading: newLoading, series: newSeries }) => {
    if (newData !== undefined) data = newData;
    if (newLoading !== undefined) loading = newLoading;
    if (newSeries !== undefined) series = newSeries;
    render();
  };

  card._cleanup = () => {
    if (chartInstance) chartInstance.destroy();
  };

  render();
  return card;
}
