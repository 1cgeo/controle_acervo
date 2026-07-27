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
