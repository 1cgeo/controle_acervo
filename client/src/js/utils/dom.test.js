import { describe, test, expect } from 'vitest';
import { el, clearChildren } from './dom.js';

// O `el()` e a ARMADILHA DA PROPRIEDADE QUE PARECE ATRIBUTO.
//
// Ele caia em `setAttribute` para toda chave que nao conhecia. Numas poucas
// chaves isso nao e uma aproximacao, e sim o contrario do que se pediu:
//
//   value          num `<textarea>` o conteudo e um filho de texto. O atributo
//                  era gravado e ignorado, e o editor da prosa do RPCMTec (9.1
//                  a 9.3) abria em branco por cima do texto ja escrito. Quem
//                  nao percebesse e salvasse apagava a subsecao.
//   checked        vale pela PRESENCA. `checked: false` virava
//                  `checked="false"` e marcava a caixa.
//   htmlFor        o atributo se chama `for`. `htmlFor` virava um atributo que
//                  o navegador ignora, e o rotulo parava de clicar.
//   disabled       mesma armadilha do `checked`.
//   selected       mesma armadilha, no `<option>`.
//   indeterminate  nao existe como atributo.
//
// Cada caso aqui REPROVA o `el()` antigo. E os tres ultimos casos guardam o
// caminho que ja funcionava (`value` no `<input>`, atributo comum, ouvinte),
// que e por onde uma correcao desatenta quebraria 145 arquivos.

describe('el(): as chaves que sao PROPRIEDADE, e nao atributo', () => {
  test('o <textarea> mostra o texto, e não o esconde num atributo', () => {
    const area = el('textarea', { value: 'Boas práticas do mês' });

    expect(area.value).toBe('Boas práticas do mês');
    // A prova de que a causa era esta: o atributo não existe mais.
    expect(area.getAttribute('value')).toBeNull();
  });

  test('o <textarea> com texto vazio continua vazio', () => {
    expect(el('textarea', { value: '' }).value).toBe('');
  });

  test('checked: false DESMARCA a caixa', () => {
    const caixa = el('input', { type: 'checkbox', checked: false });

    expect(caixa.checked).toBe(false);
    expect(caixa.hasAttribute('checked')).toBe(false);
  });

  test('checked: true marca a caixa', () => {
    expect(el('input', { type: 'checkbox', checked: true }).checked).toBe(true);
  });

  test('disabled: false deixa o campo USÁVEL', () => {
    // VARIÂNCIA: o par verdadeiro/falso é o que faz o caso valer. Um `el()` que
    // sempre desabilitasse passaria no caso do `true` sozinho.
    expect(el('input', { type: 'text', disabled: false }).disabled).toBe(false);
    expect(el('input', { type: 'text', disabled: true }).disabled).toBe(true);
  });

  test('htmlFor aponta o campo, e o rótulo volta a clicar', () => {
    const rotulo = el('label', { htmlFor: 'pc-ficha-vazios' });

    expect(rotulo.htmlFor).toBe('pc-ficha-vazios');
    expect(rotulo.getAttribute('for')).toBe('pc-ficha-vazios');
  });

  test('selected escolhe a <option>, e a ausência não escolhe', () => {
    const select = el('select', {}, [
      el('option', { value: '1', textContent: 'Origem' }),
      el('option', { value: '2', textContent: 'Insumo', selected: 'selected' }),
    ]);

    expect(select.value).toBe('2');
  });

  test('indeterminate só existe como propriedade', () => {
    const caixa = el('input', { type: 'checkbox', indeterminate: true });

    expect(caixa.indeterminate).toBe(true);
  });

  test('as demais booleanas puras aceitam os DOIS valores', () => {
    // `open`, `multiple`, `readOnly` e `required` são a mesma armadilha. Hoje o
    // repositório só passa `true` nelas, então nada está quebrado; entram para o
    // dia em que alguém passar `false`, que é quando ela morde.
    expect(el('details', { open: true }).open).toBe(true);
    expect(el('details', { open: false }).open).toBe(false);
    expect(el('input', { type: 'file', multiple: false }).multiple).toBe(false);
    expect(el('input', { type: 'text', readOnly: true }).readOnly).toBe(true);
    expect(el('input', { type: 'text', required: false }).required).toBe(false);
  });

  test('hidden fica de fora, porque aceita a string "until-found"', () => {
    // Tratá-lo como booleano jogaria esse valor fora. Como atributo ele
    // funciona, e ninguém aqui passa `false`.
    const caixa = el('div', { hidden: true });

    expect(caixa.hasAttribute('hidden')).toBe(true);
  });

  test('a propriedade entra DEPOIS do type, e o <input type=date> aceita a data', () => {
    // A ordem importa: `value` posto antes de `type="date"` seria aceito como
    // texto e recusado na troca de tipo, e o campo abriria vazio.
    const campo = el('input', { value: '2026-06-15', type: 'date' });

    expect(campo.value).toBe('2026-06-15');
  });
});

describe('el(): o que já funcionava continua funcionando', () => {
  test('value no <input type=text> continua chegando ao campo', () => {
    const campo = el('input', { className: 'x', type: 'text', value: 'Cap Fulano' });

    expect(campo.value).toBe('Cap Fulano');
    expect(campo.className).toBe('x');
  });

  test('atributo comum continua sendo atributo', () => {
    const botao = el('button', { type: 'button', 'aria-label': 'Fechar', title: 'Fechar' });

    expect(botao.getAttribute('aria-label')).toBe('Fechar');
    expect(botao.getAttribute('title')).toBe('Fechar');
  });

  test('null e undefined continuam sendo ignorados', () => {
    const campo = el('input', { type: 'text', value: null, disabled: undefined });

    expect(campo.value).toBe('');
    expect(campo.disabled).toBe(false);
  });

  test('ouvinte, dataset, style, textContent e filhos continuam de pé', () => {
    let cliques = 0;
    const filho = el('span', { textContent: 'dentro' });
    const caixa = el('div', {
      className: 'c',
      dataset: { id: '7' },
      style: { display: 'none' },
      onClick: () => { cliques += 1; },
    }, [filho, 'texto solto']);

    caixa.click();
    expect(cliques).toBe(1);
    expect(caixa.dataset.id).toBe('7');
    expect(caixa.style.display).toBe('none');
    expect(caixa.textContent).toBe('dentrotexto solto');

    clearChildren(caixa);
    expect(caixa.childNodes).toHaveLength(0);
  });
});
