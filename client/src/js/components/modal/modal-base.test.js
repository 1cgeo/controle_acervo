import { describe, test, expect, afterEach } from 'vitest';

/**
 * Modal empilhado.
 *
 * MODAL SOBRE MODAL e caso real: a ficha do produto do acervo abre "Nova
 * versão" e "Editar" por cima de si mesma, e o editor de geometria abre por cima
 * do formulário de produto.
 *
 * O defeito que estas provas guardam: com dois modais abertos, um único Escape
 * fecha os DOIS, porque cada modal registra o próprio `keydown` no `document` e
 * o `stopPropagation` não alcança os demais ouvintes do mesmo elemento.
 *
 * Sem este arquivo, a próxima pessoa a mexer no `onKeyDown` reintroduz o defeito
 * sem perceber: ele não aparece com um modal só, que é como quase toda tela usa.
 */

import { openModal, fecharTodosOsModais } from './modal-base.js';

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

describe('OCUPADO: o modal que esta gravando', () => {
  /** Abre um modal cuja ação liga o estado de ocupado e o devolve. */
  function comAcao() {
    let controle = null;
    const modal = openModal({
      title: 'Formulário',
      content: 'a',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          onClick: ({ setOcupado }) => { controle = setOcupado; setOcupado(true); },
        },
      ],
    });
    const botao = (texto) => [...modal.element.querySelectorAll('.modal__footer .btn')]
      .find(b => b.textContent === texto);
    return { modal, botao, liberar: () => controle(false) };
  }

  test('Escape, fundo e o X nao fecham durante a gravacao', () => {
    const { modal, botao } = comAcao();
    botao('Salvar').click();

    escape();
    expect(abertos()).toBe(1);

    // Clique no fundo.
    modal.element.parentElement.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true })
    );
    expect(abertos()).toBe(1);

    modal.element.querySelector('.modal__close').click();
    expect(abertos()).toBe(1);
  });

  test('o rodape inteiro fica desabilitado, e so o botao clicado leva a marca', () => {
    const { botao } = comAcao();
    botao('Salvar').click();

    expect(botao('Salvar').disabled).toBe(true);
    expect(botao('Cancelar').disabled).toBe(true);
    expect(botao('Salvar').classList.contains('btn--ocupado')).toBe(true);
    // CONTROLE NEGATIVO: uma marca posta em TODO botao passaria no caso acima e
    // nao diria qual acao esta em curso.
    expect(botao('Cancelar').classList.contains('btn--ocupado')).toBe(false);
  });

  test('terminada a gravacao, tudo volta ao normal', () => {
    const { modal, botao, liberar } = comAcao();
    botao('Salvar').click();
    liberar();

    expect(botao('Salvar').disabled).toBe(false);
    expect(botao('Salvar').classList.contains('btn--ocupado')).toBe(false);
    expect(modal.element.hasAttribute('aria-busy')).toBe(false);

    escape();
    expect(abertos()).toBe(0);
  });

  // CONTROLE POSITIVO: quem NAO chama `setOcupado` continua como sempre. A trava
  // e opt-in, e um modal que nascesse travado quebraria todos os dialogos.
  test('o modal que nao usa o recurso fecha por Escape como antes', () => {
    openModal({
      title: 'Sem trava',
      content: 'a',
      actions: [{ label: 'Salvar', onClick: () => {} }],
    });
    [...document.querySelectorAll('.modal__footer .btn')].pop().click();

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

/**
 * O overlay mora no `document.body`, e nao no `#app`. Nem a limpeza da pagina
 * nem o `clearLayout()` o alcancam, entao um modal aberto sobrevivia a troca de
 * rota e ficava por cima da tela seguinte com a armadilha de foco ligada. O
 * router chama `fecharTodosOsModais()` no inicio de cada navegacao.
 */
describe('fecharTodosOsModais', () => {
  test('derruba a pilha inteira, do topo ao fundo', () => {
    openModal({ title: 'De baixo', content: 'a' });
    openModal({ title: 'Do meio', content: 'b' });
    openModal({ title: 'De cima', content: 'c' });
    expect(abertos()).toBe(3);

    fecharTodosOsModais();

    expect(abertos()).toBe(0);
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  test('cada modal recebe o proprio onClose, uma vez so', () => {
    const chamadas = [];
    openModal({ title: 'A', content: 'a', onClose: () => chamadas.push('a') });
    openModal({ title: 'B', content: 'b', onClose: () => chamadas.push('b') });

    fecharTodosOsModais();
    fecharTodosOsModais();

    expect(chamadas).toEqual(['a', 'b']);
  });

  // NAO passa pela guarda de descarte: a navegacao ja aconteceu, e perguntar
  // "descartar?" aqui travaria a fila do router esperando resposta sobre uma
  // tela que ja saiu do ar.
  test('ignora a guarda de descarte, que recusaria o fechamento', () => {
    openModal({ title: 'Com pendencia', content: 'x', podeFechar: () => false });

    fecharTodosOsModais();

    expect(abertos()).toBe(0);
  });

  test('sem modal aberto, nao faz nada e nao quebra', () => {
    expect(() => fecharTodosOsModais()).not.toThrow();
    expect(abertos()).toBe(0);
  });
});
