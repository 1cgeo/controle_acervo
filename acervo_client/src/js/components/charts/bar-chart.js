import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { el } from '@utils/dom.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

/**
 * Create a bar chart wrapped in a card.
 * @param {Object} options
 * @param {string} options.title
 * @param {Array<Object>} options.data - Raw data array
 * @param {string} options.xKey - Key for X axis labels
 * @param {Array<{dataKey: string, label: string, color: string}>} options.series
 * @param {boolean} [options.stacked]
 * @param {boolean} [options.loading]
 * @returns {HTMLElement}
 */
export function createBarChart({
  title,
  data = [],
  xKey,
  series = [],
  stacked = false,
  loading = false,
}) {
  let chartInstance = null;

  const canvas = el('canvas');
  const chartBody = el('div', { className: 'chart-card__body' }, [
    el('div', { className: 'chart-container' }, [canvas]),
  ]);

  const loadingEl = el('div', { className: 'chart-card__loading' }, [
    el('div', { className: 'spinner' }),
  ]);

  const emptyEl = el('div', { className: 'chart-card__empty', textContent: 'Sem dados disponiveis' });

  const titleEl = el('div', { className: 'chart-card__title', textContent: title });
  const card = el('div', { className: 'chart-card' }, [titleEl, chartBody]);

  function render() {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    // Clear body
    chartBody.innerHTML = '';

    if (loading) {
      chartBody.appendChild(loadingEl);
      return;
    }

    if (!data.length) {
      chartBody.appendChild(emptyEl);
      return;
    }

    const newCanvas = el('canvas');
    const container = el('div', { className: 'chart-container' }, [newCanvas]);
    chartBody.appendChild(container);

    const style = getComputedStyle(document.documentElement);

    chartInstance = new Chart(newCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.map(d => d[xKey]),
        datasets: series.map(s => ({
          label: s.label,
          data: data.map(d => d[s.dataKey]),
          backgroundColor: s.color || style.getPropertyValue('--chart-1').trim(),
          borderRadius: 4,
          maxBarThickness: 40,
        })),
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
            stacked,
            grid: { display: false },
            ticks: {
              color: style.getPropertyValue('--text-secondary').trim(),
              maxRotation: 45,
              font: { size: 11 },
            },
          },
          y: {
            stacked,
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
