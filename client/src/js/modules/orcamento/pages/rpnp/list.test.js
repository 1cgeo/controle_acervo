import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Smoke test da pagina de RPNP. Mocka o service (lista + dialog).
// A tela tem o proprio filtro de ano e abre no ano ATUAL: nao ha mais ano global
// nem nada guardado no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getRpnps: vi.fn(() => Promise.resolve([])),
  deleteRpnp: vi.fn(() => Promise.resolve()),
  getRpnp: vi.fn(() => Promise.resolve({})),
  createRpnp: vi.fn(() => Promise.resolve({})),
  updateRpnp: vi.fn(() => Promise.resolve({})),
  getNotasEmpenho: vi.fn(() => Promise.resolve([])),
  getAnos: vi.fn(() => Promise.resolve([2026, 2025])),
}));

import { renderRpnpList } from '@modules/orcamento/pages/rpnp/list.js';
import { getRpnps } from '@modules/orcamento/services/orcamento-service.js';

// A tela abre sempre no ano ATUAL e não guarda a escolha.
const ANO_ATUAL = new Date().getFullYear();

describe('renderRpnpList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('abre no ano atual e recarrega ao trocar o ano no filtro', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRpnpList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getRpnps).toHaveBeenLastCalledWith(ANO_ATUAL);

    const filtro = container.querySelector('.page__filters select');
    expect(filtro).not.toBeNull();
    expect(filtro.value).toBe(String(ANO_ATUAL));

    filtro.value = '2025';
    filtro.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(getRpnps).toHaveBeenLastCalledWith(2025);
    // O resumo nomeia o ano da tela, e nao um ano guardado.
    expect(container.querySelector('.page__subtitle').textContent).toContain('2025');

    if (typeof cleanup === 'function') cleanup();
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

  // O RPNP que importa é o que ainda deve dinheiro. A lista abre pelo maior
  // valor a liquidar, e o de saldo zero desce e fica esmaecido.
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
