import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test da pagina de Notas de Credito. Mocka o service (lista + dialog).
// O ano de contexto global e fixado em 2026 no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotasCredito: vi.fn(() => Promise.resolve([])),
  deleteNotaCredito: vi.fn(() => Promise.resolve()),
  getClassificacaoNc: vi.fn(() => Promise.resolve([])),
  getNotaCredito: vi.fn(() => Promise.resolve({})),
  createNotaCredito: vi.fn(() => Promise.resolve({})),
  updateNotaCredito: vi.fn(() => Promise.resolve({})),
  getNaturezaDespesa: vi.fn(() => Promise.resolve([])),
  getPlanoInterno: vi.fn(() => Promise.resolve([])),
  getUg: vi.fn(() => Promise.resolve([])),
  getPdrItens: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return { ...real, getMetasPit: vi.fn(() => Promise.resolve([])) };
});

import { renderNotasCreditoList } from '@modules/orcamento/pages/notas-credito/list.js';
import { getNotasCredito } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderNotasCreditoList', () => {
  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
  });

  test('monta titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderNotasCreditoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getNotasCredito).toHaveBeenCalled();
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
