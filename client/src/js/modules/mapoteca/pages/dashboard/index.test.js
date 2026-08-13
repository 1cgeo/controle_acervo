import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

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

// O dashboard tem UM filtro de ano, no nivel da pagina, e abre no ano ATUAL.
// O seletor da navbar acabou, e nada fica no localStorage.
const ANO_ATUAL = new Date().getFullYear();
const ANO_ANTERIOR = ANO_ATUAL - 1;

/** O select do filtro de ano da pagina, acima das abas. */
const filtroAno = (container) => container.querySelector('.page__filters select');

/** Troca o ano da pagina e espera a recarga da aba aberta. */
async function trocarAno(container, ano) {
  const select = filtroAno(container);
  select.value = String(ano);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

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
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL, ANO_ANTERIOR]);
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
    // entao ele passava com ou sem `paginated: false`.,
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

  // O Resumo Anual abre a pagina: e o numero de que a DGEO
  // presta contas. Virou a PRIMEIRA aba, e nao a primeira secao, mas a ordem
  // continua sendo uma decisao, e nao acaso.
  test('abre no Resumo Anual, e so ele busca dado', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    // A pagina abre no ano ATUAL. Antes o ano vinha do localStorage, e voltar
    // semanas depois abria num ano antigo sem nada avisar.
    expect(filtroAno(container).value).toBe(String(ANO_ATUAL));
    expect(svc.getResumoAnual).toHaveBeenCalledWith(ANO_ATUAL);
    expect(svc.getEntregasPorTipoProduto).toHaveBeenCalledWith(ANO_ATUAL);
    expect(svc.getOperacoesApoiadas).toHaveBeenCalledWith(ANO_ATUAL);
    expect(container.textContent).toContain('Resumo Anual');

    // As outras tres abas ainda nao existem no DOM: nada delas foi buscado.
    expect(svc.getOrderStatus).not.toHaveBeenCalled();
    expect(svc.getAvgFulfillmentTime).not.toHaveBeenCalled();
    expect(svc.getStockByLocation).not.toHaveBeenCalled();

    cleanup();
  });

  test('cada aba busca o seu proprio grupo de endpoints', async () => {
    // Sem ano fixado: a pagina abre no ano atual, e as cinco abas leem o MESMO
    // filtro. Era preciso fixar quando o ano vinha do localStorage e sobrevivia
    // entre os testes.
    const ANO = ANO_ATUAL;
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    // Todas as abas passaram a levar o ANO da pagina. As janelas
    // deslizantes ("ultimos 6 meses", "ultimos 12 meses") sairam junto: elas nao
    // tinham como respeitar um ano escolhido, porque continuariam terminando
    // hoje.
    await abrirAba(container, 'Pedidos');
    expect(svc.getOrderStatus).toHaveBeenCalledWith(ANO);
    expect(svc.getOrdersTimeline).toHaveBeenCalledWith(ANO);

    await abrirAba(container, 'Atendimento');
    expect(svc.getAvgFulfillmentTime).toHaveBeenCalledWith(ANO);
    expect(svc.getClientActivity).toHaveBeenCalledWith(10, ANO);

    await abrirAba(container, 'Materiais');
    expect(svc.getMaterialConsumption).toHaveBeenCalledWith(ANO);
    // O estoque e o UNICO painel do dashboard sem ano: e o saldo de hoje, e
    // "estoque de 2025" nao existe.
    expect(svc.getStockByLocation).toHaveBeenCalledWith();

    cleanup();
  });

  // As secoes que o chefe mandou sair em 2026-07-27 (commit 10db3bd) e que
  // CONTINUAM fora. O teste guarda a AUSENCIA, senao elas voltam em silencio
  // numa refatoracao futura. Vale para a tela e para a requisicao: painel
  // removido nao pode seguir pedindo dado.
  //
  // Duas daquelas quatro VOLTARAM em 2026-08-07, por decisao do chefe, e o
  // teste logo abaixo guarda a presenca delas. Ver o comentario de la.
  test('nao monta os paineis removidos, nem pede o dado deles, em aba nenhuma', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    for (const rotulo of ['Pedidos', 'Atendimento', 'Materiais']) {
      await abrirAba(container, rotulo);
      expect(container.textContent).not.toContain('Pedidos Pendentes');
    }

    // A aba Pedidos consome getPendingOrders no bloco "Pedidos parados", que
    // lista os pedidos abertos mais antigos. O laço acima abre aquela aba,
    // então aqui a rota já foi chamada.
    expect(svc.getPendingOrders).toHaveBeenCalled();
    // A quarta secao era "Plotters", e ela nao voltou nem volta: o painel, a
    // rota `/plotter_status` e a funcao de servico dela sairam em 2026-08-13,
    // porque o plotter e bem do modulo Equipamento. Nao ha mais o que espiar.

    cleanup();
  });

  // A VOLTA de dois paineis, por decisao do chefe em 2026-08-07.
  //
  // Eles sairam em 2026-07-27 pelo custo de requisicao: eram quatro chamadas a
  // mais por carga, e outras quatro a cada refetch de 60 s, numa pagina unica
  // que buscava os nove endpoints de uma vez. Duas coisas mudaram desde entao.
  // A pagina virou cinco abas, e so a aba ATIVA existe no DOM, entao o custo
  // caiu de "toda visita" para "quem abrir o Resumo Anual". E a medicao na
  // producao mostrou que o dado que eles carregam nao estava em lugar nenhum:
  // o dashboard tinha a curva mensal do PEDIDO e nao a da ENTREGA, que e o
  // numero de que a DGEO presta contas; e o consumo esta sem lancamento, o que
  // deixa a mídia como o unico sinal real de gasto de papel.
  //
  // O teste guarda a PRESENCA pela mesma razao que o de cima guarda a ausencia.
  test('o Resumo Anual mostra entregas por mes e por midia, e busca as duas', async () => {
    svc.getEntregasPorMes.mockResolvedValue([
      { mes: 1, carta_topo: 289, carta_orto: 30, outros: 0, total: 319 },
      { mes: 2, carta_topo: 1532, carta_orto: 106, outros: 30, total: 1668 },
    ]);
    svc.getEntregasPorMidia.mockResolvedValue([
      { tipo_midia: 'Sulfite 120g', total_produtos: 6499 },
      { tipo_midia: 'Glossy', total_produtos: 36 },
    ]);

    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getEntregasPorMes).toHaveBeenCalledWith(ANO_ATUAL);
    expect(svc.getEntregasPorMidia).toHaveBeenCalledWith(ANO_ATUAL);
    expect(container.textContent).toContain('Entregas por mês');
    expect(container.textContent).toContain('Entregas por mídia');

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

  // O filtro e UM so, no nivel da pagina, e vale para as cinco abas. Um filtro
  // por aba faria a mesma escolha ser refeita a cada troca de aba.
  test('trocar o ano no filtro recarrega a aba aberta com o novo ano', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    await trocarAno(container, ANO_ANTERIOR);

    expect(svc.getResumoAnual).toHaveBeenLastCalledWith(ANO_ANTERIOR);
    // Sem derrubar o cache: as respostas sao guardadas por ano, entao voltar ao
    // ano anterior nao paga a busca de novo.
    expect(svc.invalidateDashboardCache).not.toHaveBeenCalled();

    cleanup();
  });

  // A aba que MONTA depois da troca tambem nasce no ano escolhido: o filtro e
  // da pagina, e nao da aba que estava aberta na hora.
  test('a aba aberta depois da troca ja nasce no ano escolhido', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    await trocarAno(container, ANO_ANTERIOR);
    await abrirAba(container, 'Pedidos');

    expect(svc.getOrderStatus).toHaveBeenCalledWith(ANO_ANTERIOR);

    cleanup();
  });

  test('depois do cleanup, trocar o ano nao busca mais nada', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();
    cleanup();
    svc.getResumoAnual.mockClear();

    await trocarAno(container, ANO_ANTERIOR);
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
