import { describe, test, expect, vi, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

// Mock unico do servico: a pagina monta as cinco abas e cada uma bate em um
// grupo de endpoints. O invalidarDashboard e o gatilho do auto-refresh.
// A fabrica do vi.mock sobe para o topo do arquivo, entao o `vazio` nasce
// DENTRO dela: variavel de fora ainda nao existe na hora em que ela roda.
// A aba de ponto de controle bate num servico proprio (schema proprio no banco,
// rota propria). Sem este mock ela tentaria rede no jsdom.
vi.mock('@modules/acervo/services/ponto-controle-service.js', () => ({
  getDashboardPontoControle: vi.fn(() => Promise.resolve({
    total_pontos: 0, total_arquivos: 0, total_gb: 0, total_missoes: 0,
    sessoes_abertas: 0, por_tipo_arquivo: [],
    por_missao: [], por_mes: [], ultimas_importacoes: [],
  })),
}));

// A aba Plano do Ano le a grade do PIT, que e rota de PLATAFORMA e cobra
// gerente. O mock devolve gerente para a aba montar inteira sob teste; o caso
// de quem NAO e gerente vive em plano-tab.test.js.
vi.mock('@store/auth-store.js', async (importarOriginal) => ({
  ...(await importarOriginal()),
  ehGerenteDeAlgumModulo: vi.fn(() => true),
}));

vi.mock('@services/plataforma-service.js', async (importarOriginal) => ({
  ...(await importarOriginal()),
  getGradePit: vi.fn(() => Promise.resolve([])),
  getDiagnosticoPit: vi.fn(() => Promise.resolve([])),
  getAnosMetaPit: vi.fn(() => Promise.resolve([2026])),
}));

vi.mock('@modules/acervo/services/acervo-service.js', () => {
  const vazio = () => Promise.resolve([]);
  return {
  invalidarDashboard: vi.fn(),
  EXPORTACOES_ACERVO: [
    { label: 'Exportar planilha (CSV)', endpoint: '/acervo/export-planilha-csv', filename: 'planilha-acervo.zip' },
    { label: 'Exportar GeoJSON (site de produtos)', endpoint: '/acervo/situacao-geral', filename: 'situacao-geral.zip' },
  ],
  getPlanoDoAno: vi.fn(() => Promise.resolve({
    a_produzir: [], lotes_em_execucao: [], extra_pit: [],
  })),
  getProdutosTotal: vi.fn(() => Promise.resolve({ total_produtos: 5741 })),
  getArquivosTotalGb: vi.fn(() => Promise.resolve({ total_gb: 100 })),
  getUsuariosTotal: vi.fn(() => Promise.resolve({ total_usuarios: 10 })),
  getSystemHealth: vi.fn(() => Promise.resolve({
    volumes_alertas: [], erros_arquivo: {}, sessoes_upload_ativas: 0,
    total_versoes: 7023, total_projetos: 12, downloads_30d: 5,
  })),
  getProdutosTipo: vi.fn(vazio),
  getProdutosEscala: vi.fn(vazio),
  getGbTipoProduto: vi.fn(vazio),
  getArquivosTipoArquivo: vi.fn(vazio),
  getGbVolume: vi.fn(vazio),
  getArquivosDia: vi.fn(vazio),
  getDownloadsDia: vi.fn(vazio),
  getUltimosProdutos: vi.fn(vazio),
  getUltimasVersoes: vi.fn(vazio),
  getUltimosCarregamentos: vi.fn(vazio),
  getUltimasModificacoes: vi.fn(vazio),
  getUltimosDeletes: vi.fn(vazio),
  getDownloads: vi.fn(vazio),
  getSituacaoCarregamento: vi.fn(vazio),
  getProdutoActivityTimeline: vi.fn(vazio),
  getVersaoActivityTimeline: vi.fn(vazio),
  getStorageGrowthTrends: vi.fn(vazio),
  getVersionStatistics: vi.fn(() => Promise.resolve({ stats: {}, distribution: [], type_distribution: [] })),
  getProjectStatusSummary: vi.fn(() => Promise.resolve({ projects_without_lots: 0, project_status: [], lot_status: [] })),
  getUserActivityMetrics: vi.fn(vazio),
  };
});

import { renderDashboard } from './index.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';
import { instanciasChart } from '@components/charts/chart-stub.js';

const rotulosAbas = (container) =>
  Array.from(container.querySelectorAll('.tabs > .tabs__item')).map(b => b.textContent);

afterEach(() => {
  vi.useRealTimers();
});

describe('renderDashboard do acervo', () => {
  test('monta o titulo, a barra de exportacao e as seis abas', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });

    expect(container.querySelector('.dashboard__title').textContent).toBe('Dashboard do Acervo');
    // O Plano do Ano vem PRIMEIRO: e a unica aba que responde o que o acervo
    // DEVE, com prazo, e o resto responde o que ele tem.
    expect(rotulosAbas(container)).toEqual([
      'Plano do Ano', 'Visão Geral', 'Distribuição', 'Atividade',
      'Análises Avançadas', 'Ponto de Controle',
    ]);

    const botoesExport = container.querySelectorAll('.export-bar__btn');
    expect(botoesExport).toHaveLength(2);
    expect(botoesExport[0].textContent).toContain('Exportar planilha (CSV)');

    cleanup();
  });

  test('abre no plano do ano e ja carrega o plano, nao os totais', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container);

    expect(acervoService.getPlanoDoAno).toHaveBeenCalled();
    // As outras abas nao existem no DOM: so a ativa e montada.
    expect(acervoService.getProdutosTotal).not.toHaveBeenCalled();
    expect(acervoService.getProdutosTipo).not.toHaveBeenCalled();

    cleanup();
  });

  test('clicar em cada aba monta a aba correspondente', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container);
    const botoes = Array.from(container.querySelectorAll('.tabs > .tabs__item'));

    botoes[1].click();
    await flush();
    expect(acervoService.getProdutosTotal).toHaveBeenCalled();
    expect(container.querySelectorAll('.stats-card')).toHaveLength(6);

    botoes[2].click();
    await flush();
    expect(acervoService.getProdutosTipo).toHaveBeenCalled();
    // SETE: GB e quantidade por tipo de arquivo viraram dois gráficos (duas
    // unidades no mesmo eixo Y não se comparam), e a situação de carregamento
    // voltou como barra quando a carga no BDGEx passou a ser registrada.
    expect(container.querySelectorAll('.tabs__content .chart-card')).toHaveLength(7);

    botoes[3].click();
    await flush();
    expect(acervoService.getArquivosDia).toHaveBeenCalled();
    // SEIS: saiu "Situação de Carregamento", que era uma pizza de uma fatia só.
    expect(container.querySelectorAll('.sub-tabs__item')).toHaveLength(6);

    botoes[4].click();
    await flush();
    expect(acervoService.getVersaoActivityTimeline).toHaveBeenCalled();
    // DUAS: saíram "Status de Projetos" e "Atividade de Usuários".
    expect(container.querySelectorAll('.sub-tabs__item')).toHaveLength(2);

    cleanup();
  });

  test('o auto-refresh de 5 min derruba o cache e recarrega so a aba ativa', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container);

    const antes = acervoService.getPlanoDoAno.mock.calls.length;
    // Um minuto NAO basta mais: e o que faz este teste reprovar o intervalo
    // antigo em vez de passar nos dois.
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(acervoService.invalidarDashboard).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);

    expect(acervoService.invalidarDashboard).toHaveBeenCalledTimes(1);
    expect(acervoService.getPlanoDoAno.mock.calls.length).toBe(antes + 1);
    // A aba inativa continua sem ser buscada.
    expect(acervoService.getProdutosTipo).not.toHaveBeenCalled();

    cleanup();
  });

  test('o cleanup para o auto-refresh e desmonta a aba ativa', async () => {
    vi.useFakeTimers();
    const jaVivos = instanciasChart.length;
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container);

    // O Plano do Ano e a Visão Geral são tabelas e cartões, sem gráfico. A
    // Distribuição desenha, e é pelo gráfico dela que dá para ver se a aba ATIVA
    // foi desmontada. Com lista vazia o cartão escreve "Sem dados" e nenhum
    // Chart nasce: daí o dado.
    acervoService.getProdutosTipo.mockResolvedValue([
      { tipo_produto: 'Carta Topográfica', total: 12 },
    ]);
    Array.from(container.querySelectorAll('.tabs > .tabs__item'))[2].click();
    await vi.advanceTimersByTimeAsync(0);

    const graficos = instanciasChart.slice(jaVivos);
    expect(graficos.length).toBeGreaterThan(0);

    cleanup();
    const antes = acervoService.getProdutosTipo.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(acervoService.invalidarDashboard).not.toHaveBeenCalled();
    expect(acervoService.getProdutosTipo.mock.calls.length).toBe(antes);
    // A aba ativa saiu junto: os gráficos dela foram destruídos.
    expect(graficos.every(g => g.destroyed)).toBe(true);
  });
});
