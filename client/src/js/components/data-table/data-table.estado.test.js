import { describe, test, expect, afterEach } from 'vitest';
import { createDataTable } from './data-table.js';

// Testes do ESTADO que sobrevive a uma recarga: pagina atual, selecao, altura
// do container e identidade dos nos do <tbody>. Complementam o
// data-table.test.js (render e vazio) e o data-table.behavior.test.js (busca,
// ordem e paginacao).
//
// O caso real que os motivou (medido em 2026-08-04): gravar a 40a pessoa de uma
// lista de 54 jogava quem edita de volta para a pagina 1, e o esqueleto de 5
// linhas fixas encolhia a tela em ~840 px e a devolvia em seguida.

const columns = [
  { key: 'nome', label: 'Nome', sortable: true },
  { key: 'valor', label: 'Valor', sortable: true },
];

function gerarLinhas(n, sufixo = '') {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    nome: `Item ${String(i + 1).padStart(2, '0')}${sufixo}`,
    valor: i + 1,
  }));
}

const nomesVisiveis = (element) =>
  [...element.querySelectorAll('tbody tr td:first-child')].map(td => td.textContent);

const linhas = (element) => element.querySelectorAll('tbody tr');
const info = (element) => element.querySelector('.pagination__info span').textContent;

function montar(opcoes) {
  const tabela = createDataTable(opcoes);
  document.body.appendChild(tabela.element);
  return tabela;
}

afterEach(() => {
  document.body.textContent = '';
});

describe('data-table: a pagina atual sobrevive ao update', () => {
  test('update com a mesma lista mantem a pagina em que a tela estava', () => {
    const { element, update } = montar({ columns, rows: gerarLinhas(12), pageSize: 5 });

    element.querySelector('[aria-label="Próxima página"]').click();
    expect(nomesVisiveis(element)[0]).toBe('Item 06');

    // O servidor devolve objetos NOVOS depois de gravar.
    update({ rows: gerarLinhas(12) });

    expect(nomesVisiveis(element)[0]).toBe('Item 06');
    expect(info(element)).toBe('6-10 de 12');
  });

  test('a pagina cai para a ultima valida quando a lista encolhe', () => {
    const { element, update } = montar({ columns, rows: gerarLinhas(12), pageSize: 5 });

    const proxima = () => element.querySelector('[aria-label="Próxima página"]');
    proxima().click();
    proxima().click();
    expect(nomesVisiveis(element)).toEqual(['Item 11', 'Item 12']);

    update({ rows: gerarLinhas(6) });

    // 6 linhas em paginas de 5 tem 2 paginas: a terceira deixou de existir.
    expect(nomesVisiveis(element)).toEqual(['Item 06']);
    expect(info(element)).toBe('6-6 de 6');
  });

  test('a lista vazia devolve a tela para a primeira pagina', () => {
    const { element, update } = montar({ columns, rows: gerarLinhas(12), pageSize: 5 });

    element.querySelector('[aria-label="Próxima página"]').click();
    update({ rows: [] });
    update({ rows: gerarLinhas(12) });

    expect(nomesVisiveis(element)[0]).toBe('Item 01');
  });
});

describe('data-table: a selecao sobrevive por identidade de linha', () => {
  test('row.id casa a selecao com os objetos novos do servidor', () => {
    const avisos = [];
    const { element, update, getSelected } = montar({
      columns,
      rows: gerarLinhas(4),
      selectable: true,
      onSelectionChange: (sel) => avisos.push(sel.length),
    });

    const caixas = () => [...element.querySelectorAll('tbody .data-table__checkbox')];
    caixas()[1].click();
    expect(getSelected().map(r => r.id)).toEqual([2]);

    update({ rows: gerarLinhas(4, ' v2') });

    expect(getSelected().map(r => r.id)).toEqual([2]);
    // O objeto devolvido e o NOVO, nunca o que ficou para tras.
    expect(getSelected()[0].nome).toBe('Item 02 v2');
    expect(caixas()[1].checked).toBe(true);
    expect(avisos[avisos.length - 1]).toBe(1);
  });

  test('a linha que sumiu da lista sai da selecao', () => {
    const { element, update, getSelected } = montar({
      columns,
      rows: gerarLinhas(4),
      selectable: true,
    });

    [...element.querySelectorAll('tbody .data-table__checkbox')][3].click();
    expect(getSelected().map(r => r.id)).toEqual([4]);

    update({ rows: gerarLinhas(2) });

    expect(getSelected()).toEqual([]);
  });

  test('rowKey manda quando a linha nao tem id nem uuid', () => {
    const colunas = [{ key: 'codigo', label: 'Código' }];
    const { element, update, getSelected } = montar({
      columns: colunas,
      rows: [{ codigo: 'A' }, { codigo: 'B' }],
      rowKey: (row) => row.codigo,
      selectable: true,
    });

    [...element.querySelectorAll('tbody .data-table__checkbox')][1].click();
    update({ rows: [{ codigo: 'A' }, { codigo: 'B' }] });

    expect(getSelected().map(r => r.codigo)).toEqual(['B']);
  });

  test('clearSelection continua zerando a selecao', () => {
    const { element, clearSelection, getSelected } = montar({
      columns,
      rows: gerarLinhas(3),
      selectable: true,
    });

    [...element.querySelectorAll('tbody .data-table__checkbox')][0].click();
    expect(getSelected().length).toBe(1);

    clearSelection();

    expect(getSelected()).toEqual([]);
  });
});

