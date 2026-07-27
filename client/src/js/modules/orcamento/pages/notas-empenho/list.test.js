import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test da pagina de Notas de Empenho. Mocka o service (lista + dialog).
// O ano de contexto global e fixado em 2026 no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotasEmpenho: vi.fn(() => Promise.resolve([])),
  deleteNotaEmpenho: vi.fn(() => Promise.resolve()),
  getNotasCredito: vi.fn(() => Promise.resolve([])),
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

describe('renderNotasEmpenhoList', () => {
  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
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
});
