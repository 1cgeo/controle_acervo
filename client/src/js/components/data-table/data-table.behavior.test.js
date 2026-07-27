import { describe, test, expect } from 'vitest';
import { createDataTable } from './data-table.js';

// Testes de COMPORTAMENTO do data-table: busca (com normalizacao de acento),
// ordenacao por clique no header sortable e paginacao (pageSize + navegacao).
// Complementam o data-table.test.js (que cobre render basico e empty state).

const columns = [
  { key: 'nome', label: 'Nome', sortable: true },
  { key: 'valor', label: 'Valor', sortable: true },
];

// Gera N linhas { nome: 'Item NN', valor: N }.
function gerarLinhas(n) {
  return Array.from({ length: n }, (_, i) => ({
    nome: `Item ${String(i + 1).padStart(2, '0')}`,
    valor: i + 1,
  }));
}

// Texto visivel das celulas da primeira coluna (nome) na pagina atual.
function nomesVisiveis(element) {
  return Array.from(element.querySelectorAll('tbody tr td:first-child')).map(
    td => td.textContent
  );
}

function digitarBusca(element, texto) {
  const input = element.querySelector('.data-table-toolbar__search-input');
  input.value = texto;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}

describe('data-table: busca', () => {
  test('filtra as linhas pelo texto digitado', () => {
    const { element } = createDataTable({
      columns,
      searchable: true,
      rows: [
        { nome: 'Alfa', valor: 10 },
        { nome: 'Beta', valor: 20 },
        { nome: 'Gama', valor: 30 },
      ],
    });

    digitarBusca(element, 'bet');

    const tr = element.querySelectorAll('tbody tr');
    expect(tr.length).toBe(1);
    expect(tr[0].textContent).toContain('Beta');
  });

  test('a busca ignora acentos (normalizacao NFD)', () => {
    const { element } = createDataTable({
      columns,
      searchable: true,
      rows: [
        { nome: 'Manutenção', valor: 1 },
        { nome: 'Aquisição', valor: 2 },
        { nome: 'Servico', valor: 3 },
      ],
    });

    // termo sem acento deve casar com "Manutenção"
    digitarBusca(element, 'manutencao');
    let linhas = nomesVisiveis(element);
    expect(linhas).toEqual(['Manutenção']);

    // e o inverso: termo com acento casa com texto sem acento
    digitarBusca(element, 'serviço');
    linhas = nomesVisiveis(element);
    expect(linhas).toEqual(['Servico']);
  });

  test('busca sem resultado mostra a mensagem dedicada', () => {
    const { element } = createDataTable({
      columns,
      searchable: true,
      rows: [{ nome: 'Alfa', valor: 1 }],
    });

    digitarBusca(element, 'zzz');

    expect(element.querySelectorAll('tbody tr').length).toBe(0);
    const empty = element.querySelector('.data-table__empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toBe('Nenhum resultado para a busca');
  });
});

describe('data-table: ordenacao', () => {
  test('clique no header sortable ordena ascendente, segundo clique inverte', () => {
    const { element } = createDataTable({
      columns,
      rows: [
        { nome: 'Gama', valor: 30 },
        { nome: 'Alfa', valor: 10 },
        { nome: 'Beta', valor: 20 },
      ],
    });

    // header de "Valor" (segunda coluna sortable). A tabela e reconstruida a
    // cada render, entao re-consultamos o header apos cada clique (o no antigo
    // fica desanexado e seu aria-sort nao reflete o estado novo).
    const headerValor = () =>
      element.querySelectorAll('.data-table__th--sortable')[1];

    // 1o clique: ascendente por valor -> 10, 20, 30 (nomes Alfa, Beta, Gama)
    headerValor().click();
    expect(nomesVisiveis(element)).toEqual(['Alfa', 'Beta', 'Gama']);
    expect(headerValor().getAttribute('aria-sort')).toBe('ascending');

    // 2o clique: descendente -> 30, 20, 10 (Gama, Beta, Alfa)
    headerValor().click();
    expect(nomesVisiveis(element)).toEqual(['Gama', 'Beta', 'Alfa']);
    expect(headerValor().getAttribute('aria-sort')).toBe('descending');
  });

  test('ordena texto com localeCompare pt-BR (numerico)', () => {
    const { element } = createDataTable({
      columns,
      rows: [
        { nome: 'Item 10', valor: 1 },
        { nome: 'Item 2', valor: 2 },
        { nome: 'Item 1', valor: 3 },
      ],
    });

    const headerNome = element.querySelectorAll('.data-table__th--sortable')[0];
    headerNome.click();

    // numeric:true => "Item 1" < "Item 2" < "Item 10"
    expect(nomesVisiveis(element)).toEqual(['Item 1', 'Item 2', 'Item 10']);
  });
});

describe('data-table: acoes', () => {
  test('action.visible(row) oculta o botao nas linhas que nao o suportam', () => {
    const { element } = createDataTable({
      columns,
      rows: [
        { nome: 'Com anexo', valor: 1, temAnexo: true },
        { nome: 'Sem anexo', valor: 2, temAnexo: false },
      ],
      actions: [
        {
          icon: 'M0 0',
          title: 'Baixar',
          visible: (row) => row.temAnexo === true,
          onClick: () => {},
        },
        { icon: 'M0 0', title: 'Editar', onClick: () => {} },
      ],
    });

    const linhas = element.querySelectorAll('tbody tr');
    // Linha com anexo: 2 acoes (baixar + editar)
    expect(linhas[0].querySelectorAll('.data-table__action-btn').length).toBe(2);
    expect(linhas[0].querySelector('[title="Baixar"]')).not.toBeNull();
    // Linha sem anexo: so editar (baixar oculto)
    expect(linhas[1].querySelectorAll('.data-table__action-btn').length).toBe(1);
    expect(linhas[1].querySelector('[title="Baixar"]')).toBeNull();
  });
});

describe('data-table: paginacao', () => {
  test('respeita o pageSize: so mostra a primeira pagina', () => {
    const { element } = createDataTable({
      columns,
      rows: gerarLinhas(12),
      pageSize: 5,
    });

    expect(element.querySelectorAll('tbody tr').length).toBe(5);
    expect(nomesVisiveis(element)[0]).toBe('Item 01');
    // info de paginacao: "1-5 de 12"
    const info = element.querySelector('.pagination__info span');
    expect(info.textContent).toBe('1-5 de 12');
  });

  test('navega para a proxima pagina e volta', () => {
    const { element } = createDataTable({
      columns,
      rows: gerarLinhas(12),
      pageSize: 5,
    });

    const proxima = element.querySelector('[aria-label="Próxima página"]');
    const anterior = element.querySelector('[aria-label="Página anterior"]');

    // na primeira pagina o "anterior" esta desabilitado
    expect(anterior.disabled).toBe(true);

    proxima.click();
    // segunda pagina: itens 06..10
    expect(nomesVisiveis(element)).toEqual([
      'Item 06', 'Item 07', 'Item 08', 'Item 09', 'Item 10',
    ]);
    expect(element.querySelector('.pagination__info span').textContent).toBe('6-10 de 12');

    proxima.click();
    // terceira pagina (parcial): itens 11..12, e "proxima" desabilitada
    expect(nomesVisiveis(element)).toEqual(['Item 11', 'Item 12']);
    const proximaAgora = element.querySelector('[aria-label="Próxima página"]');
    expect(proximaAgora.disabled).toBe(true);

    // volta uma pagina
    const anteriorAgora = element.querySelector('[aria-label="Página anterior"]');
    anteriorAgora.click();
    expect(element.querySelector('.pagination__info span').textContent).toBe('6-10 de 12');
  });

  test('trocar o pageSize via select reconstroi a pagina', () => {
    const { element } = createDataTable({
      columns,
      rows: gerarLinhas(12),
      pageSize: 5,
    });

    const select = element.querySelector('.pagination__select');
    select.value = '10';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(element.querySelectorAll('tbody tr').length).toBe(10);
    expect(element.querySelector('.pagination__info span').textContent).toBe('1-10 de 12');
  });

  test('nao renderiza paginacao quando total <= 5 (menor pageSize)', () => {
    const { element } = createDataTable({
      columns,
      rows: gerarLinhas(4),
      pageSize: 5,
    });

    expect(element.querySelectorAll('tbody tr').length).toBe(4);
    // pagination vazia: sem info nem controles
    expect(element.querySelector('.pagination__info')).toBeNull();
    expect(element.querySelector('.pagination__controls')).toBeNull();
  });

  test('busca reseta para a primeira pagina', () => {
    const { element } = createDataTable({
      columns,
      searchable: true,
      rows: gerarLinhas(12),
      pageSize: 5,
    });

    // vai para a segunda pagina
    element.querySelector('[aria-label="Próxima página"]').click();
    expect(element.querySelector('.pagination__info span').textContent).toBe('6-10 de 12');

    // uma busca que casa com varias linhas (todas tem "Item") volta para pagina 1
    digitarBusca(element, 'Item');
    expect(element.querySelector('.pagination__info span').textContent).toBe('1-5 de 12');
  });
});
