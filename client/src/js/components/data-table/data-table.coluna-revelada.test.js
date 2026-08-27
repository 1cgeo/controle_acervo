import { describe, test, expect } from 'vitest';
import { createDataTable } from './data-table.js';

// A COLUNA QUE SO APARECE QUANDO A BUSCA CASA POR ELA (`revelarNaBusca`), e a
// normalizacao que vale nos dois lados da comparacao (`searchNormalize`).
//
// Arquivo proprio, e nao um bloco novo em data-table.behavior.test.js: as duas
// propriedades sao capacidade nova do componente, e o comportamento antigo
// continua coberto la, sem edicao. As 49 telas que usam createDataTable nao
// declaram nenhuma das duas, entao o caminho delas e o de sempre -- e ha um
// teste aqui que cobra exatamente isso.

const COLUNAS = [
  { key: 'cliente', label: 'Cliente' },
  {
    key: 'cep',
    label: 'CEP',
    revelarNaBusca: true,
    searchNormalize: (texto) => texto.replace(/\D/g, ''),
  },
];

const LINHAS = [
  { id: 1, cliente: '5a Divisao de Exercito', cep: '81150-900' },
  { id: 2, cliente: 'Artilharia Divisionaria', cep: '81150900' },
  { id: 3, cliente: 'Comando Militar do Sul', cep: null },
];

function digitarBusca(element, texto) {
  const input = element.querySelector('.data-table-toolbar__search-input');
  input.value = texto;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const cabecalhos = (element) =>
  Array.from(element.querySelectorAll('thead th')).map((th) => th.textContent.trim());

const linhasVisiveis = (element) => element.querySelectorAll('tbody tr').length;

describe('data-table: coluna revelada na busca', () => {
  test('a coluna nao aparece enquanto ninguem busca', () => {
    const { element } = createDataTable({ columns: COLUNAS, rows: LINHAS, searchable: true });

    expect(cabecalhos(element)).toEqual(['Cliente']);
    expect(linhasVisiveis(element)).toBe(3);
    // A celula tambem nao existe, e nao so o cabecalho: contar so o <th>
    // aprovaria um corpo desalinhado do cabecalho.
    expect(element.querySelectorAll('tbody tr:first-child td').length).toBe(1);
  });

  test('a busca alcanca a coluna escondida e a revela', () => {
    const { element } = createDataTable({ columns: COLUNAS, rows: LINHAS, searchable: true });

    digitarBusca(element, '81150');

    expect(cabecalhos(element)).toEqual(['Cliente', 'CEP']);
    expect(linhasVisiveis(element)).toBe(2);
    expect(element.querySelector('tbody tr td:nth-child(2)').textContent).toBe('81150-900');
  });

  test('a coluna some quando a busca deixa de casar por ela', () => {
    const { element } = createDataTable({ columns: COLUNAS, rows: LINHAS, searchable: true });

    digitarBusca(element, '81150');
    expect(cabecalhos(element)).toEqual(['Cliente', 'CEP']);

    digitarBusca(element, 'Comando');
    expect(cabecalhos(element)).toEqual(['Cliente']);
    expect(linhasVisiveis(element)).toBe(1);

    digitarBusca(element, '');
    expect(cabecalhos(element)).toEqual(['Cliente']);
    expect(linhasVisiveis(element)).toBe(3);
  });

  test('a normalizacao vale nos DOIS lados: com hifen acha sem, e sem acha com', () => {
    const { element } = createDataTable({ columns: COLUNAS, rows: LINHAS, searchable: true });

    // O termo tem hifen, e a linha 2 esta gravada sem.
    digitarBusca(element, '81150-900');
    expect(linhasVisiveis(element)).toBe(2);

    // O termo nao tem hifen, e a linha 1 esta gravada com.
    digitarBusca(element, '81150900');
    expect(linhasVisiveis(element)).toBe(2);
  });

  test('termo que normaliza para vazio nao casa nem revela', () => {
    const { element } = createDataTable({ columns: COLUNAS, rows: LINHAS, searchable: true });

    // 'Divisao' nao tem digito nenhum: normalizado pela regra do CEP, ele vira
    // ''. Sem a guarda do termo vazio, `includes('')` casaria as TRES linhas (a
    // de CEP nulo inclusive) e a coluna apareceria em qualquer busca por nome.
    // Uma linha e a resposta certa, e o 3 e a falha que este teste reprova.
    digitarBusca(element, 'Divisao');

    expect(cabecalhos(element)).toEqual(['Cliente']);
    expect(linhasVisiveis(element)).toBe(1);
  });

  test('a linha sem valor na coluna escondida nao casa', () => {
    const { element } = createDataTable({ columns: COLUNAS, rows: LINHAS, searchable: true });

    digitarBusca(element, '81150');

    const clientes = Array.from(element.querySelectorAll('tbody tr td:first-child'))
      .map((td) => td.textContent);
    expect(clientes).not.toContain('Comando Militar do Sul');
  });

  test('o corpo se remonta com o numero certo de celulas ao revelar', () => {
    // A REGRESSAO QUE ESTE TESTE GUARDA. O <tbody> se reconcilia entre renders,
    // e a linha de mesma chave mantem o no. Sem descartar a tabela quando o
    // conjunto visivel muda, o <tr> montado com 1 celula seria repintado com 2
    // colunas: o conteudo escorregaria de coluna, calado, e o cabecalho teria
    // uma coluna a mais que o corpo.
    const { element } = createDataTable({ columns: COLUNAS, rows: LINHAS, searchable: true });

    digitarBusca(element, '81150');

    const th = element.querySelectorAll('thead th').length;
    const td = element.querySelectorAll('tbody tr:first-child td').length;
    expect(td).toBe(th);
    expect(td).toBe(2);

    digitarBusca(element, 'Comando');
    expect(element.querySelectorAll('tbody tr:first-child td').length)
      .toBe(element.querySelectorAll('thead th').length);
  });

  test('coluna sem as duas propriedades segue pelo caminho de sempre', () => {
    // As 49 telas que ja usam o componente estao neste caso.
    const { element } = createDataTable({
      columns: [{ key: 'nome', label: 'Nome' }, { key: 'sigla', label: 'Sigla' }],
      rows: [{ id: 1, nome: 'Manutencao', sigla: 'MNT' }, { id: 2, nome: 'Aquisicao', sigla: 'AQS' }],
      searchable: true,
    });

    expect(cabecalhos(element)).toEqual(['Nome', 'Sigla']);
    digitarBusca(element, 'aquisicao');
    expect(linhasVisiveis(element)).toBe(1);
    expect(cabecalhos(element)).toEqual(['Nome', 'Sigla']);
  });
});
