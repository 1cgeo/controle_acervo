import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderPlottersList } from '@modules/mapoteca/pages/plotters/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const PLOTTERS = [
  {
    id: 3, ativo: true, nr_serie: 'BR12345', modelo: 'HP DesignJet T2600',
    data_aquisicao: '2023-03-01', vida_util: 60,
    data_ultima_manutencao: '2026-04-10', quantidade_manutencoes: '2',
  },
  {
    id: 4, ativo: false, nr_serie: 'BR99999', modelo: 'HP DesignJet Z6',
    data_aquisicao: null, vida_util: null,
    data_ultima_manutencao: null, quantidade_manutencoes: '0',
  },
];

describe('renderPlottersList', () => {
  beforeEach(() => {
    svc.getPlotters.mockResolvedValue(PLOTTERS);
  });

  test('monta o titulo e carrega os plotters', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPlottersList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getPlotters).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Plotters');
    expect(container.textContent).toContain('HP DesignJet T2600');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o numero de serie linka o detalhe COM o prefixo do modulo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPlottersList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const link = [...container.querySelectorAll('a')].find(a => a.textContent === 'BR12345');
    expect(link.getAttribute('href')).toBe('#/mapoteca/plotters/3');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o status vira chip Ativo/Inativo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPlottersList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const chips = [...container.querySelectorAll('.chip')].map(c => c.textContent);
    expect(chips).toContain('Ativo');
    expect(chips).toContain('Inativo');

    if (typeof cleanup === 'function') cleanup();
  });
});
