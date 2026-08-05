import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderPlottersList } from '@modules/mapoteca/pages/plotters/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

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

// A INTERACAO QUE FALTAVA. GET /mapoteca/manutencao_plotter devolve a manutencao
// de TODOS os plotters, e nenhuma tela a chamava: ela so aparecia dentro da
// ficha de um equipamento. Quem pergunta "quanto a frota custou" tinha de abrir
// plotter a plotter e somar de cabeca.
describe('renderPlottersList: manutencoes da frota', () => {
  const MANUTENCOES = [
    {
      id: 11, plotter_id: 3, nr_serie: 'BR12345', modelo: 'HP DesignJet T2600',
      data_manutencao: '2026-04-10', valor: '1500.00', descricao: 'troca de cabeçote',
      usuario_criacao_nome: 'Cap Fulano',
    },
    {
      id: 12, plotter_id: 4, nr_serie: 'BR99999', modelo: 'HP DesignJet Z6',
      data_manutencao: '2026-02-01', valor: '500.50', descricao: null,
      usuario_criacao_nome: null,
    },
  ];

  const secao = (container) => [...container.querySelectorAll('.dashboard-section')]
    .find(s => s.textContent.includes('Manutenções da frota'));

  beforeEach(() => {
    svc.getPlotters.mockResolvedValue(PLOTTERS);
  });

  test('lista a manutencao dos dois plotters e soma o custo', async () => {
    svc.getManutencoes.mockResolvedValue(MANUTENCOES);
    const container = document.createElement('div');
    const cleanup = await renderPlottersList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getManutencoes).toHaveBeenCalled();
    const texto = secao(container).textContent;
    expect(texto).toContain('troca de cabeçote');
    expect(texto).toContain('HP DesignJet Z6');
    // 1500,00 + 500,50 = 2000,50. E a resposta que a ficha por ficha nao dava.
    expect(texto).toContain('2 manutenção(ões)');
    expect(texto).toContain('2.000,50');

    if (typeof cleanup === 'function') cleanup();
  });

  test('cada linha leva ao plotter dela', async () => {
    svc.getManutencoes.mockResolvedValue(MANUTENCOES);
    const container = document.createElement('div');
    const cleanup = await renderPlottersList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const link = [...secao(container).querySelectorAll('a')]
      .find(a => a.textContent.includes('HP DesignJet T2600'));
    expect(link.getAttribute('href')).toBe('#/mapoteca/plotters/3');

    if (typeof cleanup === 'function') cleanup();
  });

  test('erro na busca das manutencoes nao vira "nenhuma manutencao"', async () => {
    svc.getManutencoes.mockRejectedValue(new Error('Falha ao consultar manutenções'));
    const container = document.createElement('div');
    const cleanup = await renderPlottersList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const texto = secao(container).textContent;
    expect(texto).toContain('Falha ao consultar manutenções');
    expect(texto).not.toContain('Nenhuma manutenção registrada na frota');
    // A lista de plotters, que carregou bem, continua na tela.
    expect(container.textContent).toContain('HP DesignJet T2600');

    if (typeof cleanup === 'function') cleanup();
  });
});
