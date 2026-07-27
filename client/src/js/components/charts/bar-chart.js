import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { el } from '@utils/dom.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

/**
 * Create a bar chart wrapped in a card.
 * Colors fall back to the CSS chart tokens (--chart-1..10).
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {Array<Object>} [options.data] - raw data array
 * @param {string} options.xKey - key for category labels
 * @param {Array<{dataKey:string, label:string, color?:string}>} options.series
 * @param {boolean} [options.stacked]
 * @param {boolean} [options.horizontal] - horizontal bars (indexAxis 'y')
 * @param {boolean} [options.loading]
 * @returns {HTMLElement} - element with .update({ data, series, loading }) and ._cleanup()
 */
export function createBarChart({
  title,
  data = [],
  xKey,
  series = [],
  stacked = false,
  horizontal = false,
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

    const categoryAxis = {
      stacked,
      grid: { display: false },
      ticks: {
        color: style.getPropertyValue('--text-secondary').trim(),
        maxRotation: 45,
        font: { size: 11 },
      },
    };

    const valueAxis = {
      stacked,
      beginAtZero: true,
      grid: {
        color: style.getPropertyValue('--border-light').trim(),
      },
      ticks: {
        color: style.getPropertyValue('--text-secondary').trim(),
        font: { size: 11 },
      },
    };

    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.map(d => d[xKey]),
        datasets: series.map((s, i) => ({
          label: s.label,
          data: data.map(d => d[s.dataKey]),
          backgroundColor: s.color || fallbackColors[i % fallbackColors.length],
          borderRadius: 4,
          maxBarThickness: 40,
        })),
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
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
        scales: horizontal
          ? { x: valueAxis, y: categoryAxis }
          : { x: categoryAxis, y: valueAxis },
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
