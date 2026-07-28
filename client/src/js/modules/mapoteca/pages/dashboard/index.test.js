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
import { setAno } from '@modules/mapoteca/store/year-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// 1200 + 689 dos dois clientes do mock, formatado como o Intl pt-BR faz.
const SOMA_IMPRESSOES = new Intl.NumberFormat('pt-BR').format(1889);

const abas = (container) =>
  Array.from(container.querySelectorAll('.tabs > .tabs__item'));

const rotulosAbas = (container) => abas(container).map(b => b.textContent);

/** Abre uma aba pelo rotulo e espera a montagem. */
async function abrirAba(container, rotulo) {
  const botao = abas(container).find(b => b.textContent === rotulo);
  botao.click();
  await flush();
  return botao;
}

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

  test('monta o titulo e as cinco abas', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.querySelector('.dashboard__title').textContent).toBe('Dashboard da Mapoteca');
    // O Mapa vem logo depois do Resumo Anual: e a leitura espacial do MESMO
    // numero, e nao um assunto novo.
    expect(rotulosAbas(container)).toEqual([
      'Resumo Anual', 'Mapa', 'Pedidos', 'Atendimento', 'Materiais',
    ]);

    cleanup();
  });

  // O Resumo Anual abre a pagina (chefe, 2026-07-27): e o numero de que a DGEO
  // presta contas. Virou a PRIMEIRA aba, e nao a primeira secao, mas a ordem
  // continua sendo uma decisao, e nao acaso.
  test('abre no Resumo Anual, e so ele busca dado', async () => {
    const ano = new Date().getFullYear();
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getResumoAnual).toHaveBeenCalledWith(ano);
    expect(svc.getEntregasPorTipoProduto).toHaveBeenCalledWith(ano);
    expect(svc.getOperacoesApoiadas).toHaveBeenCalledWith(ano);
    expect(container.textContent).toContain('Resumo Anual');

    // As outras tres abas ainda nao existem no DOM: nada delas foi buscado.
    expect(svc.getOrderStatus).not.toHaveBeenCalled();
    expect(svc.getAvgFulfillmentTime).not.toHaveBeenCalled();
    expect(svc.getStockByLocation).not.toHaveBeenCalled();

    cleanup();
  });

  test('cada aba busca o seu proprio grupo de endpoints', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    await abrirAba(container, 'Pedidos');
    expect(svc.getOrderStatus).toHaveBeenCalled();
    expect(svc.getOrdersTimeline).toHaveBeenCalledWith(6);

    await abrirAba(container, 'Atendimento');
    expect(svc.getAvgFulfillmentTime).toHaveBeenCalled();
    expect(svc.getClientActivity).toHaveBeenCalledWith(10);

    await abrirAba(container, 'Materiais');
    expect(svc.getStockByLocation).toHaveBeenCalled();
    expect(svc.getMaterialConsumption).toHaveBeenCalledWith(12);

    cleanup();
  });

  // As quatro secoes que o chefe mandou sair em 2026-07-27. O teste guarda a
  // AUSENCIA, senao elas voltam em silencio numa refatoracao futura. Vale para a
  // tela e para a requisicao: painel removido nao pode seguir pedindo dado.
  test('nao monta os paineis removidos, nem pede o dado deles, em aba nenhuma', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    for (const rotulo of ['Pedidos', 'Atendimento', 'Materiais']) {
      await abrirAba(container, rotulo);
      expect(container.textContent).not.toContain('Pedidos Pendentes');
      expect(container.textContent).not.toContain('Tipo de Mídia');
    }

    expect(svc.getPendingOrders).not.toHaveBeenCalled();
    expect(svc.getPlotterStatus).not.toHaveBeenCalled();
    expect(svc.getEntregasPorMidia).not.toHaveBeenCalled();
    expect(svc.getEntregasPorMes).not.toHaveBeenCalled();

    cleanup();
  });

  // "Em Andamento" era subconjunto de "Pendentes" no servidor, entao os dois
  // cards somados contavam o mesmo pedido duas vezes.
  test('na aba de pedidos, o card Em Andamento saiu e Pendentes ficou', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    await abrirAba(container, 'Pedidos');

    const cards = container.querySelector('.tabs__content .stats-grid').textContent;
    expect(cards).not.toContain('Em Andamento');
    expect(cards).toContain('Pendentes');
    expect(cards).toContain('68');
    expect(cards).toContain('Total de Pedidos');

    cleanup();
  });

  test('o Top 10 de clientes nao pagina e soma as impressoes', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    await abrirAba(container, 'Atendimento');

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
    expect(secao.textContent).toContain('1º CGEO');

    cleanup();
  });

  test('o auto-refresh de 60 s derruba o cache e recarrega so a aba ativa', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });

    const antes = svc.getResumoAnual.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(svc.invalidateDashboardCache).toHaveBeenCalledTimes(1);
    expect(svc.getResumoAnual.mock.calls.length).toBe(antes + 1);
    // A aba inativa continua sem ser buscada.
    expect(svc.getOrderStatus).not.toHaveBeenCalled();

    cleanup();
  });

  // O ano vem do contexto do modulo (seletor da navbar). Antes cada painel por
  // ano tinha o proprio seletor, e todos nasciam no ano corrente: a escolha se
  // perdia a cada troca de tela.
  test('trocar o ano de contexto recarrega a aba aberta com o novo ano', async () => {
    setAno(2026);
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    setAno(2025);
    await flush();

    expect(svc.getResumoAnual).toHaveBeenLastCalledWith(2025);
    // Sem derrubar o cache: as respostas sao guardadas por ano, entao voltar ao
    // ano anterior nao paga a busca de novo.
    expect(svc.invalidateDashboardCache).not.toHaveBeenCalled();

    cleanup();
  });

  test('o cleanup para de ouvir a troca de ano', async () => {
    setAno(2026);
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();
    cleanup();
    svc.getResumoAnual.mockClear();

    setAno(2024);
    await flush();
    expect(svc.getResumoAnual).not.toHaveBeenCalled();
  });

  test('o cleanup para o refetch de 60s', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    cleanup();
    svc.getResumoAnual.mockClear();

    await vi.advanceTimersByTimeAsync(120 * 1000);
    expect(svc.getResumoAnual).not.toHaveBeenCalled();
  });
});
