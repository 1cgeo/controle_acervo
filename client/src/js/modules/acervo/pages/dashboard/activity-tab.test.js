import { describe, test, expect, vi } from 'vitest';

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

const hoje = new Date().toISOString().split('T')[0];

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getArquivosDia: vi.fn(() => Promise.resolve([
    { dia: `${new Date().toISOString().split('T')[0]}T00:00:00.000Z`, quantidade: '7' },
  ])),
  getDownloadsDia: vi.fn(() => Promise.resolve([
    { dia: `${new Date().toISOString().split('T')[0]}T00:00:00.000Z`, quantidade: '3' },
  ])),
  getUltimosProdutos: vi.fn(() => Promise.resolve([
    { nome: 'Carta X', mi: '2965-1', tipo_produto: 'Carta Topográfica', tipo_escala: '1:25.000', total_versoes: '3', data_cadastramento: '2026-07-01T10:00:00.000Z' },
  ])),
  getUltimasVersoes: vi.fn(() => Promise.resolve([
    { versao: '1', produto_nome: 'Carta X', mi: '2965-1', tipo_versao: 'Regular', orgao_produtor: '1 CGEO', total_arquivos: '9', data_criacao: '2026-07-02T10:00:00.000Z' },
  ])),
  getUltimosCarregamentos: vi.fn(() => Promise.resolve([
    { nome: 'arquivo.tif', tamanho_mb: '1024.456', extensao: 'tif', data_cadastramento: '2026-07-03T10:00:00.000Z' },
  ])),
  getUltimasModificacoes: vi.fn(() => Promise.resolve([
    { nome: 'outro.pdf', tamanho_mb: null, extensao: null, data_modificacao: '2026-07-04T10:00:00.000Z' },
  ])),
  getUltimosDeletes: vi.fn(() => Promise.resolve([
    { nome: 'velho.tif', tamanho_mb: '2', extensao: 'tif', data_delete: '2026-07-05T10:00:00.000Z', motivo_exclusao: 'Duplicado' },
  ])),
  getDownloads: vi.fn(() => Promise.resolve([
    { id: 1, arquivo_id: 10, data_download: '2026-07-06T10:00:00.000Z', apagado: false },
    { id: 2, arquivo_id: 11, data_download: '2026-07-06T11:00:00.000Z', apagado: true },
  ])),
  getSituacaoCarregamento: vi.fn(() => Promise.resolve([
    { situacao: 'Carregado', quantidade: '15346' },
  ])),
}));

import { renderActivityTab } from './activity-tab.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';

/** Texto das celulas da primeira linha da tabela ativa. */
function primeiraLinha(container) {
  const tr = container.querySelector('.tabs__content tbody tr');
  return tr ? Array.from(tr.children).map(td => td.textContent) : [];
}

describe('renderActivityTab', () => {
  test('carrega a serie diaria e abre a sub-aba de produtos', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    expect(acervoService.getArquivosDia).toHaveBeenCalled();
    expect(acervoService.getDownloadsDia).toHaveBeenCalled();
    expect(acervoService.getUltimosProdutos).toHaveBeenCalled();

    expect(container.querySelectorAll('.sub-tabs__item')).toHaveLength(7);
    expect(container.querySelector('.sub-tabs__item--active').textContent).toBe('Produtos Recentes');
    expect(primeiraLinha(container)[0]).toBe('Carta X');

    aba.cleanup();
  });

  test('a serie diaria cobre 30 dias e casa o dia de hoje com a quantidade', async () => {
    const { instanciasChart } = await import('@components/charts/chart-stub.js');
    instanciasChart.length = 0;

    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const grafico = instanciasChart.find(c =>
      c.data.datasets.some(d => d.label === 'Uploads'));
    expect(grafico).toBeDefined();
    expect(grafico.data.labels).toHaveLength(30);
    expect(grafico.data.labels[29]).toBe(hoje.slice(5));
    expect(grafico.data.datasets[0].data[29]).toBe(7); // uploads
    expect(grafico.data.datasets[1].data[29]).toBe(3); // downloads
    // Dia sem movimento entra como zero, e nao como buraco.
    expect(grafico.data.datasets[0].data[0]).toBe(0);

    aba.cleanup();
  });

  test('trocar de sub-aba busca o endpoint daquela aba', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const botoes = Array.from(container.querySelectorAll('.sub-tabs__item'));
    botoes.find(b => b.textContent === 'Exclusões Recentes').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(acervoService.getUltimosDeletes).toHaveBeenCalled();
    const linha = primeiraLinha(container);
    expect(linha[0]).toBe('velho.tif');
    expect(linha[4]).toBe('Duplicado');

    aba.cleanup();
  });

  test('o historico de downloads marca com chip o arquivo excluido', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const botoes = Array.from(container.querySelectorAll('.sub-tabs__item'));
    botoes.find(b => b.textContent === 'Histórico de Downloads').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const chips = Array.from(container.querySelectorAll('.tabs__content .chip')).map(c => c.textContent);
    expect(chips).toContain('Disponível');
    expect(chips).toContain('Arquivo excluído');

    aba.cleanup();
  });

  test('tamanho nulo vira "-" e a extensao sobe para maiuscula', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const botoes = Array.from(container.querySelectorAll('.sub-tabs__item'));
    botoes.find(b => b.textContent === 'Uploads Recentes').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(primeiraLinha(container)[1]).toBe('1024.46');
    expect(primeiraLinha(container)[2]).toBe('TIF');

    botoes.find(b => b.textContent === 'Modificações Recentes').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(primeiraLinha(container)[1]).toBe('-');
    expect(primeiraLinha(container)[2]).toBe('-');

    aba.cleanup();
  });

  test('a sub-aba de situacao de carregamento monta um grafico de setores', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const botoes = Array.from(container.querySelectorAll('.sub-tabs__item'));
    botoes.find(b => b.textContent === 'Situação de Carregamento').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(acervoService.getSituacaoCarregamento).toHaveBeenCalled();
    expect(container.querySelector('.tabs__content .chart-card')).not.toBeNull();

    aba.cleanup();
  });

  test('refresh recarrega a serie diaria e a sub-aba ativa', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const antesDiario = acervoService.getArquivosDia.mock.calls.length;
    const antesProdutos = acervoService.getUltimosProdutos.mock.calls.length;

    await aba.refresh();

    expect(acervoService.getArquivosDia.mock.calls.length).toBe(antesDiario + 1);
    expect(acervoService.getUltimosProdutos.mock.calls.length).toBe(antesProdutos + 1);

    aba.cleanup();
  });

  test('endpoint da tabela que falha deixa a aba de pe, so vazia', async () => {
    acervoService.getUltimosProdutos.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    expect(container.querySelector('.tabs__content .data-table__empty')).not.toBeNull();
    aba.cleanup();
  });
});
