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
    svc.getPlotterStatus.mockResolvedValue({ sumario: { total: 3, ativos: 2, inativos: 1 }, plotters: [] });
    svc.getMaterialConsumption.mockResolvedValue({ consumo_mensal_total: [], materiais_mais_consumidos: [] });
    svc.getResumoAnual.mockResolvedValue({
      ano: 2026, total_pedidos: 68, total_entregas: 900,
      oms_distintas_count: 14, operacoes_distintas_count: 3, custo_manutencao_total: 3200,
    });
    svc.getPendingOrders.mockResolvedValue([
      {
        id: 55, data_pedido: '2026-06-10', cliente_nome: '1º CGEO', prazo: '2026-06-30',
        dias_ate_prazo: 4, situacao_pedido_id: 3, situacao_nome: 'Em andamento',
        quantidade_produtos: 8, atrasado: false,
      },
    ]);
    svc.getClientActivity.mockResolvedValue([
      { id: 7, nome: '1º CGEO', tipo_cliente: 'OM EB', total_pedidos: 12, pedidos_concluidos: 10, total_produtos: 340, ultimo_pedido: '2026-06-10' },
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
    expect(svc.getPendingOrders).toHaveBeenCalled();
    expect(svc.getAvgFulfillmentTime).toHaveBeenCalled();
    expect(svc.getClientActivity).toHaveBeenCalledWith(10);
    expect(svc.getMaterialConsumption).toHaveBeenCalledWith(12);
    expect(svc.getPlotterStatus).toHaveBeenCalled();

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

  test('a secao anual usa o ano corrente e mostra os pedidos pendentes', async () => {
    const ano = new Date().getFullYear();
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getResumoAnual).toHaveBeenCalledWith(ano);
    expect(svc.getEntregasPorMes).toHaveBeenCalledWith(ano);
    expect(container.textContent).toContain('Pedidos Pendentes');
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
