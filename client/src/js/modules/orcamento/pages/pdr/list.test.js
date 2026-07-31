import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test da tela de PDR. O PDR e o conjunto dos seus itens amarrados no ano
// de contexto global: a pagina lista os itens (CRUD) e mostra um cartao-resumo
// com os totais calculados. O ano de contexto e fixado em 2026 no localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getPdrItens: vi.fn(() => Promise.resolve([])),
  getPdrItem: vi.fn(() => Promise.resolve({})),
  createPdrItem: vi.fn(() => Promise.resolve({})),
  updatePdrItem: vi.fn(() => Promise.resolve({})),
  deletePdrItem: vi.fn(() => Promise.resolve()),
  getNaturezaDespesa: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return { ...real, getMetasPit: vi.fn(() => Promise.resolve([])) };
});

import { renderPdrList } from '@modules/orcamento/pages/pdr/list.js';
import { getPdrItens } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderPdrList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('@sca-orcamento-ano', '2026');
  });

  test('monta titulo do ano e carrega os itens do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPdrList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getPdrItens).toHaveBeenCalledWith(2026);
    const title = container.querySelector('.page__title');
    expect(title).not.toBeNull();
    expect(title.textContent).toBe('PDR 2026');
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('cartao-resumo soma os totais a partir dos itens carregados', async () => {
    getPdrItens.mockResolvedValueOnce([
      { id: 1, cod_nd: '339030', nd_nome: 'Consumo', gnd: 3, valor_solicitado: 1000, valor_autorizado: 800 },
      { id: 2, cod_nd: '449052', nd_nome: 'Permanente', gnd: 4, valor_solicitado: 2000, valor_autorizado: 1500 },
    ]);
    const container = document.createElement('div');
    const cleanup = await renderPdrList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const summary = container.querySelector('.pdr-summary');
    expect(summary).not.toBeNull();
    const text = summary.textContent;
    // Total solicitado 3000, total autorizado 2300, gnd3 800, gnd4 1500.
    expect(text).toContain('3.000,00');
    expect(text).toContain('2.300,00');
    expect(text).toContain('800,00');
    expect(text).toContain('1.500,00');

    if (typeof cleanup === 'function') cleanup();
  });
});
