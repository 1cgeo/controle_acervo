import { describe, test, expect, vi } from 'vitest';

// O jsdom nao tem canvas: sem o dublê, todo grafico com dado explodiria.
vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

// Aba de distribuicao: cinco endpoints em paralelo, dois setores e tres barras.
vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getProdutosTipo: vi.fn(() => Promise.resolve([
    { tipo_produto: 'Carta Topográfica', quantidade: '120' },
    { tipo_produto: 'Ortoimagem', quantidade: '30' },
  ])),
  getProdutosEscala: vi.fn(() => Promise.resolve([
    { tipo_escala: '1:25.000', quantidade: '90' },
  ])),
  getGbTipoProduto: vi.fn(() => Promise.resolve([
    { tipo_produto: 'Carta Topográfica', total_gb: '12.5' },
  ])),
  getArquivosTipoArquivo: vi.fn(() => Promise.resolve([
    { tipo_arquivo: 'PDF', total_gb: '3.2', quantidade: '400' },
  ])),
  getGbVolume: vi.fn(() => Promise.resolve([
    { nome_volume: 'Volume 1', total_gb: '80', capacidade_gb_volume: '100' },
    { volume: '/dados2', nome_volume: null, total_gb: '150', capacidade_gb_volume: '100' },
  ])),
}));

import { renderDistributionTab } from './distribution-tab.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';

describe('renderDistributionTab', () => {
  test('chama os cinco endpoints e monta os cinco graficos', async () => {
    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);

    expect(acervoService.getProdutosTipo).toHaveBeenCalled();
    expect(acervoService.getProdutosEscala).toHaveBeenCalled();
    expect(acervoService.getGbTipoProduto).toHaveBeenCalled();
    expect(acervoService.getArquivosTipoArquivo).toHaveBeenCalled();
    expect(acervoService.getGbVolume).toHaveBeenCalled();

    expect(container.querySelectorAll('.chart-card')).toHaveLength(5);
    expect(container.querySelectorAll('.dashboard-grid--2col')).toHaveLength(2);

    aba.cleanup();
  });

  test('refresh recarrega os mesmos endpoints', async () => {
    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);
    const antes = acervoService.getProdutosTipo.mock.calls.length;

    await aba.refresh();
    expect(acervoService.getProdutosTipo.mock.calls.length).toBe(antes + 1);

    aba.cleanup();
  });

  test('endpoint que falha nao derruba a aba', async () => {
    acervoService.getGbVolume.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);

    expect(container.querySelectorAll('.chart-card')).toHaveLength(5);
    aba.cleanup();
  });

  test('depois do cleanup uma resposta atrasada nao mexe mais na tela', async () => {
    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);
    aba.cleanup();

    // Nao deve lancar: o load enxerga `disposed` e volta antes de tocar no DOM.
    await expect(aba.refresh()).resolves.toBeUndefined();
  });
});
