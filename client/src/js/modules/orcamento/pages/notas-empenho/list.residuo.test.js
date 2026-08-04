import { describe, test, expect, vi, beforeEach } from 'vitest';

// Regressao: o saldo a liquidar e somado em Number sobre NUMERIC(15,2) do
// Postgres, e sobra residuo de ponto flutuante. Dado real de producao, a NE
// 2026NE000023: 2499.01 - 339.16 - 2159.85 = 4.547473508864641e-13, e nao 0.
// O teste "<= 0" reprovava,
// a NE perdia o chip "Liquidada" e subia na ordem padrao, que e por saldo.
// O chefe via uma linha "aberta" que estava fechada.
// O list.test.js original so usa valores redondos (5000,00 menos 5000,00),
// entao passa e nao pega este caso.

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotasEmpenho: vi.fn(() => Promise.resolve([])),
  deleteNotaEmpenho: vi.fn(() => Promise.resolve()),
  getNotasCredito: vi.fn(() => Promise.resolve([])),
  getAnos: vi.fn(() => Promise.resolve([2026, 2025])),
  getNotaEmpenho: vi.fn(() => Promise.resolve({})),
  createNotaEmpenho: vi.fn(() => Promise.resolve({})),
  updateNotaEmpenho: vi.fn(() => Promise.resolve({})),
  getNaturezaDespesa: vi.fn(() => Promise.resolve([])),
  getPlanoInterno: vi.fn(() => Promise.resolve([])),
  getLicitacoes: vi.fn(() => Promise.resolve([])),
}));

import { renderNotasEmpenhoList } from '@modules/orcamento/pages/notas-empenho/list.js';
import { getNotasEmpenho } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function linhaPorTexto(container, texto) {
  return [...container.querySelectorAll('tbody tr')]
    .find(tr => tr.textContent.includes(texto));
}

describe('renderNotasEmpenhoList: residuo de ponto flutuante', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('a NE com residuo abaixo de um centavo conta como liquidada', async () => {
    getNotasEmpenho.mockResolvedValueOnce([
      // Valores exatos da NE 2026NE000023 em producao. A subtracao em ponto
      // flutuante deixa 4.5e-13, e a NE aparecia como nao liquidada.
      { id: 70, numero: '2026NE000023', ano: 2026, valor_empenhado: '2499.01', valor_anulado: '339.16', total_liquidado: '2159.85' },
      { id: 71, numero: '2026NE000024', ano: 2026, valor_empenhado: '2000.00', valor_anulado: '0.00', total_liquidado: '500.00' },
    ]);

    const container = document.createElement('div');
    await renderNotasEmpenhoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const quitada = linhaPorTexto(container, '2026NE000023');
    expect(quitada.textContent).toContain('Liquidada');
    expect(quitada.className).toContain('data-table__row--quitada');
  });

  test('um centavo de verdade continua em aberto', async () => {
    getNotasEmpenho.mockResolvedValueOnce([
      { id: 72, numero: '2026NE000025', ano: 2026, valor_empenhado: '100.00', valor_anulado: '0.00', total_liquidado: '99.99' },
    ]);

    const container = document.createElement('div');
    await renderNotasEmpenhoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const linha = linhaPorTexto(container, '2026NE000025');
    expect(linha.textContent).not.toContain('Liquidada');
    expect(linha.className).not.toContain('data-table__row--quitada');
  });
});
