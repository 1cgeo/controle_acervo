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

  // REGRESSAO: a "Data de entrega" aparecia como D-1, porque o driver convertia
  // a coluna DATE para um Date na meia-noite LOCAL e a resposta ia serializada
  // em UTC. O conserto e no servidor (`setTypeParser` do OID 1082, em
  // `database/db.js`), que manda a string crua. Este teste guarda o contrato do
  // lado do client: string sem hora NAO passa por fuso nenhum.
  test('data pura AAAA-MM-DD nao sofre deslocamento de fuso', () => {
    expect(formatDate('2026-01-14')).toBe('14/01/2026');
    expect(formatDate('2026-01-01')).toBe('01/01/2026');   // virada de ano
    expect(formatDate('2026-03-01')).toBe('01/03/2026');
  });

  // O caso que existia aqui aceitava '13/01/2026' OU '14/01/2026', entao nao
  // podia falhar: era comentario vestido de teste. O que ele queria dizer esta
  // no bloco acima. O que da para AFIRMAR sem depender do fuso de quem roda e
  // que instante e data pura seguem caminhos diferentes -- e por isso o servidor
  // manda DATE como string, e nunca como instante.
  test('instante em UTC nao e tratado como data pura', () => {
    expect(formatDate('2026-01-14T00:00:00.000Z')).not.toBe(
      formatDate('2026-01-14T23:59:59.000Z')
    );
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

describe('formatNumber', () => {
  test('agrupa o milhar no padrão pt-BR', () => {
    expect(formatNumber(1000)).toBe('1.000');
  });
});

describe('monthName', () => {
  test('o mês 6 é Junho: a numeração começa em 1, e não em 0', () => {
    expect(monthName(6)).toBe('Junho');
  });
});
