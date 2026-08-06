import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createComboBoxField } from '@components/form-fields/form-fields.js';

// O COMBO BUSCAVEL, o componente sozinho.
//
// Ele existe porque o `<select>` nativo para de servir quando a lista cresce:
// escolher a nota de credito ao lancar um empenho e rolar 95 opcoes sem poder
// digitar nada, e o navegador so casa o PREFIXO do rotulo.
//
// O que estes casos FIXAM, e nenhum deles se ve olhando a tela:
//  - a busca e por SUBSTRING, sem acento e sem caixa;
//  - a lista chega ORDENADA, com comparacao numerica (a 2 antes da 10);
//  - `ordenar: false` respeita a ordem recebida, para a lista que ja tem ordem
//    propria (um fluxo de situacao, os meses do ano);
//  - sair do campo sem escolher NAO grava o texto digitado;
//  - a API e a MESMA do `createSelectField`, que e o que permite trocar um pelo
//    outro numa tela sem mexer em mais nada.

const OPCOES = [
  { value: 10, label: 'NC 10 - Material' },
  { value: 2, label: 'NC 2 - Serviços de terceiros' },
  { value: 7, label: 'NC 7 - Diárias' },
];

const montar = (extra = {}) => {
  const campo = createComboBoxField({ label: 'Nota de crédito', options: OPCOES, ...extra });
  document.body.appendChild(campo.element);
  return campo;
};

const itens = (campo) => [...campo.element.querySelectorAll('.combo__item')].map(i => i.textContent);

const digitar = (campo, texto) => {
  campo.input.dispatchEvent(new Event('focus'));
  campo.input.value = texto;
  campo.input.dispatchEvent(new Event('input', { bubbles: true }));
};

const tecla = (campo, key) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  campo.input.dispatchEvent(e);
  return e;
};

describe('createComboBoxField', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('a lista chega ordenada, com a 2 antes da 10', async () => {
    const campo = montar();

    digitar(campo, '');

    // Ordem alfabetica pura poria "NC 10" antes de "NC 2", porque '1' < '2'.
    expect(itens(campo)).toEqual([
      'NC 2 - Serviços de terceiros',
      'NC 7 - Diárias',
      'NC 10 - Material',
    ]);
  });

  test('ordenar: false respeita a ordem que veio', async () => {
    const campo = montar({ ordenar: false });

    digitar(campo, '');

    expect(itens(campo)).toEqual([
      'NC 10 - Material',
      'NC 2 - Serviços de terceiros',
      'NC 7 - Diárias',
    ]);
  });

  test('busca o MEIO do rotulo, sem acento e sem caixa', async () => {
    const campo = montar();

    digitar(campo, 'DIARIAS');

    expect(itens(campo)).toEqual(['NC 7 - Diárias']);
  });

  // VARIANCIA: sem este caso, o de cima passaria num combo que devolvesse
  // sempre uma opcao so.
  test('termo que nao existe mostra "Nada encontrado", e nao a lista inteira', async () => {
    const campo = montar();

    digitar(campo, 'jabuticaba');

    expect(itens(campo)).toEqual([]);
    expect(campo.element.querySelector('.combo__vazio')).not.toBeNull();
  });

  test('setas e Enter escolhem, e o onChange recebe o valor com o TIPO original', async () => {
    const onChange = vi.fn();
    const campo = montar({ onChange });

    digitar(campo, 'nc');
    tecla(campo, 'ArrowDown');
    tecla(campo, 'Enter');

    // O valor volta como NUMERO, e nao como o texto do atributo: e o que o
    // schema `.strict()` do servidor cobra.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(typeof campo.getValue()).toBe('number');
  });

  test('clicar num item escolhe, e o campo passa a mostrar o rotulo', async () => {
    const campo = montar();

    digitar(campo, 'material');
    campo.element.querySelector('.combo__item')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(campo.getValue()).toBe(10);
    expect(campo.input.value).toBe('NC 10 - Material');
  });

  // TEXTO DIGITADO E NAO CONFIRMADO NAO E ESCOLHA. Deixa-lo no campo faria a
  // tela mostrar uma selecao que o formulario nao tem.
  test('sair do campo sem escolher volta ao que estava', async () => {
    const onChange = vi.fn();
    const campo = montar({ value: 7, onChange });

    expect(campo.input.value).toBe('NC 7 - Diárias');

    digitar(campo, 'material');
    campo.input.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 0));

    expect(campo.getValue()).toBe(7);
    expect(campo.input.value).toBe('NC 7 - Diárias');
    expect(onChange).not.toHaveBeenCalled();
  });

  test('Escape fecha sem escolher', async () => {
    const campo = montar({ value: 7 });

    digitar(campo, 'material');
    tecla(campo, 'Escape');

    expect(campo.getValue()).toBe(7);
    expect(campo.element.querySelector('.combo__lista').classList.contains('hidden')).toBe(true);
  });

  // A MESMA API do `createSelectField`: e o que permitiu adotar o combo em um
  // lugar por vez, em vez de reescrever os 115 campos de uma vez.
  test('setValue, getValue e setOptions se comportam como no select', async () => {
    const campo = montar();

    expect(campo.getValue()).toBeNull();

    campo.setValue(2);
    expect(campo.getValue()).toBe(2);
    expect(campo.input.value).toBe('NC 2 - Serviços de terceiros');

    // Lista nova SEM a opcao escolhida: a escolha cai, senao o formulario
    // mandaria um id que a lista nao oferece mais.
    campo.setOptions([{ value: 99, label: 'NC 99 - Outra' }]);
    expect(campo.getValue()).toBeNull();
    expect(campo.input.value).toBe('');
  });

  test('setOptions mantem a escolha quando ela sobrevive', async () => {
    const campo = montar({ value: 7 });

    campo.setOptions([
      { value: 7, label: 'NC 7 - Diárias' },
      { value: 99, label: 'NC 99 - Outra' },
    ]);

    expect(campo.getValue()).toBe(7);
  });
  // O `change` NATIVO, e nao so o callback.
  //
  // A promessa do componente e ser troca direta do `createSelectField`, e parte
  // das telas nao usa a opcao `onChange`: elas fazem
  // `campo.input.addEventListener('change', ...)` no `<select>` de fora. O
  // `details.js` do pedido faz isso para reaplicar o modo civil/militar quando o
  // cliente muda, e sem o disparo a troca de cliente deixava o formulario no
  // modo do cliente anterior.
  test('escolher dispara o change nativo no input', async () => {
    const campo = montar();
    const ouvinte = vi.fn();
    campo.input.addEventListener('change', ouvinte);

    digitar(campo, 'material');
    campo.element.querySelector('.combo__item')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  // VARIANCIA: escolher o que JA estava escolhido nao e mudanca, e disparar ali
  // faria a tela refazer trabalho a cada reabertura da lista.
  test('escolher o mesmo valor NAO dispara nada', async () => {
    const campo = montar({ value: 10 });
    const ouvinte = vi.fn();
    const onChange = vi.fn();
    campo.input.addEventListener('change', ouvinte);

    const campo2 = createComboBoxField({ options: OPCOES, value: 10, onChange });
    document.body.appendChild(campo2.element);
    digitar(campo2, 'material');
    campo2.element.querySelector('.combo__item')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onChange).not.toHaveBeenCalled();
    expect(ouvinte).not.toHaveBeenCalled();
  });
});
