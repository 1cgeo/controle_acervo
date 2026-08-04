import { describe, test, expect, vi } from 'vitest';

// Smoke test da pagina de Licitacoes. Mocka o service (lista + dialog).
//
// O ano NAO vem mais de localStorage: o seletor global acabou (chefe,
// 2026-08-04) e cada tela tem o seu filtro, que comeca no ano atual. Por isso o
// teste afirma o ANO CORRENTE no filtro passado ao service, e nao um 2026 que o
// proprio teste tinha plantado. A assercao antiga passava mesmo se a tela
// parasse de filtrar por ano.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getLicitacoes: vi.fn(() => Promise.resolve([])),
  deleteLicitacao: vi.fn(() => Promise.resolve()),
  getTipoLicitacao: vi.fn(() => Promise.resolve([])),
  getLicitacao: vi.fn(() => Promise.resolve({})),
  createLicitacao: vi.fn(() => Promise.resolve({})),
  updateLicitacao: vi.fn(() => Promise.resolve({})),
  getDfds: vi.fn(() => Promise.resolve([])),
  getAnos: vi.fn(() => Promise.resolve([2025, 2026])),
}));

import { renderLicitacoesList } from '@modules/orcamento/pages/licitacoes/list.js';
import { getLicitacoes } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderLicitacoesList', () => {
  test('monta titulo e carrega a lista do ano atual', async () => {
    const container = document.createElement('div');
    const cleanup = await renderLicitacoesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getLicitacoes).toHaveBeenCalledWith(
      expect.objectContaining({ ano: new Date().getFullYear() }),
    );
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
