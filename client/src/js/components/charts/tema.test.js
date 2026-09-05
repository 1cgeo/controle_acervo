import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

const { instanciasChart } = await import('@components/charts/chart-stub.js');
const { createBarChart } = await import('@components/charts/bar-chart.js');
const { createLineChart } = await import('@components/charts/line-chart.js');
const { createPieChart } = await import('@components/charts/pie-chart.js');
const { toggleTheme } = await import('@utils/theme.js');

/**
 * O GRAFICO SE REPINTA QUANDO O TEMA TROCA.
 *
 * O Chart.js nao le CSS: as cores chegam a ele como VALORES, lidas uma vez com
 * `getComputedStyle` no `render()`. Trocar o tema com um dashboard aberto
 * mudava o fundo do cartao e deixava a tinta do eixo, da legenda e do tooltip
 * no tema anterior -- `--text-secondary` do claro (#666666) sobre o cartao
 * escuro (#1e1e1e) da menos de 2:1, e o rotulo do eixo some. Nao havia recarga
 * envolvida: quem trocasse o tema ficava assim ate navegar para outra tela.
 */

const DADOS = [{ mes: 'Janeiro', total: 3 }, { mes: 'Fevereiro', total: 5 }];

beforeEach(() => {
  instanciasChart.length = 0;
  document.documentElement.setAttribute('data-theme', 'light');
  localStorage.clear();
});

const CASOS = [
  ['createBarChart', () => createBarChart({
    title: 'Por mês', data: DADOS, xKey: 'mes', series: [{ dataKey: 'total', label: 'Total' }],
  })],
  ['createLineChart', () => createLineChart({
    title: 'Por mês', data: DADOS, xKey: 'mes', series: [{ dataKey: 'total', label: 'Total' }],
  })],
  ['createPieChart', () => createPieChart({
    title: 'Por tipo', data: [{ label: 'Carta', value: 3 }],
  })],
];

describe('grafico: a troca de tema repinta as cores', () => {
  test.each(CASOS)('%s se redesenha ao trocar o tema', (_nome, montar) => {
    const card = montar();
    expect(instanciasChart.length).toBe(1);
    const primeiro = instanciasChart[0];

    toggleTheme();

    // O grafico antigo foi destruido e outro nasceu, ja com os tokens do tema
    // novo: e isso que devolve o contraste ao eixo e a legenda.
    expect(primeiro.destroyed).toBe(true);
    expect(instanciasChart.length).toBe(1);
    expect(instanciasChart[0]).not.toBe(primeiro);

    card._cleanup();
  });

  test('depois do cleanup, o grafico nao responde mais a troca de tema', () => {
    const card = createBarChart({
      title: 'Por mês', data: DADOS, xKey: 'mes', series: [{ dataKey: 'total', label: 'Total' }],
    });
    card._cleanup();
    instanciasChart.length = 0;

    toggleTheme();

    // Sem a retirada do ouvinte, o cartao de uma tela ja descartada continuaria
    // criando instancias do Chart a cada clique no botao de tema.
    expect(instanciasChart.length).toBe(0);
  });
});
