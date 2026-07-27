import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test do dashboard. O ano vem do contexto global (fixado em 2026 no
// localStorage); a carga chama getSecao3 e popula os cards/grafico/tabela a
// partir da tabela_31 (com a linha TOTAL).
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getSecao3: vi.fn(() => Promise.resolve({
    tabela_31: [
      { cod_nd: '339030', nd_nome: 'Material', previsto: 60, recebido: 30, recebido_pdr: 20, recebido_extra: 10, empenhado: 25, empenhado_pdr: 15, empenhado_extra: 10, liquidado: 20, liquidado_pdr: 12, liquidado_extra: 8 },
      { cod_nd: 'TOTAL', nd_nome: 'TOTAL', previsto: 100, recebido: 50, recebido_pdr: 35, recebido_extra: 15, empenhado: 40, empenhado_pdr: 25, empenhado_extra: 15, liquidado: 30, liquidado_pdr: 18, liquidado_extra: 12 },
    ],
    tabela_32: [],
    tabela_33: [],
    tabela_34: [],
    tabela_35: [],
    tabela_36: [],
    tabela_37: [],
  })),
}));

import { renderDashboard } from '@modules/orcamento/pages/dashboard/index.js';
import { getSecao3 } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderDashboard', () => {
  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
  });

  test('monta o dashboard e carrega a secao 3 do ano de contexto', async () => {
    const container = document.createElement('div');
    const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getSecao3).toHaveBeenCalled();
    expect(container.querySelector('.dashboard__title')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
