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

const toast = vi.hoisted(() => ({
  showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn(),
}));
vi.mock('@utils/toast.js', () => toast);

import { renderDfdList } from '@modules/orcamento/pages/dfd/list.js';
import { getDfds, getTipoItemDfd } from '@modules/orcamento/services/orcamento-service.js';

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

  // O DOMINIO CAI SOZINHO. Ele serve ao DIALOGO (o combo "Tipo do item" do
  // editor de itens), e nao a lista: junto num `Promise.all`, a falha dele
  // deixava a tela do PCA INTEIRO em branco, com uma mensagem que nem falava de
  // DFD. E o caso que o CLAUDE.md registra com este nome.
  test('o domínio fora do ar deixa a lista de DFD de pé, com o aviso do que ficou vazio', async () => {
    getDfds.mockResolvedValueOnce([
      { id: 1, numero: '103/2025', objeto: 'Suprimentos', valor_estimado: '100.00', consta_pca: true },
      { id: 2, numero: '104/2025', objeto: 'Plotters', valor_estimado: '200.00', consta_pca: false },
    ]);
    getTipoItemDfd.mockRejectedValueOnce(new Error('domínio fora do ar'));

    const container = document.createElement('div');
    const cleanup = await renderDfdList(container, { params: {}, query: new URLSearchParams() });
    await flush();
    await flush();

    expect(container.querySelectorAll('.data-table tbody tr')).toHaveLength(2);
    expect(container.querySelector('.dashboard-erro')).toBeNull();
    expect(toast.showError).toHaveBeenCalledTimes(1);
    expect(toast.showError.mock.calls[0][0]).toContain('Tipo do item');

    if (typeof cleanup === 'function') cleanup();
  });
});
