import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test da pagina de Notas de Empenho. Mocka o service (lista + dialog).
// A tela tem o proprio filtro de ano e abre no ano ATUAL: nao ha mais ano global
// nem nada guardado no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotasEmpenho: vi.fn(() => Promise.resolve([])),
  deleteNotaEmpenho: vi.fn(() => Promise.resolve()),
  getNotasCredito: vi.fn(() => Promise.resolve([])),
  getAnos: vi.fn(() => Promise.resolve([2026, 2025])),
  getNotaEmpenho: vi.fn(() => Promise.resolve({})),
  createNotaEmpenho: vi.fn(() => Promise.resolve({})),
  updateNotaEmpenho: vi.fn(() => Promise.resolve({})),
  getNaturezaDespesa: vi.fn(() => Promise.resolve([])),
  getPlanoInterno: vi.fn(() => Promise.resolve([])),
  getLicitacoes: vi.fn(() => Promise.resolve([])),
}));

import { renderNotasEmpenhoList } from '@modules/orcamento/pages/notas-empenho/list.js';
import { getNotasEmpenho } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const ANO_ATUAL = new Date().getFullYear();

describe('renderNotasEmpenhoList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Chefe, 2026-08-04: o ano e de cada tela e comeca no ano ATUAL.
  test('abre no ano atual e pede a lista desse ano', async () => {
    const container = document.createElement('div');
    const cleanup = await renderNotasEmpenhoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const filtro = container.querySelector('.page__filters select');
    expect(filtro.value).toBe(String(ANO_ATUAL));
    expect(getNotasEmpenho.mock.calls.at(-1)[0].ano).toBe(ANO_ATUAL);

    if (typeof cleanup === 'function') cleanup();
  });

  test('monta titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderNotasEmpenhoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getNotasEmpenho).toHaveBeenCalled();
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // Chefe, 2026-07-31: as 100% liquidadas vão para o fim e ficam visualmente
  // distintas. A ordem é pelo saldo a liquidar, que a tela CALCULA (empenhado
  // menos anulado menos liquidado); o backend não devolve essa coluna.
  test('ordena pelo saldo a liquidar e joga a 100% liquidada para o fim', async () => {
    getNotasEmpenho.mockResolvedValueOnce([
      // Liquidada por inteiro: some do topo e ganha a marca.
      { id: 1, numero: 'NE quitada', ano: 2026, valor_empenhado: '5000.00', valor_anulado: '0.00', total_liquidado: '5000.00' },
      { id: 2, numero: 'NE 900', ano: 2026, valor_empenhado: '1000.00', valor_anulado: '0.00', total_liquidado: '100.00' },
      { id: 3, numero: 'NE 2000', ano: 2026, valor_empenhado: '2000.00', valor_anulado: '0.00', total_liquidado: '0.00' },
      // Anulada por inteiro: nada mais a liquidar, mesmo sem liquidação nenhuma.
      { id: 4, numero: 'NE anulada', ano: 2026, valor_empenhado: '800.00', valor_anulado: '800.00', total_liquidado: '0.00' },
    ]);

    const container = document.createElement('div');
    const cleanup = await renderNotasEmpenhoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const linhas = [...container.querySelectorAll('tbody tr')];
    const numeros = linhas.map(tr => tr.querySelector('td').textContent);
    expect(numeros.slice(0, 2)).toEqual(['NE 2000', 'NE 900']);
    expect(numeros.slice(2)).toEqual(expect.arrayContaining(['NE quitada', 'NE anulada']));

    expect(linhas[0].className).not.toContain('data-table__row--quitada');
    expect(linhas[2].className).toContain('data-table__row--quitada');
    expect(linhas[3].className).toContain('data-table__row--quitada');

    // A coluna "A liquidar" troca o valor por um chip nas que já fecharam.
    expect(container.textContent).toContain('Liquidada');

    if (typeof cleanup === 'function') cleanup();
  });
});
