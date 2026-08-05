import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Smoke test da pagina de Notas de Credito. Mocka o service (lista + dialog).
// A tela tem o proprio filtro de ano e abre no ano ATUAL: nao ha mais ano global
// nem nada guardado no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotasCredito: vi.fn(() => Promise.resolve([])),
  deleteNotaCredito: vi.fn(() => Promise.resolve()),
  getClassificacaoNc: vi.fn(() => Promise.resolve([])),
  getAnos: vi.fn(() => Promise.resolve([2026, 2025])),
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

const ANO_ATUAL = new Date().getFullYear();

describe('renderNotasCreditoList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  // O ano é de cada tela, começa no ano ATUAL e não se guarda em lugar nenhum.
  test('abre no ano atual e pede a lista desse ano', async () => {
    const container = document.createElement('div');
    const cleanup = await renderNotasCreditoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const filtro = container.querySelector('.page__filters select');
    expect(filtro.value).toBe(String(ANO_ATUAL));
    expect(getNotasCredito.mock.calls.at(-1)[0].ano).toBe(ANO_ATUAL);

    if (typeof cleanup === 'function') cleanup();
  });

  test('trocar o ano no filtro recarrega a lista naquele ano', async () => {
    const container = document.createElement('div');
    const cleanup = await renderNotasCreditoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const filtro = container.querySelector('.page__filters select');
    filtro.value = '2025';
    filtro.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(getNotasCredito.mock.calls.at(-1)[0].ano).toBe(2025);

    if (typeof cleanup === 'function') cleanup();
  });
});
