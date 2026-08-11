import { describe, it, expect } from 'vitest';
import { createChipInput, createTextField } from '@components/form-fields/form-fields.js';

/**
 * O CHIP INPUT COM VOCABULARIO.
 *
 * O que estes testes seguram e a razao de o campo ter ganhado sugestao em
 * 2026-08-11: `mapoteca.pedido.palavras_chave` juntou 34 grafias em 50 usos em
 * tres dias, e 'excedente', 'excedentes' e 'exemplares excedentes' partiram sete
 * pedidos do mesmo assunto em tres buscas que nao se encontram. A busca casa a
 * etiqueta INTEIRA e diferencia maiuscula (indice GIN, `@>`), entao variante de
 * caixa nao e detalhe de estilo: e um pedido que some da lista.
 */

/** Digita e confirma com Enter, como quem cadastra. */
function digitar(campo, texto) {
  campo.input.value = texto;
  campo.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('createChipInput com sugestoes', () => {
  it('publica as sugestoes num datalist ligado ao input', () => {
    const campo = createChipInput({ label: 'Palavras-chave', sugestoes: ['excedente', 'fronteira'] });

    const datalist = campo.element.querySelector('datalist');
    expect(datalist).not.toBeNull();
    // O `list` aponta o datalist, e e o que faz o navegador sugerir.
    expect(campo.input.getAttribute('list')).toBe(datalist.id);
    expect([...datalist.querySelectorAll('option')].map(o => o.value))
      .toEqual(['excedente', 'fronteira']);
  });

  it('sem `sugestoes`, nao cria datalist nenhum', () => {
    const campo = createChipInput({ label: 'Palavras-chave' });
    expect(campo.element.querySelector('datalist')).toBeNull();
    expect(campo.input.hasAttribute('list')).toBe(false);
  });

  it('setSugestoes troca a lista depois de a tela montar', () => {
    // O caso real: quem monta o campo nao espera a rota que traz as etiquetas.
    const campo = createChipInput({ sugestoes: [] });
    expect(campo.element.querySelectorAll('datalist option')).toHaveLength(0);

    campo.setSugestoes(['excedente', 'fronteira']);
    expect([...campo.element.querySelectorAll('datalist option')].map(o => o.value))
      .toEqual(['excedente', 'fronteira']);
  });

  it('adota a grafia do vocabulario quando so a caixa difere', () => {
    const campo = createChipInput({ sugestoes: ['excedente', 'fronteira'] });

    digitar(campo, 'Excedente');
    digitar(campo, 'FRONTEIRA');

    // A canonica ganha da digitada: sao a MESMA etiqueta, e a busca nao acharia
    // as duas de uma vez.
    expect(campo.getValue()).toEqual(['excedente', 'fronteira']);
  });

  it('aceita etiqueta nova, que nao esta no vocabulario', () => {
    // O campo e livre de proposito: a sugestao evita a variante, e nao fecha a
    // porta para etiqueta nova, que assim nasce sem migracao.
    const campo = createChipInput({ sugestoes: ['excedente'] });

    digitar(campo, 'saara');

    expect(campo.getValue()).toEqual(['saara']);
  });

  it('recusa a duplicata que so difere na caixa, mesmo sem vocabulario', () => {
    const campo = createChipInput({ values: ['excedente'] });

    digitar(campo, 'EXCEDENTE');

    expect(campo.getValue()).toEqual(['excedente']);
  });
});

describe('createTextField com sugestoes', () => {
  it('liga o datalist e permite trocar a lista depois', () => {
    const campo = createTextField({ label: 'Palavra-chave', sugestoes: [] });
    const datalist = campo.element.querySelector('datalist');

    expect(campo.input.getAttribute('list')).toBe(datalist.id);

    campo.setSugestoes(['excedente', 'fronteira']);
    expect([...datalist.querySelectorAll('option')].map(o => o.value))
      .toEqual(['excedente', 'fronteira']);
  });

  it('sem `sugestoes`, segue campo de texto puro e `setSugestoes` nao explode', () => {
    // Os 115 campos de texto que ja existem passam por aqui: nenhum deles pede
    // sugestao, e nenhum pode quebrar por causa da chave nova.
    const campo = createTextField({ label: 'Município' });

    expect(campo.element.querySelector('datalist')).toBeNull();
    expect(campo.input.hasAttribute('list')).toBe(false);
    expect(() => campo.setSugestoes(['x'])).not.toThrow();
  });
});
