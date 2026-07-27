import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test da pagina de DFD. O load chama varias funcoes em Promise.all e o
// dialog importa dominios; mockamos todas com retornos simples. O ano de
// contexto global e fixado em 2026 no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getDfds: vi.fn(() => Promise.resolve([])),
  getGrauPrioridade: vi.fn(() => Promise.resolve([])),
  getTipoItemDfd: vi.fn(() => Promise.resolve([])),
  getDfd: vi.fn(() => Promise.resolve({})),
  createDfd: vi.fn(() => Promise.resolve({})),
  updateDfd: vi.fn(() => Promise.resolve({})),
  deleteDfd: vi.fn(() => Promise.resolve()),
}));

import { renderDfdList } from '@modules/orcamento/pages/dfd/list.js';
import { getDfds } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderDfdList', () => {
  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
  });

  test('monta titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDfdList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getDfds).toHaveBeenCalled();
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
