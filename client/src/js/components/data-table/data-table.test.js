import { describe, test, expect } from 'vitest';
import { createDataTable } from './data-table.js';

const columns = [
  { key: 'nome', label: 'Nome' },
  { key: 'valor', label: 'Valor', sortable: true },
];

describe('createDataTable', () => {
  test('renderiza uma linha por row no tbody', () => {
    const { element } = createDataTable({
      columns,
      rows: [
        { nome: 'Alfa', valor: 10 },
        { nome: 'Beta', valor: 20 },
        { nome: 'Gama', valor: 30 },
      ],
    });

    expect(element.classList.contains('data-table-wrapper')).toBe(true);
    expect(element.querySelectorAll('tbody tr').length).toBe(3);
  });

  test('update({ rows: [] }) mostra o emptyMessage', () => {
    const { element, update } = createDataTable({
      columns,
      rows: [{ nome: 'Alfa', valor: 10 }],
      emptyMessage: 'Nada por aqui',
    });

    expect(element.querySelectorAll('tbody tr').length).toBe(1);

    update({ rows: [] });

    expect(element.querySelectorAll('tbody tr').length).toBe(0);
    const empty = element.querySelector('.data-table__empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toBe('Nada por aqui');
  });
});

// As três opções que entraram em 2026-07-31, para as listas de empenho e de RPNP
// abrirem pelo maior saldo a liquidar e marcarem o que já fechou.
describe('createDataTable: ordem inicial, sortValue e classe de linha', () => {
  const nomes = (element) =>
    [...element.querySelectorAll('tbody tr td:first-child')].map(td => td.textContent);

  test('defaultSort ordena antes de qualquer clique', () => {
    const { element } = createDataTable({
      columns,
      rows: [
        { nome: 'Alfa', valor: 10 },
        { nome: 'Beta', valor: 30 },
        { nome: 'Gama', valor: 20 },
      ],
      defaultSort: { key: 'valor', dir: 'desc' },
    });

    expect(nomes(element)).toEqual(['Beta', 'Gama', 'Alfa']);
  });

  // O caso real: NUMERIC do PostgreSQL chega como STRING no JSON. Comparada como
  // texto, '900.00' viria antes de '1000.00' e a lista abriria na ordem errada.
  test('sortValue ordena valor monetário que chega como string', () => {
    const colunasMoeda = [
      { key: 'nome', label: 'Nome' },
      {
        key: 'saldo',
        label: 'Saldo',
        sortable: true,
        sortValue: (row) => Number(row.saldo),
      },
    ];

    const { element } = createDataTable({
      columns: colunasMoeda,
      rows: [
        { nome: 'Alfa', saldo: '900.00' },
        { nome: 'Beta', saldo: '1000.00' },
        { nome: 'Gama', saldo: '80.00' },
      ],
      defaultSort: { key: 'saldo', dir: 'desc' },
    });

    expect(nomes(element)).toEqual(['Beta', 'Alfa', 'Gama']);
  });

  test('nulo vai para o fim, mesmo na ordem decrescente', () => {
    const { element } = createDataTable({
      columns,
      rows: [
        { nome: 'Alfa', valor: null },
        { nome: 'Beta', valor: 30 },
        { nome: 'Gama', valor: 20 },
      ],
      defaultSort: { key: 'valor', dir: 'desc' },
    });

    expect(nomes(element)).toEqual(['Beta', 'Gama', 'Alfa']);
  });

  test('rowClassName marca a linha, sem apagar a marca de selecionada', () => {
    const { element } = createDataTable({
      columns,
      rows: [
        { nome: 'Alfa', valor: 0 },
        { nome: 'Beta', valor: 30 },
      ],
      rowClassName: (row) => (row.valor <= 0 ? 'data-table__row--quitada' : ''),
    });

    const linhas = [...element.querySelectorAll('tbody tr')];
    expect(linhas[0].className).toContain('data-table__row--quitada');
    expect(linhas[1].className).not.toContain('data-table__row--quitada');
  });
});
