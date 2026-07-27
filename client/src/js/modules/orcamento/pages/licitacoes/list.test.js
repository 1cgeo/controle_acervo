import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test da pagina de Licitacoes. Mocka o service (lista + dialog).
// O ano de contexto global e fixado em 2026 no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getLicitacoes: vi.fn(() => Promise.resolve([])),
  deleteLicitacao: vi.fn(() => Promise.resolve()),
  getTipoLicitacao: vi.fn(() => Promise.resolve([])),
  getLicitacao: vi.fn(() => Promise.resolve({})),
  createLicitacao: vi.fn(() => Promise.resolve({})),
  updateLicitacao: vi.fn(() => Promise.resolve({})),
  getDfds: vi.fn(() => Promise.resolve([])),
}));

import { renderLicitacoesList } from '@modules/orcamento/pages/licitacoes/list.js';
import { getLicitacoes } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderLicitacoesList', () => {
  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
  });

  test('monta titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderLicitacoesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getLicitacoes).toHaveBeenCalled();
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
