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

  // O ANO VIAJA NA URL. O link da pendencia do painel e o "Voltar" da ficha
  // levam `?ano=`, e sem isto a lista abria no ano corrente, onde o que se foi
  // buscar nao existe.
  test('`?ano=2025` na URL abre a lista em 2025', async () => {
    const container = document.createElement('div');
    const cleanup = await renderNotasCreditoList(container, {
      params: {},
      query: new URLSearchParams('ano=2025'),
    });
    await flush();

    expect(container.querySelector('.page__filters select').value).toBe('2025');
    expect(getNotasCredito.mock.calls.at(-1)[0].ano).toBe(2025);

    if (typeof cleanup === 'function') cleanup();
  });

  // Ano ilegivel na URL nao pode travar a tela: ela cai no ano atual.
  test('`?ano=` com lixo cai no ano atual', async () => {
    const container = document.createElement('div');
    const cleanup = await renderNotasCreditoList(container, {
      params: {},
      query: new URLSearchParams('ano=nao-e-ano'),
    });
    await flush();

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

  // QUEM PINTA E A ULTIMA PEDIDA, e nao a ultima que chega.
  //
  // Numa rede lenta, ir de 2026 a 2025 e voltar dispara cargas que podem chegar
  // fora de ordem. Sem numero de requisicao, a resposta de 2025 chegando por
  // ultimo pintava as NCs de 2025 com o seletor dizendo 2026 e o cartao-resumo
  // somando os valores de 2025 sob o titulo de 2026. O numero do cartao e
  // dinheiro, e nada na tela acusava.
  test('a resposta que chega ATRASADA não pinta por cima da mais nova', async () => {
    const resolvedores = [];
    // A carga de MONTAGEM responde na hora (a propria `renderNotasCreditoList`
    // a aguarda); as seguintes ficam paradas na mao do teste.
    getNotasCredito.mockResolvedValueOnce([]);
    getNotasCredito.mockImplementation(() => new Promise((resolve) => { resolvedores.push(resolve); }));

    const container = document.createElement('div');
    const cleanup = await renderNotasCreditoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const filtro = container.querySelector('.page__filters select');
    const trocarAno = async (ano) => {
      filtro.value = String(ano);
      filtro.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    };

    await trocarAno(2025);
    await trocarAno(ANO_ATUAL);
    expect(resolvedores).toHaveLength(2);

    // A do ano corrente (a ULTIMA pedida) chega primeiro; a de 2025 chega depois.
    resolvedores[1]([{ id: 2, numero: 'NC-DO-ANO-CORRENTE', ano: ANO_ATUAL, valor_nc: '10.00' }]);
    await flush();
    resolvedores[0]([
      { id: 1, numero: 'NC-DE-2025-A', ano: 2025, valor_nc: '99.00' },
      { id: 3, numero: 'NC-DE-2025-B', ano: 2025, valor_nc: '99.00' },
    ]);
    await flush();

    const linhas = [...container.querySelectorAll('.data-table tbody tr')];
    expect(linhas).toHaveLength(1);
    expect(container.textContent).toContain('NC-DO-ANO-CORRENTE');
    expect(container.textContent).not.toContain('NC-DE-2025-A');

    if (typeof cleanup === 'function') cleanup();
  });
});
