import { describe, test, expect, vi } from 'vitest';

import { getAno, setAno, initAno, onAnoChange } from '@modules/orcamento/store/year-store.js';

const KEY = '@sca-orcamento-ano';

describe('year-store', () => {
  test('getAno() default e o ano corrente quando nao ha selecao', () => {
    // O setup global limpa o localStorage antes de cada teste.
    expect(getAno()).toBe(new Date().getFullYear());
  });

  test('getAno() le o ano persistido no localStorage', () => {
    localStorage.setItem(KEY, '2026');
    expect(getAno()).toBe(2026);
  });

  test('setAno persiste e dispara o evento anochange', () => {
    const handler = vi.fn();
    window.addEventListener('anochange', handler);

    setAno(2027);

    expect(localStorage.getItem(KEY)).toBe('2027');
    expect(getAno()).toBe(2027);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ ano: 2027 });

    window.removeEventListener('anochange', handler);
  });

  test('setAno ignora valores nao inteiros', () => {
    setAno('xyz');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(getAno()).toBe(new Date().getFullYear());
  });

  test('initAno so define o ano se ainda nao houver selecao', () => {
    initAno(2025);
    expect(localStorage.getItem(KEY)).toBe('2025');

    // Com selecao existente, initAno nao sobrescreve.
    initAno(2030);
    expect(localStorage.getItem(KEY)).toBe('2025');
  });

  test('onAnoChange registra o listener e devolve a funcao de remocao', () => {
    const handler = vi.fn();
    const off = onAnoChange(handler);

    setAno(2028);
    expect(handler).toHaveBeenCalledTimes(1);

    // Apos remover, novas trocas nao chamam mais o handler.
    off();
    setAno(2029);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
