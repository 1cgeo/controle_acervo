import { describe, test, expect, vi, beforeEach } from 'vitest';

// Regressao: valor_a_liquidar NULO significa "nao informado", nunca "quitado".
// toNumber(null) devolve 0 (utils/format.js:104), entao a linha nula recebia a
// classe de quitada e afundava na ordenacao. Em producao sao 11 dos 15 RPNP de
// 2026, incluindo o maior empenho (R$ 65.996,85). A celula mostrava "-" e a
// linha dizia "saldada": a mesma linha se contradizia.

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

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function linhaPorTexto(container, texto) {
  return [...container.querySelectorAll('tbody tr')]
    .find(tr => tr.textContent.includes(texto));
}

describe('renderRpnpList: nulo nao e zero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('valor a liquidar nulo nao marca a linha como quitada', async () => {
    getRpnps.mockResolvedValueOnce([
      // Caso real de producao: o maior empenho do ano, com valor nao informado.
      { id: 1, ano: 2026, empenho_label: '2025NE000001 (Secundária)', finalidade: 'x', valor_empenhado: '65996.85', valor_a_liquidar: null },
      // Quitado de verdade: zero informado.
      { id: 2, ano: 2026, empenho_label: '2025NE000002', finalidade: 'y', valor_empenhado: '1000.00', valor_a_liquidar: '0.00' },
      // Em aberto.
      { id: 3, ano: 2026, empenho_label: '2025NE000003', finalidade: 'z', valor_empenhado: '2000.00', valor_a_liquidar: '500.00' },
    ]);

    const container = document.createElement('div');
    await renderRpnpList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const nula = linhaPorTexto(container, '2025NE000001');
    const zerada = linhaPorTexto(container, '2025NE000002');
    const aberta = linhaPorTexto(container, '2025NE000003');

    expect(nula.className).not.toContain('data-table__row--quitada');
    expect(zerada.className).toContain('data-table__row--quitada');
    expect(aberta.className).not.toContain('data-table__row--quitada');
  });

  test('a linha de valor nulo nao afunda abaixo da quitada', async () => {
    getRpnps.mockResolvedValueOnce([
      { id: 2, ano: 2026, empenho_label: 'ZERADA', finalidade: 'y', valor_empenhado: '1000.00', valor_a_liquidar: '0.00' },
      { id: 1, ano: 2026, empenho_label: 'NULA', finalidade: 'x', valor_empenhado: '65996.85', valor_a_liquidar: null },
      { id: 3, ano: 2026, empenho_label: 'ABERTA', finalidade: 'z', valor_empenhado: '2000.00', valor_a_liquidar: '500.00' },
    ]);

    const container = document.createElement('div');
    await renderRpnpList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const ordem = [...container.querySelectorAll('tbody tr')]
      .map(tr => tr.querySelector('td').textContent);
    // A quitada de verdade fica por ultimo. A de valor desconhecido, nao.
    expect(ordem.at(-1)).toBe('ZERADA');
  });
});
