import { describe, test, expect } from 'vitest';
import { createDataTable } from '@components/data-table/data-table.js';

// selectAll(): marcar TODAS as linhas do filtro, e nao so as da pagina.
//
// Arquivo proprio porque o que se guarda aqui e uma DISTINCAO, e nao um
// comportamento a mais: a caixa do cabecalho marca a PAGINA (ela e a unica que
// pode desmarcar o que se ve) e o selectAll marca o conjunto. Confundir os dois
// e o defeito que este arquivo existe para pegar.
//
// O caso real: o maior pedido da mapoteca tem 132 itens, e com pageSize 10 a
// caixa do cabecalho exigiria 14 viradas de pagina justamente no pedido que
// mais precisa da impressao em lote.

const linhas = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1,
  nome: i % 2 === 0 ? `Carta 25k ${i + 1}` : `Carta 50k ${i + 1}`,
}));

const montar = (rows, opts = {}) => createDataTable({
  columns: [{ key: 'nome', label: 'Nome' }],
  rows,
  selectable: true,
  pageSize: 10,
  ...opts,
});

const buscar = (tabela, termo) => {
  const input = tabela.element.querySelector('input[type="search"]');
  input.value = termo;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('data-table: selecionar todos contra selecionar a pagina', () => {
  test('a caixa do CABECALHO marca so a pagina', () => {
    const t = montar(linhas(132));
    const cabecalho = t.element.querySelector('thead input[type="checkbox"]');

    cabecalho.checked = true;
    cabecalho.dispatchEvent(new Event('change', { bubbles: true }));

    expect(t.getSelected()).toHaveLength(10);
  });

  test('selectAll marca as 132, e nao as 10 da pagina', () => {
    const t = montar(linhas(132));

    t.selectAll();

    expect(t.getSelected()).toHaveLength(132);
  });

  test('selectAll respeita a BUSCA: filtrou por 25k, seleciona os 25k', () => {
    const t = montar(linhas(132), { searchable: true });

    buscar(t, '25k');
    t.selectAll();

    const sel = t.getSelected();
    expect(sel).toHaveLength(66);
    expect(sel.every(r => r.nome.includes('25k'))).toBe(true);
  });

  test('a selecao SOBREVIVE a limpeza da busca', () => {
    const t = montar(linhas(132), { searchable: true });

    buscar(t, '25k');
    t.selectAll();
    buscar(t, '');

    // Continuam 66 marcadas, agora no meio das 132 visiveis: e o que permite
    // filtrar, marcar, filtrar de novo e marcar mais.
    expect(t.getSelected()).toHaveLength(66);
  });

  test('clearSelection desfaz o selectAll', () => {
    const t = montar(linhas(132));

    t.selectAll();
    t.clearSelection();

    expect(t.getSelected()).toHaveLength(0);
  });

  test('avisa a tela a cada mudanca, com o conjunto inteiro', () => {
    const vistos = [];
    const t = montar(linhas(132), { onSelectionChange: (s) => vistos.push(s.length) });

    t.selectAll();
    t.clearSelection();

    expect(vistos).toEqual([132, 0]);
  });

  test('linha que sumiu da lista sai da selecao', () => {
    const t = montar(linhas(132));
    t.selectAll();
    expect(t.getSelected()).toHaveLength(132);

    // O pedido perdeu itens (alguem excluiu), e a tela recarregou.
    t.update({ rows: linhas(5) });

    expect(t.getSelected()).toHaveLength(5);
  });
});
