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

// A CAIXA DO CABECALHO TEM TRES ESTADOS, e nao dois.
//
// Com parte da pagina escolhida ela desenhava VAZIA, que e o mesmo desenho de
// "nada escolhido". O clique que a pessoa da esperando "marcar o resto" marca
// a pagina inteira (certo), e o clique seguinte desmarca tudo -- inclusive o
// que ela ja tinha escolhido, uma linha de cada vez, e que era o motivo de ela
// estar ali. O `el()` ja tratava `indeterminate` como PROPRIEDADE; so nao
// estava sendo usado.
describe('data-table: a caixa do cabecalho quando so parte da pagina esta escolhida', () => {
  const cabecalho = (t) => t.element.querySelector('thead input[type="checkbox"]');

  test('parte escolhida: indeterminada, e nao vazia', () => {
    const t = montar(linhas(3));

    const primeira = t.element.querySelector('tbody input[type="checkbox"]');
    primeira.checked = true;
    primeira.dispatchEvent(new Event('change', { bubbles: true }));

    expect(t.getSelected()).toHaveLength(1);
    expect(cabecalho(t).checked).toBe(false);
    expect(cabecalho(t).indeterminate).toBe(true);
  });

  test('nada escolhido: vazia, e NAO indeterminada', () => {
    const t = montar(linhas(3));

    expect(cabecalho(t).checked).toBe(false);
    expect(cabecalho(t).indeterminate).toBe(false);
  });

  test('pagina inteira escolhida: marcada, e NAO indeterminada', () => {
    const t = montar(linhas(3));

    cabecalho(t).checked = true;
    cabecalho(t).dispatchEvent(new Event('change', { bubbles: true }));

    expect(cabecalho(t).checked).toBe(true);
    expect(cabecalho(t).indeterminate).toBe(false);
  });

  // A caixa fala da PAGINA. Com 132 linhas e `pageSize` 10, o `selectAll` marca
  // as 132 e a pagina fica inteira: marcada, e nao indeterminada.
  test('selectAll deixa a caixa da pagina marcada, sem meio-termo', () => {
    const t = montar(linhas(132));

    t.selectAll();

    expect(cabecalho(t).checked).toBe(true);
    expect(cabecalho(t).indeterminate).toBe(false);
  });
});
