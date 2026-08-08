import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Smoke test da pagina de DFD. O load chama varias funcoes em Promise.all e o
// dialog importa dominios; mockamos todas com retornos simples. A tela tem o
// proprio filtro de ano e abre no ano ATUAL, sem nada guardado no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getDfds: vi.fn(() => Promise.resolve([])),
  getTipoItemDfd: vi.fn(() => Promise.resolve([])),
  getAnos: vi.fn(() => Promise.resolve([2026, 2025])),
  getDfd: vi.fn(() => Promise.resolve({})),
  createDfd: vi.fn(() => Promise.resolve({})),
  updateDfd: vi.fn(() => Promise.resolve({})),
  deleteDfd: vi.fn(() => Promise.resolve()),
}));

import { renderDfdList } from '@modules/orcamento/pages/dfd/list.js';
import { getDfds } from '@modules/orcamento/services/orcamento-service.js';

// A tela abre sempre no ano ATUAL e não guarda a escolha.
const ANO_ATUAL = new Date().getFullYear();

describe('renderDfdList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  test('abre no ano atual e recarrega ao trocar o ano no filtro', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDfdList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getDfds).toHaveBeenLastCalledWith(ANO_ATUAL);
    expect(container.querySelector('.page__title').textContent).toBe(`DFD ${ANO_ATUAL}`);

    const filtro = container.querySelector('.page__filters select');
    filtro.value = '2025';
    filtro.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(getDfds).toHaveBeenLastCalledWith(2025);
    expect(container.querySelector('.page__title').textContent).toBe('DFD 2025');

    if (typeof cleanup === 'function') cleanup();
  });
});
