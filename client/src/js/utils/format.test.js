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

  // REGRESSAO 2026-07-27: a "Data de entrega" aparecia como D-1.
  //
  // A coluna e DATE, mas o driver a convertia para um Date na meia-noite LOCAL
  // DO SERVIDOR, e a resposta ia serializada em UTC. Com o servidor em UTC e o
  // navegador em UTC-3, 2026-01-14 chegava como '2026-01-14T00:00:00.000Z' e a
  // tela mostrava 13/01. O conserto e no servidor (setTypeParser do OID 1082,
  // em database/db.js), que agora manda a string crua. Este teste guarda o
  // contrato do lado do client: string sem hora NAO passa por fuso nenhum.
  test('data pura AAAA-MM-DD nao sofre deslocamento de fuso', () => {
    expect(formatDate('2026-01-14')).toBe('14/01/2026');
    expect(formatDate('2026-01-01')).toBe('01/01/2026');   // virada de ano
    expect(formatDate('2026-03-01')).toBe('01/03/2026');
  });

  test('data com hora em UTC ainda desloca, e por isso o servidor nao a envia', () => {
    // Documenta o defeito de origem, para ninguem "consertar" o formatDate
    // achando que o problema estava aqui: com instante em UTC, o deslocamento
    // e o comportamento CERTO de um horario. O erro era mandar DATE como
    // instante, e isso se resolve no servidor.
    const deslocado = formatDate('2026-01-14T00:00:00.000Z');
    expect(['13/01/2026', '14/01/2026']).toContain(deslocado);
  });

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
