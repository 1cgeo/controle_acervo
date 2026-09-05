import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Smoke test da pagina de Notas de Empenho. Mocka o service (lista + dialog).
// A tela tem o proprio filtro de ano e abre no ano ATUAL: nao ha mais ano global
// nem nada guardado no localStorage.
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

const confirmDialog = vi.hoisted(() => vi.fn(() => Promise.resolve(false)));
vi.mock('@components/modal/confirm-dialog.js', () => ({ confirmDialog }));

import { renderNotasEmpenhoList } from '@modules/orcamento/pages/notas-empenho/list.js';
import { getNotasEmpenho } from '@modules/orcamento/services/orcamento-service.js';
import { logarComo, GERENTE } from '@/__tests__/helpers/sessao.js';

const ANO_ATUAL = new Date().getFullYear();

describe('renderNotasEmpenhoList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // O ano é de cada tela e começa no ano ATUAL.
  test('abre no ano atual e pede a lista desse ano', async () => {
    const container = document.createElement('div');
    const cleanup = await renderNotasEmpenhoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const filtro = container.querySelector('.page__filters select');
    expect(filtro.value).toBe(String(ANO_ATUAL));
    expect(getNotasEmpenho.mock.calls.at(-1)[0].ano).toBe(ANO_ATUAL);

    if (typeof cleanup === 'function') cleanup();
  });

  test('monta titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderNotasEmpenhoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getNotasEmpenho).toHaveBeenCalled();
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // As 100% liquidadas vão para o fim e ficam visualmente distintas. A ordem é
  // pelo saldo a liquidar, que a tela CALCULA (empenhado menos anulado menos
  // liquidado); o backend não devolve essa coluna.
  test('ordena pelo saldo a liquidar e joga a 100% liquidada para o fim', async () => {
    getNotasEmpenho.mockResolvedValueOnce([
      // Liquidada por inteiro: some do topo e ganha a marca.
      { id: 1, numero: 'NE quitada', ano: 2026, valor_empenhado: '5000.00', valor_anulado: '0.00', total_liquidado: '5000.00' },
      { id: 2, numero: 'NE 900', ano: 2026, valor_empenhado: '1000.00', valor_anulado: '0.00', total_liquidado: '100.00' },
      { id: 3, numero: 'NE 2000', ano: 2026, valor_empenhado: '2000.00', valor_anulado: '0.00', total_liquidado: '0.00' },
      // Anulada por inteiro: nada mais a liquidar, mesmo sem liquidação nenhuma.
      { id: 4, numero: 'NE anulada', ano: 2026, valor_empenhado: '800.00', valor_anulado: '800.00', total_liquidado: '0.00' },
    ]);

    const container = document.createElement('div');
    const cleanup = await renderNotasEmpenhoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const linhas = [...container.querySelectorAll('tbody tr')];
    const numeros = linhas.map(tr => tr.querySelector('td').textContent);
    expect(numeros.slice(0, 2)).toEqual(['NE 2000', 'NE 900']);
    expect(numeros.slice(2)).toEqual(expect.arrayContaining(['NE quitada', 'NE anulada']));

    expect(linhas[0].className).not.toContain('data-table__row--quitada');
    expect(linhas[2].className).toContain('data-table__row--quitada');
    expect(linhas[3].className).toContain('data-table__row--quitada');

    // A coluna "A liquidar" troca o valor por um chip nas que já fecharam.
    expect(container.textContent).toContain('Liquidada');

    if (typeof cleanup === 'function') cleanup();
  });
  // A FINALIDADE E TEXT SEM LIMITE, e entrava INTEIRA no rotulo da confirmacao.
  // A coluna da tabela ja corta por CSS; a caixa de confirmacao, nao. Uma
  // finalidade de duzentos caracteres empurrava o botao "Excluir" para baixo da
  // dobra do modal em tela estreita, e a frase que importa ficava atras do texto
  // colado.
  test('a confirmação de exclusão corta a finalidade, e não vira um parágrafo', async () => {
    logarComo({ orcamento: GERENTE });
    const finalidade = 'Aquisição de suprimentos de impressão para a Divisão '.repeat(6);
    getNotasEmpenho.mockResolvedValueOnce([
      { id: 1, numero: '2026NE000024', ano: 2026, nota_credito_numero: '2026NC400136',
        finalidade, valor_empenhado: '1000.00', valor_anulado: '0.00', total_liquidado: '0.00' },
    ]);

    const container = document.createElement('div');
    const cleanup = await renderNotasEmpenhoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    container.querySelector('tbody tr .data-table__action-btn--danger').click();
    await flush();

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    const mensagem = confirmDialog.mock.calls[0][0].message;
    // O que identifica a NE continua la, e o texto longo entra cortado.
    expect(mensagem).toContain('2026NE000024');
    expect(mensagem).toContain('2026NC400136');
    expect(mensagem).toContain('…');
    expect(mensagem).not.toContain(finalidade);
    expect(mensagem.indexOf('Esta ação não pode')).toBeLessThan(200);

    if (typeof cleanup === 'function') cleanup();
  });
});
