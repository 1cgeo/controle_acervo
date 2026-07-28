import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { criarSeletorAno } from '@modules/mapoteca/components/seletor-ano.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { getAno, onAnoChange } from '@modules/mapoteca/store/year-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const opcoes = (select) => Array.from(select.options).map(o => o.value);

describe('seletor de ano da mapoteca', () => {
  beforeEach(() => {
    svc.getAnosMapoteca.mockResolvedValue([2026, 2025]);
  });

  test('lista os anos com dado e abre no ano de contexto', async () => {
    const { elements, cleanup } = criarSeletorAno();
    const select = elements[0];
    await flush();

    expect(opcoes(select)).toEqual(['2026', '2025']);
    expect(select.value).toBe(String(getAno()));
    cleanup();
  });

  // No orcamento o ano tambem decide ONDE se cadastra, e por isso ele oferece um
  // ano ainda vazio. Aqui o ano so filtra o que ja aconteceu: oferecer um ano
  // sem movimento seria oferecer telas em branco.
  test('nao oferece "+ Outro ano"', async () => {
    const { elements, cleanup } = criarSeletorAno();
    await flush();

    expect(elements[0].textContent).not.toContain('Outro ano');
    cleanup();
  });

  test('escolher um ano troca o contexto e avisa as paginas', async () => {
    const handler = vi.fn();
    const off = onAnoChange(handler);
    const { elements, cleanup } = criarSeletorAno();
    const select = elements[0];
    await flush();

    select.value = '2025';
    select.dispatchEvent(new Event('change'));

    expect(getAno()).toBe(2025);
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    cleanup();
  });

  // O ano de contexto pode ser um que nao esta na lista do backend (veio do
  // localStorage de uma sessao anterior). Sem esta garantia, o seletor mostraria
  // um ano diferente do que as telas estao exibindo.
  test('o ano de contexto entra na lista mesmo sem dado no backend', async () => {
    const { elements: e1, cleanup: c1 } = criarSeletorAno();
    await flush();
    e1[0].value = '2025';
    e1[0].dispatchEvent(new Event('change'));
    c1();

    svc.getAnosMapoteca.mockResolvedValue([2026]);
    const { elements, cleanup } = criarSeletorAno();
    await flush();

    expect(opcoes(elements[0])).toEqual(['2026', '2025']);
    expect(elements[0].value).toBe('2025');
    cleanup();
  });

  test('a lista de anos que falha nao derruba o seletor', async () => {
    svc.getAnosMapoteca.mockRejectedValue(new Error('rede fora'));
    const { elements, cleanup } = criarSeletorAno();
    await flush();

    expect(opcoes(elements[0])).toEqual([String(getAno())]);
    cleanup();
  });
});
