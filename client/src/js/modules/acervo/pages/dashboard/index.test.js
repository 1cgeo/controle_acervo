import { describe, test, expect, vi, afterEach } from 'vitest';

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
    sessoes_abertas: 0, por_situacao: [], por_tipo_arquivo: [],
    por_missao: [], por_mes: [], ultimas_importacoes: [],
  })),
}));

vi.mock('@modules/acervo/services/acervo-service.js', () => {
  const vazio = () => Promise.resolve([]);
  return {
  invalidarDashboard: vi.fn(),
  EXPORTACOES_ACERVO: [
    { label: 'Exportar planilha (CSV)', endpoint: '/acervo/export-planilha-csv', filename: 'planilha-acervo.zip' },
    { label: 'Exportar GeoJSON (site de produtos)', endpoint: '/acervo/situacao-geral', filename: 'situacao-geral.zip' },
  ],
  getProdutosTotal: vi.fn(() => Promise.resolve({ total_produtos: 5741 })),
  getArquivosTotalGb: vi.fn(() => Promise.resolve({ total_gb: 100 })),
  getUsuariosTotal: vi.fn(() => Promise.resolve({ total_usuarios: 10 })),
  getSystemHealth: vi.fn(() => Promise.resolve({
    volumes_alertas: [], erros_arquivo: {}, sessoes_upload_ativas: 0,
    total_versoes: 7023, total_projetos: 12, downloads_24h: 5,
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

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const rotulosAbas = (container) =>
  Array.from(container.querySelectorAll('.tabs > .tabs__item')).map(b => b.textContent);

afterEach(() => {
  vi.useRealTimers();
});

describe('renderDashboard do acervo', () => {
  test('monta o titulo, a barra de exportacao e as cinco abas', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });

    expect(container.querySelector('.dashboard__title').textContent).toBe('Dashboard do Acervo');
    expect(rotulosAbas(container)).toEqual([
      'Visão Geral', 'Distribuição', 'Atividade', 'Análises Avançadas',
      'Ponto de Controle',
    ]);

    const botoesExport = container.querySelectorAll('.export-bar__btn');
    expect(botoesExport).toHaveLength(2);
    expect(botoesExport[0].textContent).toContain('Exportar planilha (CSV)');

    cleanup();
  });

  test('abre na aba de visao geral e ja carrega os totais', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container);

    expect(acervoService.getProdutosTotal).toHaveBeenCalled();
    expect(container.querySelectorAll('.stats-card')).toHaveLength(6);
    // A aba de distribuicao ainda nao existe no DOM: so a ativa e montada.
    expect(acervoService.getProdutosTipo).not.toHaveBeenCalled();

    cleanup();
  });

  test('clicar em cada aba monta a aba correspondente', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container);
    const botoes = Array.from(container.querySelectorAll('.tabs > .tabs__item'));

    botoes[1].click();
    await flush();
    expect(acervoService.getProdutosTipo).toHaveBeenCalled();
    expect(container.querySelectorAll('.tabs__content .chart-card')).toHaveLength(5);

    botoes[2].click();
    await flush();
    expect(acervoService.getArquivosDia).toHaveBeenCalled();
    expect(container.querySelectorAll('.sub-tabs__item')).toHaveLength(7);

    botoes[3].click();
    await flush();
    expect(acervoService.getProdutoActivityTimeline).toHaveBeenCalled();
    expect(container.querySelectorAll('.sub-tabs__item')).toHaveLength(4);

    cleanup();
  });

  test('o auto-refresh de 60 s derruba o cache e recarrega so a aba ativa', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container);

    const antes = acervoService.getProdutosTotal.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(acervoService.invalidarDashboard).toHaveBeenCalledTimes(1);
    expect(acervoService.getProdutosTotal.mock.calls.length).toBe(antes + 1);
    // A aba inativa continua sem ser buscada.
    expect(acervoService.getProdutosTipo).not.toHaveBeenCalled();

    cleanup();
  });

  test('o cleanup para o auto-refresh e limpa a aba ativa', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container);

    cleanup();
    const antes = acervoService.getProdutosTotal.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

    expect(acervoService.invalidarDashboard).not.toHaveBeenCalled();
    expect(acervoService.getProdutosTotal.mock.calls.length).toBe(antes);
  });
});
