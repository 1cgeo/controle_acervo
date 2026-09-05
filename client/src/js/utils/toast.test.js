import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast, showError } from '@utils/toast.js';

/**
 * O TOASTE TEM DE DAR PARA LER.
 *
 * As mensagens que ele carrega sao as do SERVIDOR, verbatim, e algumas sao
 * longas ("Usuario necessita do perfil gerente no modulo mapoteca", as do Joi
 * com o nome do campo). Seis segundos para ler, entender e decidir, com a
 * atencao ainda no formulario que acabou de recusar: quem desviou o olhar
 * perdia o unico lugar onde o motivo apareceu, e nao tinha como recupera-lo.
 *
 * Estes casos guardam as duas saidas que a pessoa passou a ter: PAUSAR (o
 * ponteiro dentro segura o toast) e FECHAR (o botao tira na hora).
 */

const toasts = () => [...document.querySelectorAll('.toast')];
const textoDo = (t) => t.querySelector('.toast__texto').textContent;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast: o prazo', () => {
  test('some sozinho quando o prazo acaba', () => {
    showToast('Salvo', 'success');
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(4000);
    // A saida tem uma transicao de 250 ms antes da remocao.
    vi.advanceTimersByTime(250);

    expect(toasts()).toHaveLength(0);
  });

  test('o erro dura mais que o aviso comum', () => {
    showError('Usuário necessita do perfil gerente no módulo mapoteca');

    vi.advanceTimersByTime(4250);
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(2000 + 250);
    expect(toasts()).toHaveLength(0);
  });

  test('com o ponteiro dentro, NAO some', () => {
    showToast('Mensagem longa do servidor', 'error', 6000);
    const toast = toasts()[0];

    vi.advanceTimersByTime(1000);
    toast.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(60000);

    expect(toasts()).toHaveLength(1);
    expect(textoDo(toasts()[0])).toBe('Mensagem longa do servidor');
  });

  // O que sobra do prazo e GUARDADO, e nao reiniciado: passar o mouse por cima
  // sem parar nao renova o toast indefinidamente.
  test('tirado o ponteiro, o prazo retoma do que sobrava', () => {
    showToast('Aviso', 'info', 4000);
    const toast = toasts()[0];

    vi.advanceTimersByTime(3000);
    toast.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(30000);
    toast.dispatchEvent(new MouseEvent('mouseleave'));

    // Sobrava 1 s, e nao os 4 s do inicio.
    vi.advanceTimersByTime(999);
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(1 + 250);
    expect(toasts()).toHaveLength(0);
  });

  // O foco pausa pelo mesmo motivo do ponteiro: quem chegou ao botao de fechar
  // pelo teclado esta lendo.
  test('o foco dentro do toast tambem pausa', () => {
    showToast('Aviso', 'info', 4000);
    const toast = toasts()[0];

    toast.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(60000);

    expect(toasts()).toHaveLength(1);
  });
});

describe('toast: o botao de fechar', () => {
  test('existe, tem nome e tira o toast na hora', () => {
    showError('Falha ao gravar');
    const botao = toasts()[0].querySelector('.toast__fechar');

    expect(botao).not.toBeNull();
    expect(botao.getAttribute('aria-label')).toBe('Fechar aviso');

    botao.click();

    // NA HORA, e nao depois da transicao de saida: quem clicou em fechar ja
    // decidiu, e a animacao ali so atrasaria a tela.
    expect(toasts()).toHaveLength(0);
  });

  // A frase e anunciada UMA vez, pela regiao viva. O texto do toast visivel sai
  // do fluxo de acessibilidade, senao a mesma frase seria lida duas vezes; o
  // botao FICA anunciavel, senao ele estaria na ordem de tabulacao sem nome.
  test('o texto sai do fluxo de acessibilidade, e o botao nao', () => {
    showError('Falha ao gravar');
    const toast = toasts()[0];

    expect(toast.querySelector('.toast__texto').getAttribute('aria-hidden')).toBe('true');
    expect(toast.querySelector('.toast__fechar').getAttribute('aria-hidden')).toBeNull();
    // A regiao viva assertiva recebeu a frase.
    const regiao = [...document.querySelectorAll('.sr-only')]
      .find(r => r.getAttribute('aria-live') === 'assertive');
    expect(regiao.textContent).toBe('Falha ao gravar');
  });
});
