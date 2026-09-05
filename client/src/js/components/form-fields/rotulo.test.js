import { describe, test, expect, beforeEach } from 'vitest';
import {
  createTextField,
  createNumberField,
  createDateField,
  createSelectField,
  createTextareaField,
  createCheckboxField,
  createChipInput,
  createComboBoxField,
} from '@components/form-fields/form-fields.js';

/**
 * O ROTULO TEM DE APONTAR O CAMPO, em TODOS os construtores.
 *
 * O defeito: `buildField` carimbava o id no elemento que recebia, e dois
 * construtores nao entregam um campo e sim um CONTAINER -- o chip-input entrega
 * a `<div>` com as etiquetas, e o combo buscavel entrega a caixa com o campo e a
 * lista. `<label for>` so liga em elemento ROTULAVEL, entao o rotulo apontava
 * para uma `<div>` que o navegador ignora: clicar em "Palavras-chave" ou em
 * "Nota de credito" nao focava nada, e o leitor de tela anunciava um campo sem
 * nome nenhum. Os dois sao usados no cadastro de pedido e no lancamento de
 * empenho, que sao telas de digitar o dia inteiro.
 *
 * O caso e o mesmo para os seis construtores que ja estavam certos: sem eles
 * aqui, a correcao poderia quebrar um deles sem ninguem ver.
 */

/** O `<input>`/`<select>`/`<textarea>` que o rotulo do campo aponta. */
function apontadoPeloRotulo(campo) {
  const rotulo = campo.element.querySelector('label');
  expect(rotulo, 'o campo tem de ter rotulo').not.toBeNull();
  const alvoId = rotulo.getAttribute('for');
  expect(alvoId, 'o rotulo tem de declarar `for`').toBeTruthy();
  // Seletor por ATRIBUTO, e nao `#id`: o id gerado nao precisa ser um seletor
  // valido, e `CSS.escape` nao existe no jsdom.
  return campo.element.querySelector(`[id="${alvoId}"]`);
}

const CONSTRUTORES = [
  ['createTextField', () => createTextField({ label: 'Nome' })],
  ['createNumberField', () => createNumberField({ label: 'Quantidade' })],
  ['createDateField', () => createDateField({ label: 'Data' })],
  ['createSelectField', () => createSelectField({ label: 'Situação', options: [] })],
  ['createTextareaField', () => createTextareaField({ label: 'Observação' })],
  ['createCheckboxField', () => createCheckboxField({ label: 'Ativo' })],
  ['createChipInput', () => createChipInput({ label: 'Palavras-chave' })],
  ['createComboBoxField', () => createComboBoxField({ label: 'Nota de crédito', options: [] })],
];

describe('o rotulo aponta o campo, e nao a moldura em volta dele', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test.each(CONSTRUTORES)('%s', (_nome, construir) => {
    const campo = construir();
    document.body.appendChild(campo.element);

    // O alvo do rotulo e o MESMO elemento que o campo publica como `input`, que
    // e o que as telas focam e leem.
    expect(apontadoPeloRotulo(campo)).toBe(campo.input);
    // E ele e ROTULAVEL: uma `<div>` com id aceita o `for` e nao faz nada.
    expect(['INPUT', 'SELECT', 'TEXTAREA']).toContain(campo.input.tagName);
  });

  // O container do chip-input e a caixa do combo continuam no DOM: quem muda de
  // dono e so o id.
  test('o chip-input mantem o container das etiquetas dentro do campo', () => {
    const campo = createChipInput({ label: 'Palavras-chave', values: ['fronteira'] });
    expect(campo.element.querySelector('.chip-input')).not.toBeNull();
    expect(campo.element.querySelector('.chip-input__chip').textContent).toContain('fronteira');
  });

  test('o combo mantem a caixa com a lista dentro do campo', () => {
    const campo = createComboBoxField({ label: 'Nota de crédito', options: [] });
    expect(campo.element.querySelector('.combo')).not.toBeNull();
    expect(campo.element.querySelector('.combo__lista')).not.toBeNull();
  });
});
