import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { el } from '@utils/dom.js';
import { EVENTO_TEMA_MUDOU } from '@utils/theme.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

// Teto do rotulo de categoria no EIXO, em caracteres. O texto inteiro segue no
// tooltip. Ver o comentario do `callback` do tick, abaixo, para o porque.
const LIMITE_ROTULO_EIXO = 34;

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
 * @param {string} [options.emptyMessage] - texto de lista vazia. O padrao serve
 *   ao grafico que so pode estar vazio por falta de dado; quem FILTRA os dados
 *   precisa dizer outra coisa, porque "Sem dados disponiveis" num grafico de
 *   "quem esta abaixo de 100%" se le como falha quando a resposta e "ninguem".
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
  emptyMessage = 'Sem dados disponíveis',
}) {
  let chartInstance = null;

  const chartBody = el('div', { className: 'chart-card__body' });
  const loadingEl = el('div', { className: 'chart-card__loading' }, [
    el('div', { className: 'spinner' }),
  ]);
  const emptyEl = el('div', { className: 'chart-card__empty', textContent: emptyMessage });

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
        // O rotulo do eixo e CORTADO, e o inteiro fica no tooltip.
        //
        // O eixo de categoria vem de campo livre em varias telas, e o Chart.js
        // nao quebra nem encurta linha nenhuma: ele desenha o texto todo. Medido
        // na producao em 2026-08-07, no grafico de operacoes apoiadas da
        // mapoteca: 8 dos 22 rotulos passavam de 40 caracteres, e o maior tinha
        // 88 ("Exercicio Multinacional FELINO 2026, de 10 a 21 de agosto de
        // 2026, em Foz do Iguacu (PR)"). Na barra horizontal esse rotulo comia a
        // largura do desenho; na vertical, virava uma parede de texto inclinado.
        //
        // Cortar sem devolver o inteiro em algum lugar seria esconder dado, e por
        // isso o tooltip abaixo reescreve o rotulo cru.
        callback(valor) {
          const bruto = String(this.getLabelForValue(valor) ?? '');
          return bruto.length > LIMITE_ROTULO_EIXO
            ? `${bruto.slice(0, LIMITE_ROTULO_EIXO - 1)}…`
            : bruto;
        },
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
            callbacks: {
              // O rotulo INTEIRO, lido do dado cru e nao do eixo. O titulo
              // padrao do Chart.js passa pelo mesmo `getLabelForValue` que o
              // callback do tick encurta, entao sem esta linha o tooltip
              // repetiria o texto cortado e o nome completo nao estaria em
              // lugar nenhum da tela.
              title: (itens) => {
                const item = itens[0];
                if (!item) return '';
                return String(data[item.dataIndex]?.[xKey] ?? item.label ?? '');
              },
            },
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
