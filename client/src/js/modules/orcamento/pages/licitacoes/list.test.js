import { describe, test, expect, vi } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Smoke test da página de Licitações. Mocka o service (lista + diálogo).
//
// O ano é de cada tela e começa no ano CORRENTE, nunca em localStorage. O caso
// afirma o ano corrente no filtro passado ao service: um ano fixo plantado pelo
// próprio teste passaria mesmo se a tela parasse de filtrar por ano.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getLicitacoes: vi.fn(() => Promise.resolve([])),
  deleteLicitacao: vi.fn(() => Promise.resolve()),
  getTipoLicitacao: vi.fn(() => Promise.resolve([])),
  getLicitacao: vi.fn(() => Promise.resolve({})),
  createLicitacao: vi.fn(() => Promise.resolve({})),
  updateLicitacao: vi.fn(() => Promise.resolve({})),
  getDfds: vi.fn(() => Promise.resolve([])),
  getAnos: vi.fn(() => Promise.resolve([2025, 2026])),
}));

import { renderLicitacoesList } from '@modules/orcamento/pages/licitacoes/list.js';
import { getLicitacoes } from '@modules/orcamento/services/orcamento-service.js';

describe('renderLicitacoesList', () => {
  test('monta titulo e carrega a lista do ano atual', async () => {
    const container = document.createElement('div');
    const cleanup = await renderLicitacoesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getLicitacoes).toHaveBeenCalledWith(
      expect.objectContaining({ ano: new Date().getFullYear() }),
    );
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // A ORDEM DO DINHEIRO. `valor_total_estimado` é NUMERIC(15,2)
  // (er/orcamento.sql:99) e o driver o entrega como STRING para não perder
  // centavo. Sem `sortValue`, o comparador cai no `localeCompare` de texto e
  // '900.00' passa à frente de '1000.00'.
  //
  // CONTROLE NEGATIVO: os três valores foram escolhidos para que a ordem por
  // texto e a ordem por número DISCORDEM. Com os valores errados, a asserção
  // passaria com o defeito no lugar.
  test('ordena o valor estimado como NÚMERO, e não como texto', async () => {
    getLicitacoes.mockResolvedValueOnce([
      { id: 1, objeto: 'Meio', valor_total_estimado: '900.00' },
      { id: 2, objeto: 'Maior', valor_total_estimado: '1000.00' },
      { id: 3, objeto: 'Menor', valor_total_estimado: '80.00' },
    ]);

    const container = document.createElement('div');
    const cleanup = await renderLicitacoesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const cabecalhos = [...container.querySelectorAll('th')];
    const th = cabecalhos.find((c) => c.textContent.includes('Estimado'));
    expect(th).not.toBeUndefined();
    th.click();

    const objetos = [...container.querySelectorAll('tbody tr td:nth-child(2)')]
      .map((td) => td.textContent);
    // Crescente por NÚMERO: 80 < 900 < 1000. Por texto seria '1000.00' primeiro.
    expect(objetos).toEqual(['Menor', 'Meio', 'Maior']);

    if (typeof cleanup === 'function') cleanup();
  });

  // Falha da API NÃO é lista vazia. "Nenhuma licitação cadastrada" é uma
  // afirmação sobre o banco; a rota que não respondeu não autoriza nenhuma.
  test('falha da carga mostra o erro, e não o estado vazio', async () => {
    getLicitacoes.mockRejectedValueOnce(new Error('Erro ao consultar as licitações'));

    const container = document.createElement('div');
    const cleanup = await renderLicitacoesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).not.toContain('Nenhuma licitação cadastrada');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('Erro ao consultar as licitações');

    const tentar = [...container.querySelectorAll('button')]
      .find((b) => /Tentar de novo/i.test(b.textContent));
    expect(tentar).not.toBeUndefined();

    // O retry devolve a tabela e refaz a consulta.
    getLicitacoes.mockResolvedValueOnce([{ id: 7, objeto: 'Plotter' }]);
    tentar.click();
    await flush();

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Plotter');

    if (typeof cleanup === 'function') cleanup();
  });
});
