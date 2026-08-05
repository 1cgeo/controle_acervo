import { describe, test, expect, afterEach } from 'vitest';
import { createDataTable } from './data-table.js';

// Acessibilidade do data-table: ordenar pelo TECLADO, e anunciar o que muda
// sozinho (lista vazia, recarga em curso).
//
// O defeito que estes testes prendem: o cabecalho ordenavel tinha `onClick` num
// `<th>` e mais nada. Ele anunciava `aria-sort` e nao havia como aciona-lo sem
// mouse -- nem foco, nem Enter, nem barra de espaco.

const columns = [
  { key: 'nome', label: 'Nome', sortable: true },
  { key: 'valor', label: 'Valor' },
];

const linhas = [
  { id: 1, nome: 'Charlie', valor: 3 },
  { id: 2, nome: 'Alfa', valor: 1 },
  { id: 3, nome: 'Bravo', valor: 2 },
];

function montar(opcoes) {
  const tabela = createDataTable(opcoes);
  document.body.appendChild(tabela.element);
  return tabela;
}

const nomes = (element) =>
  [...element.querySelectorAll('tbody tr td:first-child')].map(td => td.textContent);

const cabecalhoOrdenavel = (element) =>
  element.querySelector('th.data-table__th--sortable');

function teclar(no, key) {
  const evento = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  no.dispatchEvent(evento);
  return evento;
}

afterEach(() => {
  document.body.textContent = '';
});

describe('data-table: ordenar pelo teclado', () => {
  test('o cabecalho ordenavel entra na ordem de tabulacao', () => {
    const { element } = montar({ columns, rows: linhas });
    expect(cabecalhoOrdenavel(element).getAttribute('tabindex')).toBe('0');
  });

  // CONTROLE NEGATIVO: a coluna NAO ordenavel nao pode ganhar foco. Sem esta
  // metade, um `tabindex` posto em todo `<th>` passaria no teste de cima.
  test('o cabecalho comum NAO entra na ordem de tabulacao', () => {
    const { element } = montar({ columns, rows: linhas });
    const comuns = [...element.querySelectorAll('th')]
      .filter(th => !th.classList.contains('data-table__th--sortable'));
    expect(comuns.length).toBeGreaterThan(0);
    for (const th of comuns) expect(th.hasAttribute('tabindex')).toBe(false);
  });

  test('Enter ordena, e o segundo Enter inverte', () => {
    const { element } = montar({ columns, rows: linhas });
    expect(nomes(element)).toEqual(['Charlie', 'Alfa', 'Bravo']);

    teclar(cabecalhoOrdenavel(element), 'Enter');
    expect(nomes(element)).toEqual(['Alfa', 'Bravo', 'Charlie']);
    expect(cabecalhoOrdenavel(element).getAttribute('aria-sort')).toBe('ascending');

    teclar(cabecalhoOrdenavel(element), 'Enter');
    expect(nomes(element)).toEqual(['Charlie', 'Bravo', 'Alfa']);
    expect(cabecalhoOrdenavel(element).getAttribute('aria-sort')).toBe('descending');
  });

  test('a barra de espaco ordena e NAO deixa a pagina rolar', () => {
    const { element } = montar({ columns, rows: linhas });
    const evento = teclar(cabecalhoOrdenavel(element), ' ');
    expect(nomes(element)).toEqual(['Alfa', 'Bravo', 'Charlie']);
    expect(evento.defaultPrevented).toBe(true);
  });

  // CONTROLE NEGATIVO: so Enter e Espaco ordenam. Uma tecla qualquer nao pode
  // mexer na tabela, senao digitar em qualquer lugar reordenaria a lista.
  test('outra tecla nao ordena nem consome o evento', () => {
    const { element } = montar({ columns, rows: linhas });
    const evento = teclar(cabecalhoOrdenavel(element), 'a');
    expect(nomes(element)).toEqual(['Charlie', 'Alfa', 'Bravo']);
    expect(evento.defaultPrevented).toBe(false);
  });
});

describe('data-table: o que muda sozinho e anunciado', () => {
  test('a lista vazia sai como role="status"', () => {
    const { element } = montar({ columns, rows: [], emptyMessage: 'Sem nada aqui' });
    const vazio = element.querySelector('.data-table__empty');
    expect(vazio.getAttribute('role')).toBe('status');
    expect(vazio.textContent).toBe('Sem nada aqui');
  });

  test('recarga em curso marca aria-busy, e o fim dela retira a marca', () => {
    const tabela = montar({ columns, rows: linhas });
    // CONTROLE NEGATIVO: a tabela pronta nao pode nascer marcada.
    expect(tabela.element.hasAttribute('aria-busy')).toBe(false);

    tabela.update({ loading: true });
    expect(tabela.element.getAttribute('aria-busy')).toBe('true');

    tabela.update({ rows: linhas, loading: false });
    expect(tabela.element.hasAttribute('aria-busy')).toBe(false);
  });
});
