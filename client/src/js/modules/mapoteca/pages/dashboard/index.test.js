import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O jsdom devolve null em canvas.getContext('2d'), e o Chart real estoura no
// primeiro update com dado. Com o dublê os gráficos passam a receber dado de
// verdade no teste, em vez de ficarem vazios de propósito.
vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderDashboard } from '@modules/mapoteca/pages/dashboard/index.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// 1200 + 689 dos dois clientes do mock, formatado como o Intl pt-BR faz.
const SOMA_IMPRESSOES = new Intl.NumberFormat('pt-BR').format(1889);

// O jsdom nao implementa canvas, entao o Chart.js nao desenha aqui. Os graficos
// ficam SEM dado de proposito (eles caem no estado "Sem dados disponiveis") e o
// teste afere o caminho dos dados nos cards e nas tabelas, nao o desenho.
describe('renderDashboard da mapoteca', () => {
  beforeEach(() => {
    svc.getOrderStatus.mockResolvedValue({
      total: 68, em_andamento: 12, concluidos: 50, pendentes: 6,
      distribuicao: [],
    });
    svc.getAvgFulfillmentTime.mockResolvedValue({ media_geral: '9.4', por_tipo_cliente: [], mensal: [] });
    svc.getMaterialConsumption.mockResolvedValue({ consumo_mensal_total: [], materiais_mais_consumidos: [] });
    svc.getResumoAnual.mockResolvedValue({
      ano: 2026, total_pedidos: 68, total_entregas: 900,
      oms_distintas_count: 14, operacoes_distintas_count: 3, custo_manutencao_total: 3200,
    });
    // DEZ clientes, porque a rota devolve um Top 10. Com dois, o teste de
    // paginacao ficava VAZIO: o rodape se esconde sozinho abaixo de 5 linhas,
    // entao ele passava com ou sem `paginated: false`. Medido em 2026-07-27,
    // reintroduzindo o defeito de proposito.
    svc.getClientActivity.mockResolvedValue([
      { id: 7, nome: '1º CGEO', tipo_cliente: 'OM EB', total_pedidos: 12, pedidos_concluidos: 10, total_produtos: 340, total_impressoes: 1200, ultimo_pedido: '2026-06-10' },
      { id: 9, nome: '3º RCMec', tipo_cliente: 'OM EB', total_pedidos: 5, pedidos_concluidos: 5, total_produtos: 71, total_impressoes: 689, ultimo_pedido: '2026-05-02' },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: 100 + i, nome: `OM ${i + 1}`, tipo_cliente: 'OM EB',
        total_pedidos: 2, pedidos_concluidos: 1, total_produtos: 10,
        total_impressoes: 0, ultimo_pedido: '2026-04-01',
      })),
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('monta o titulo e chama todos os paineis do dashboard', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.querySelector('.dashboard__title').textContent).toBe('Dashboard');
    expect(svc.getOrderStatus).toHaveBeenCalled();
    expect(svc.getStockByLocation).toHaveBeenCalled();
    expect(svc.getOrdersTimeline).toHaveBeenCalledWith(6);
    expect(svc.getAvgFulfillmentTime).toHaveBeenCalled();
    expect(svc.getClientActivity).toHaveBeenCalledWith(10);
    expect(svc.getMaterialConsumption).toHaveBeenCalledWith(12);

    if (typeof cleanup === 'function') cleanup();
  });

  // As quatro secoes que o chefe mandou sair em 2026-07-27. O teste guarda a
  // AUSENCIA, senao elas voltam em silencio numa refatoracao futura. Vale para a
  // tela e para a requisicao: painel removido nao pode seguir pedindo dado.
  test('nao monta os paineis removidos, nem pede o dado deles', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).not.toContain('Pedidos Pendentes');
    expect(container.textContent).not.toContain('Plotters');
    expect(container.textContent).not.toContain('Tipo de Mídia');
    expect(svc.getPendingOrders).not.toHaveBeenCalled();
    expect(svc.getPlotterStatus).not.toHaveBeenCalled();
    expect(svc.getEntregasPorMidia).not.toHaveBeenCalled();
    expect(svc.getEntregasPorMes).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  // "Em Andamento" era subconjunto de "Pendentes" no servidor, entao os dois
  // cards somados contavam o mesmo pedido duas vezes.
  test('o card Em Andamento saiu, e Pendentes ficou', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const cards = container.querySelector('.stats-grid').textContent;
    expect(cards).not.toContain('Em Andamento');
    expect(cards).toContain('Pendentes');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o Top 10 de clientes nao pagina e soma as impressoes', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const secao = [...container.querySelectorAll('.dashboard-section')]
      .find(s => s.textContent.includes('Clientes Mais Ativos'));
    expect(secao).toBeTruthy();
    expect(secao.querySelector('.pagination__btn')).toBeNull();
    expect(secao.querySelector('.pagination__select')).toBeNull();
    // As dez linhas na tela de uma vez. Numa pagina de 5, a decima sumiria.
    expect(secao.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(secao.textContent).toContain('OM 8');
    expect(secao.textContent).toContain('Impressões');
    expect(secao.textContent).toContain(SOMA_IMPRESSOES);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o Resumo Anual abre a pagina, antes dos cards de situacao', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const filhos = [...container.querySelector('.dashboard').children];
    const idxAnual = filhos.findIndex(f => f.textContent.includes('Resumo Anual'));
    const idxCards = filhos.findIndex(f => f.classList.contains('stats-grid'));
    expect(idxAnual).toBeGreaterThan(-1);
    expect(idxAnual).toBeLessThan(idxCards);

    if (typeof cleanup === 'function') cleanup();
  });

  test('preenche os cards de situacao com o que o service devolveu', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const cards = container.querySelector('.stats-grid').textContent;
    expect(cards).toContain('68');
    expect(cards).toContain('Total de Pedidos');
    expect(cards).toContain('Tempo Médio de Atendimento');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a secao anual usa o ano corrente', async () => {
    const ano = new Date().getFullYear();
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getResumoAnual).toHaveBeenCalledWith(ano);
    expect(svc.getEntregasPorTipoProduto).toHaveBeenCalledWith(ano);
    expect(svc.getOperacoesApoiadas).toHaveBeenCalledWith(ano);
    expect(container.textContent).toContain('Resumo Anual');
    expect(container.textContent).toContain('1º CGEO');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o cleanup para o refetch de 60s', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    cleanup();
    svc.getOrderStatus.mockClear();

    vi.advanceTimersByTime(120 * 1000);
    expect(svc.getOrderStatus).not.toHaveBeenCalled();
  });
});
