import { describe, test, expect, vi, beforeEach } from 'vitest';

// O jsdom devolve null em canvas.getContext('2d'), e o Chart real estoura no
// primeiro update com dado. Sem este dublê o try/catch do load() engolia a
// falha: o teste passava com o gráfico QUEBRADO e não perceberia se ele
// parasse de renderizar em produção.
vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

// Smoke test do dashboard. O ano vem do contexto global (fixado em 2026 no
// localStorage); a carga chama getExecucaoNd e popula os cards/grafico/tabela a
// partir da LISTA de linhas por ND (com a linha TOTAL).
//
// A rota era /orcamento/relatorio/secao3 e devolvia { tabela_31, ..., tabela_37 }
// ate 2026-08-01, quando o RPCMTec saiu do modulo. Das sete tabelas o painel so
// lia a 3.1, entao a rota nova devolve a lista direto.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getExecucaoNd: vi.fn(() => Promise.resolve([
    { cod_nd: '339030', nd_nome: 'Material', previsto: 60, recebido: 30, recebido_pdr: 20, recebido_extra: 10, empenhado: 25, empenhado_pdr: 15, empenhado_extra: 10, liquidado: 20, liquidado_pdr: 12, liquidado_extra: 8 },
    { cod_nd: 'TOTAL', nd_nome: 'TOTAL', previsto: 100, recebido: 50, recebido_pdr: 35, recebido_extra: 15, empenhado: 40, empenhado_pdr: 25, empenhado_extra: 15, liquidado: 30, liquidado_pdr: 18, liquidado_extra: 12 },
  ])),
}));

import { renderDashboard } from '@modules/orcamento/pages/dashboard/index.js';
import { getExecucaoNd } from '@modules/orcamento/services/orcamento-service.js';
import { instanciasChart } from '@components/charts/chart-stub.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderDashboard', () => {
  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
    instanciasChart.length = 0;
  });

  test('monta o dashboard e carrega a execucao por ND do ano de contexto', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getExecucaoNd).toHaveBeenCalled();
    expect(container.querySelector('.dashboard__title')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // Sem esta asserção o teste acima passa com o gráfico QUEBRADO: o try/catch do
  // load() engole a falha do Chart e ninguém percebe. Aqui o dublê prova que o
  // gráfico foi montado e recebeu a linha TOTAL da tabela 3.1.
  test('monta o grafico com o dado da execucao por ND, e nao em silencio', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(instanciasChart.length).toBeGreaterThan(0);
    const grafico = instanciasChart[0];
    expect(grafico.config.data.datasets.length).toBeGreaterThan(0);
    const valores = grafico.config.data.datasets.flatMap(d => d.data);
    expect(valores.some(v => Number(v) > 0)).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('renderDashboard: as tres abas', () => {
  const abas = (container) => Array.from(container.querySelectorAll('.tabs > .tabs__item'));

  async function abrirAba(container, rotulo) {
    abas(container).find(b => b.textContent === rotulo).click();
    await flush();
  }

  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
    instanciasChart.length = 0;
  });

  test('monta as tres abas e abre na visao geral', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(abas(container).map(b => b.textContent)).toEqual([
      'Visão Geral', 'PDR (3.2)', 'Extra-PDR (3.7)',
    ]);
    // A visao geral e a unica montada: as tabelas ainda nao existem no DOM.
    expect(container.querySelector('.tabs__content .stats-grid')).not.toBeNull();
    expect(container.querySelector('.tabs__content tbody')).toBeNull();

    cleanup();
  });

  // As tres abas saem da MESMA consulta. Sem a memoizacao do store, cada clique
  // de aba pagaria um round-trip para reexibir dado que ja estava na mao.
  test('trocar de aba NAO refaz a consulta da execucao por ND', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getExecucaoNd).toHaveBeenCalledTimes(1);

    await abrirAba(container, 'PDR (3.2)');
    await abrirAba(container, 'Extra-PDR (3.7)');
    await abrirAba(container, 'Visão Geral');

    expect(getExecucaoNd).toHaveBeenCalledTimes(1);

    cleanup();
  });

  test('cada aba de ND mostra as colunas do seu recorte', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    await abrirAba(container, 'PDR (3.2)');
    const cabecalhoPdr = container.querySelector('.tabs__content thead').textContent;
    // O previsto so existe no PDR.
    expect(cabecalhoPdr).toContain('Previsto');
    expect(container.querySelector('.tabs__content tbody').textContent).toContain('339030');

    await abrirAba(container, 'Extra-PDR (3.7)');
    const cabecalhoExtra = container.querySelector('.tabs__content thead').textContent;
    expect(cabecalhoExtra).not.toContain('Previsto');
    expect(cabecalhoExtra).toContain('Empenhado');

    cleanup();
  });

  test('trocar o mes invalida a execucao por ND e recarrega a aba ativa', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getExecucaoNd).toHaveBeenCalledTimes(1);

    const select = container.querySelector('.chart-card__select');
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(getExecucaoNd).toHaveBeenCalledTimes(2);
    expect(getExecucaoNd).toHaveBeenLastCalledWith({ ano: 2026, mes: 3 });

    cleanup();
  });
});