describe('data-table: recarga silenciosa', () => {
  test('loading com linhas montadas nao troca as linhas por esqueleto', () => {
    const { element, update } = montar({ columns, rows: gerarLinhas(12), pageSize: 25 });
    expect(linhas(element).length).toBe(12);

    update({ loading: true });

    expect(linhas(element).length).toBe(12);
    expect(element.querySelector('.skeleton')).toBeNull();
    expect(nomesVisiveis(element)[0]).toBe('Item 01');
  });

  test('a recarga silenciosa se anuncia por classe, e a classe sai no fim', () => {
    const { element, update } = montar({ columns, rows: gerarLinhas(12), pageSize: 25 });

    update({ loading: true });
    expect(element.classList.contains('data-table-wrapper--recarregando')).toBe(true);

    update({ rows: gerarLinhas(12), loading: false });
    expect(element.classList.contains('data-table-wrapper--recarregando')).toBe(false);
  });
});

describe('data-table: o esqueleto nao colapsa o container', () => {
  test('o esqueleto da primeira carga tem o tamanho do pageSize, nao 5 linhas', () => {
    const { element } = montar({ columns, rows: [], pageSize: 25, loading: true });

    expect(linhas(element).length).toBe(25);
  });

  test('o esqueleto cobre tambem a coluna de selecao e a de acoes', () => {
    const { element } = montar({
      columns,
      rows: [],
      pageSize: 5,
      loading: true,
      selectable: true,
      actions: [{ icon: 'M0 0', title: 'Editar', onClick: () => {} }],
    });

    const colunasNoEsqueleto = element.querySelectorAll('thead th').length;
    expect(colunasNoEsqueleto).toBe(columns.length + 2);
    expect(linhas(element)[0].querySelectorAll('td').length).toBe(colunasNoEsqueleto);
  });

  test('o esqueleto reserva a altura que a tabela tinha, e a solta depois', () => {
    const { element, update } = montar({ columns, rows: gerarLinhas(25), pageSize: 25 });
    const scroll = element.querySelector('.data-table-scroll');
    // O jsdom nao faz layout: o offsetHeight vem do stub, no lugar da medida real.
    Object.defineProperty(scroll, 'offsetHeight', { configurable: true, value: 900 });

    update({ rows: [], loading: true });

    expect(scroll.classList.contains('data-table-scroll--carregando')).toBe(true);
    expect(scroll.style.getPropertyValue('--data-table-altura-reservada')).toBe('900px');

    update({ rows: gerarLinhas(25), loading: false });

    expect(scroll.classList.contains('data-table-scroll--carregando')).toBe(false);
    expect(scroll.style.getPropertyValue('--data-table-altura-reservada')).toBe('');
  });

  test('o esqueleto repete o numero de linhas que a tabela mostrava', () => {
    const { element, update } = montar({ columns, rows: gerarLinhas(7), pageSize: 25 });
    expect(linhas(element).length).toBe(7);

    update({ rows: [], loading: true });

    expect(linhas(element).length).toBe(7);
    expect(element.querySelectorAll('.skeleton').length).toBe(7 * columns.length);
  });
});

describe('data-table: o corpo se reconcilia, e o foco fica', () => {
  test('a linha de mesma chave mantem o mesmo <tr> e recebe o dado novo', () => {
    const { element, update } = montar({ columns, rows: gerarLinhas(3), pageSize: 25 });
    const antes = [...linhas(element)];

    update({ rows: gerarLinhas(3, ' v2') });

    expect([...linhas(element)]).toEqual(antes);
    expect(nomesVisiveis(element)).toEqual(['Item 01 v2', 'Item 02 v2', 'Item 03 v2']);
  });

  test('o botao de acao focado continua focado depois da recarga', () => {
    const { element, update } = montar({
      columns,
      rows: gerarLinhas(3),
      pageSize: 25,
      actions: [{ icon: 'M0 0', title: 'Editar', onClick: () => {} }],
    });

    const botao = linhas(element)[1].querySelector('.data-table__action-btn');
    botao.focus();
    expect(document.activeElement).toBe(botao);

    update({ rows: gerarLinhas(3, ' v2') });

    expect(document.activeElement).toBe(botao);
  });

  test('a acao reaproveitada dispara com a linha NOVA, nunca com a velha', () => {
    const recebidas = [];
    const { element, update } = montar({
      columns,
      rows: gerarLinhas(2),
      pageSize: 25,
      actions: [{ icon: 'M0 0', title: 'Editar', onClick: (row) => recebidas.push(row.nome) }],
    });

    update({ rows: gerarLinhas(2, ' v2') });
    linhas(element)[0].querySelector('.data-table__action-btn').click();

    expect(recebidas).toEqual(['Item 01 v2']);
  });

  test('a linha que sai da pagina some do corpo', () => {
    const { element, update } = montar({ columns, rows: gerarLinhas(3), pageSize: 25 });

    update({ rows: gerarLinhas(2) });

    expect(nomesVisiveis(element)).toEqual(['Item 01', 'Item 02']);
  });
});
