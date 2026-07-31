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

  // Chefe, 2026-07-31: o RPNP que importa é o que ainda deve dinheiro. A lista
  // abre pelo maior valor a liquidar, e o de saldo zero desce e fica esmaecido.
  // Os valores chegam como STRING (NUMERIC do PostgreSQL), que é justamente onde
  // a ordenação por texto erraria: '900.00' antes de '1000.00'.
  test('abre pelo maior valor a liquidar e esmaece o de saldo zero', async () => {
    getRpnps.mockResolvedValueOnce([
      { id: 1, empenho_label: 'NE 900', valor_empenhado: '900.00', valor_a_liquidar: '900.00' },
      { id: 2, empenho_label: 'NE quitada', valor_empenhado: '5000.00', valor_a_liquidar: '0.00' },
      { id: 3, empenho_label: 'NE 1000', valor_empenhado: '1000.00', valor_a_liquidar: '1000.00' },
    ]);

    const container = document.createElement('div');
    const cleanup = await renderRpnpList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const linhas = [...container.querySelectorAll('tbody tr')];
    const empenhos = linhas.map(tr => tr.querySelector('td').textContent);
    expect(empenhos).toEqual(['NE 1000', 'NE 900', 'NE quitada']);

    expect(linhas[2].className).toContain('data-table__row--quitada');
    expect(linhas[0].className).not.toContain('data-table__row--quitada');

    if (typeof cleanup === 'function') cleanup();
  });
});
