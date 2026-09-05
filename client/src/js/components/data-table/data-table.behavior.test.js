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

  // OS DOIS NULOS EMPATAM.
  //
  // O comparador mandava nulo para o fim devolvendo 1, e com os DOIS nulos
  // devolvia 1 nas duas direcoes (`cmp(a,b) === cmp(b,a) === 1`), o que quebra a
  // antissimetria que o `Array.prototype.sort` exige: com comparador
  // inconsistente, quem escolhe a ordem e a implementacao, e nao o codigo.
  //
  // HONESTIDADE SOBRE O QUE ESTE CASO PROVA: ele passa com o comparador VELHO
  // tambem. O TimSort do V8 hoje deixa os nulos na ordem de entrada assim
  // mesmo, e foi sondado de 4 a 60 linhas, com os nulos no fim e intercalados,
  // sem uma divergencia. O empate nao conserta um sintoma visivel: ele troca um
  // acerto de sorte por uma GARANTIA, e este caso e quem guarda a garantia se o
  // motor mudar ou se alguem reescrever o comparador.
  test('as linhas sem valor vao para o fim NA ORDEM DE ENTRADA, nas duas direcoes', () => {
    const linhas = [
      { nome: 'Sem valor A', valor: null },
      { nome: 'Com valor', valor: 5 },
      { nome: 'Sem valor B', valor: undefined },
      { nome: 'Sem valor C', valor: null },
    ];

    const { element } = createDataTable({ columns, rows: linhas });
    const headerValor = () => element.querySelectorAll('.data-table__th--sortable')[1];

    headerValor().click();
    expect(nomesVisiveis(element)).toEqual([
      'Com valor', 'Sem valor A', 'Sem valor B', 'Sem valor C',
    ]);

    // A DIRECAO INVERTE o que tem valor, e nao a ordem entre os nulos: eles nao
    // respondem ao criterio, entao nao ha o que inverter entre eles.
    headerValor().click();
    expect(nomesVisiveis(element)).toEqual([
      'Com valor', 'Sem valor A', 'Sem valor B', 'Sem valor C',
    ]);
  });

  // A REGUA DO `sortValue`, e nao um defeito a consertar aqui.
  //
  // O ramo de texto usa `localeCompare(..., { numeric: true })`, que le "1.5" e
  // "1.25" como o par de numeros (1, 5) e (1, 25) e conclui que 1.5 < 1.25.
  // Para INTEIRO, texto e data ISO -- que e o que a casa tem -- `numeric: true`
  // e justamente o certo, e por isso o comparador nao muda.
  //
  // A convencao que cobre o decimal e OUTRA: toda coluna de valor decimal
  // declara `sortValue` devolvendo NUMERO (com `toNumber` de `utils/format.js`),
  // e o ramo `typeof va === 'number'` a pega antes do `localeCompare`. Hoje as
  // 25 colunas de dinheiro do orcamento e do equipamento cumprem isso, uma a
  // uma. Este caso existe para que a proxima coluna de dinheiro que nascer sem
  // `sortValue` seja descoberta aqui, e nao numa lista de empenhos.
  test('decimal como TEXTO sai na ordem errada: coluna decimal declara sortValue', () => {
    const semSortValue = [{ key: 'preco', label: 'Preço', sortable: true }];
    const { element } = createDataTable({
      columns: semSortValue,
      // Como o driver entrega `NUMERIC`: texto, e nao numero.
      rows: [{ preco: '1.5' }, { preco: '1.25' }],
    });

    element.querySelector('.data-table__th--sortable').click();

    const precos = Array.from(element.querySelectorAll('tbody tr td:first-child'))
      .map(td => td.textContent);
    // ERRADO, e documentado: 1,25 e menor que 1,5.
    expect(precos).toEqual(['1.5', '1.25']);

    // COM `sortValue` devolvendo numero, a mesma coluna ordena certo.
    const comSortValue = [{
      key: 'preco', label: 'Preço', sortable: true, sortValue: (r) => Number(r.preco),
    }];
    const outra = createDataTable({
      columns: comSortValue,
      rows: [{ preco: '1.5' }, { preco: '1.25' }],
    });
    outra.element.querySelector('.data-table__th--sortable').click();

    expect(
      Array.from(outra.element.querySelectorAll('tbody tr td:first-child'))
        .map(td => td.textContent)
    ).toEqual(['1.25', '1.5']);
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
