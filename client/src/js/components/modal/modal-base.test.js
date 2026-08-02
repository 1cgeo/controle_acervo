import { describe, test, expect, afterEach } from 'vitest';

/**
 * Modal empilhado.
 *
 * MODAL SOBRE MODAL e caso real desde 2026-08-01: a ficha do produto do acervo
 * abre "Nova versão" e "Editar" por cima de si mesma, e o editor de geometria
 * abre por cima do formulário de produto.
 *
 * O defeito que estas provas guardam foi MEDIDO no navegador antes de existir
 * correção: com a ficha e o diálogo de versão abertos, um único Escape fechava os
 * DOIS. A causa é que cada modal registra o próprio `keydown` no `document`, e o
 * `stopPropagation` não alcança os demais ouvintes do mesmo elemento.
 *
 * Sem este arquivo, a próxima pessoa a mexer no `onKeyDown` reintroduz o defeito
 * sem perceber: ele não aparece com um modal só, que é como quase toda tela usa.
 */

import { openModal } from './modal-base.js';

const abertos = () => document.querySelectorAll('.modal').length;

const escape = () => document.dispatchEvent(
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
);

const tab = (shift = false) => {
  const evento = new KeyboardEvent('keydown', {
    key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true,
  });
  document.dispatchEvent(evento);
  return evento;
};

afterEach(() => {
  document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
});

describe('Escape com modais empilhados', () => {
  test('fecha SO o do topo', () => {
    openModal({ title: 'De baixo', content: 'a' });
    openModal({ title: 'De cima', content: 'b' });
    expect(abertos()).toBe(2);

    escape();

    expect(abertos()).toBe(1);
    expect(document.querySelector('.modal__title').textContent).toBe('De baixo');
  });

  test('o segundo Escape fecha o que sobrou', () => {
    openModal({ title: 'De baixo', content: 'a' });
    openModal({ title: 'De cima', content: 'b' });

    escape();
    escape();

    expect(abertos()).toBe(0);
  });

  test('tres empilhados fecham um a um, de cima para baixo', () => {
    openModal({ title: 'Um', content: 'a' });
    openModal({ title: 'Dois', content: 'b' });
    openModal({ title: 'Três', content: 'c' });

    escape();
    expect(document.querySelectorAll('.modal__title')[1].textContent).toBe('Dois');
    expect(abertos()).toBe(2);

    escape();
    expect(abertos()).toBe(1);
    expect(document.querySelector('.modal__title').textContent).toBe('Um');
  });

  test('fechar o de BAIXO pelo botão não tira o de cima da vez', () => {
    // Fechar fora de ordem e possivel (o codigo de quem chamou guarda o `close`).
    // Se a saida da pilha fosse `pop()`, o modal do topo perderia a vez e o
    // Escape passaria a nao fechar nada.
    const baixo = openModal({ title: 'De baixo', content: 'a' });
    openModal({ title: 'De cima', content: 'b' });

    baixo.close();
    expect(abertos()).toBe(1);

    escape();
    expect(abertos()).toBe(0);
  });

  test('modal já fechado não volta a responder ao Escape', () => {
    const so = openModal({ title: 'Único', content: 'a' });
    so.close();
    so.close(); // idempotente

    openModal({ title: 'Outro', content: 'b' });
    escape();

    expect(abertos()).toBe(0);
  });
});

describe('armadilha de foco', () => {
  test('só o modal do topo prende o Tab', () => {
    openModal({
      title: 'De baixo',
      content: 'a',
      actions: [{ label: 'Ação de baixo', onClick: () => {} }],
    });
    const cima = openModal({
      title: 'De cima',
      content: 'b',
      actions: [{ label: 'Ação de cima', onClick: () => {} }],
    });

    // Foco no ultimo focavel do modal do TOPO: o Tab dali tem de voltar para o
    // primeiro DELE, e nunca cair no modal de baixo.
    const focaveis = cima.element.querySelectorAll('button');
    focaveis[focaveis.length - 1].focus();

    const evento = tab();

    expect(evento.defaultPrevented).toBe(true);
    expect(cima.element.contains(document.activeElement)).toBe(true);
  });
});
