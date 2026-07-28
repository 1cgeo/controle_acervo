import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderPlotterDetails } from '@modules/mapoteca/pages/plotters/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, GERENTE } from '@/__tests__/helpers/sessao.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const PLOTTER = {
  id: 3,
  ativo: true,
  nr_serie: 'BR12345',
  modelo: 'HP DesignJet T2600',
  data_aquisicao: '2023-03-01',
  vida_util: 60,
  estatisticas: {
    total_manutencoes: 2,
    data_ultima_manutencao: '2026-04-10',
    valor_total_manutencoes: 3200,
    valor_medio_manutencoes: 1600,
    tempo_medio_entre_manutencoes_dias: 180,
  },
  manutencoes: [
    { id: 90, data_manutencao: '2026-04-10', valor: 1600, descricao: 'Troca de cabeçote' },
  ],
};

describe('renderPlotterDetails', () => {
  beforeEach(() => {
    // A tela esconde escrita por perfil: sem sessao nao ha botao para testar.
    logarComo({ mapoteca: GERENTE });
    svc.getPlotter.mockResolvedValue(PLOTTER);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('busca o plotter do :id e monta cards e manutencoes', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPlotterDetails(container, { params: { id: '3' }, query: new URLSearchParams() });
    await flush();

    expect(svc.getPlotter).toHaveBeenCalledWith(3);
    expect(container.querySelector('.page__title').textContent).toBe('HP DesignJet T2600 — BR12345');
    expect(container.textContent).toContain('Total de manutenções');
    expect(container.textContent).toContain('Troca de cabeçote');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o voltar leva a lista COM o prefixo do modulo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPlotterDetails(container, { params: { id: '3' }, query: new URLSearchParams() });
    await flush();

    location.hash = '#/mapoteca/plotters/3';
    container.querySelector('.btn--text').click();
    expect(location.hash).toBe('#/mapoteca/plotters');

    if (typeof cleanup === 'function') cleanup();
  });

  test('abrir o dialogo de manutencao nao grava nada', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPlotterDetails(container, { params: { id: '3' }, query: new URLSearchParams() });
    await flush();

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Adicionar manutenção')).click();
    await flush();

    expect(document.body.textContent).toContain('Adicionar manutenção');
    expect(svc.createManutencao).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });
});
