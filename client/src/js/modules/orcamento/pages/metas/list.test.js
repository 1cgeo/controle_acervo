import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test da pagina de Metas do PIT. Mocka o service (lista + dialog) e
// verifica que renderMetasList monta o titulo, a tabela e carrega as metas do
// ano de contexto global (fixado em 2026 no localStorage).
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getMetas: vi.fn(() => Promise.resolve([])),
  deleteMeta: vi.fn(() => Promise.resolve()),
  createMeta: vi.fn(() => Promise.resolve({})),
  updateMeta: vi.fn(() => Promise.resolve({})),
}));

import { renderMetasList } from '@modules/orcamento/pages/metas/list.js';
import { getMetas } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderMetasList', () => {
  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
  });

  test('monta titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderMetasList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getMetas).toHaveBeenCalled();
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
