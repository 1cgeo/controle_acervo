import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test da pagina de RPNP. Mocka o service (lista + dialog).
// O ano de contexto global e fixado em 2026 no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getRpnps: vi.fn(() => Promise.resolve([])),
  deleteRpnp: vi.fn(() => Promise.resolve()),
  getRpnp: vi.fn(() => Promise.resolve({})),
  createRpnp: vi.fn(() => Promise.resolve({})),
  updateRpnp: vi.fn(() => Promise.resolve({})),
  getNotasEmpenho: vi.fn(() => Promise.resolve([])),
}));

import { renderRpnpList } from '@modules/orcamento/pages/rpnp/list.js';
import { getRpnps } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderRpnpList', () => {
  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
  });

  test('monta titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRpnpList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getRpnps).toHaveBeenCalled();
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
