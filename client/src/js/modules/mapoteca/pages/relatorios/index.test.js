import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderRelatorios } from '@modules/mapoteca/pages/relatorios/index.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const LINHAS_MIL = [
  {
    numero: 1, data_pedido: '2026-05-02', documento_solicitacao: 'DIEx 55',
    unidade: '1º CGEO', situacao: 'Concluído', total: 12,
    pedido_id: 55, localizador_pedido: 'AB12-CD34-EF56',
  },
];

describe('renderRelatorios', () => {
  beforeEach(() => {
    svc.getRelatorio.mockResolvedValue(LINHAS_MIL);
  });

  test('abre no relatorio Mil e carrega o ano corrente', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRelatorios(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getRelatorio).toHaveBeenCalledWith('pedidos_mil', new Date().getFullYear());
    expect(container.querySelector('.page__title').textContent).toBe('Relatórios Anuais');
    expect(container.textContent).toContain('1º CGEO');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o seletor oferece os seis relatorios da planilha', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRelatorios(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const valores = [...container.querySelectorAll('select')[0].options].map(o => o.value);
    expect(valores).toEqual([
      'pedidos_mil', 'pedidos_detalhado', 'impressao_detalhada',
      'pedidos_resumo', 'pedidos_civ', 'tematicos',
    ]);

    if (typeof cleanup === 'function') cleanup();
  });

  test('trocar de relatorio recarrega com o novo nome', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRelatorios(container, { params: {}, query: new URLSearchParams() });
    await flush();
    svc.getRelatorio.mockClear();

    const seletor = container.querySelectorAll('select')[0];
    seletor.value = 'pedidos_civ';
    seletor.dispatchEvent(new Event('change'));
    await flush();

    expect(svc.getRelatorio).toHaveBeenCalledWith('pedidos_civ', new Date().getFullYear());

    if (typeof cleanup === 'function') cleanup();
  });

  test('o localizador linka o pedido COM o prefixo do modulo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRelatorios(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const link = [...container.querySelectorAll('a')].find(a => a.textContent === 'AB12-CD34-EF56');
    expect(link.getAttribute('href')).toBe('#/mapoteca/pedidos/55');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o botao exporta o CSV pelo service, com nome e ano', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRelatorios(container, { params: {}, query: new URLSearchParams() });
    await flush();

    container.querySelector('.page__actions .btn').click();
    await flush();

    expect(svc.downloadRelatorioCsv).toHaveBeenCalledWith('pedidos_mil', new Date().getFullYear());

    if (typeof cleanup === 'function') cleanup();
  });
});
