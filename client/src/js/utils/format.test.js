import { describe, test, expect } from 'vitest';
import { formatCurrency, formatDate, toIsoDate, formatNumber, monthName } from './format.js';

describe('formatCurrency', () => {
  test('formata em BRL', () => {
    expect(formatCurrency(1234.5)).toMatch(/R\$\s?1\.234,50/);
  });
  test('vazio/invalido vira -', () => {
    expect(formatCurrency(null)).toBe('-');
    expect(formatCurrency('')).toBe('-');
    expect(formatCurrency('abc')).toBe('-');
  });
});

describe('formatDate', () => {
  test('data ISO YYYY-MM-DD sem deslocamento de fuso', () => {
    expect(formatDate('2026-06-13')).toBe('13/06/2026');
  });
  test('vazio vira -', () => {
    expect(formatDate(null)).toBe('-');
  });
});

describe('toIsoDate', () => {
  test('mantem YYYY-MM-DD', () => {
    expect(toIsoDate('2026-06-13')).toBe('2026-06-13');
  });
  test('vazio vira null', () => {
    expect(toIsoDate('')).toBeNull();
  });
});

describe('formatNumber e monthName', () => {
  test('formatNumber agrupa pt-BR', () => {
    expect(formatNumber(1000)).toBe('1.000');
  });
  test('monthName 6 = Junho', () => {
    expect(monthName(6)).toBe('Junho');
  });
});
