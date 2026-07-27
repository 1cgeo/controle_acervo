import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderPedidosList } from '@modules/mapoteca/pages/pedidos/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const PEDIDOS = [
  {
    id: 55, data_pedido: '2026-06-10', cliente_nome: '1º CGEO',
    documento_solicitacao: 'DIEx 123', situacao_pedido_id: 3,
    situacao_pedido_nome: 'Em andamento', prazo: '2026-06-30',
    quantidade_produtos: 8, itens_impressos: 3, localizador_pedido: 'AB12-CD34-EF56',
  },
];

describe('renderPedidosList', () => {
  beforeEach(() => {
    svc.getPedidos.mockResolvedValue(PEDIDOS);
  });

  test('monta o titulo e carrega os pedidos', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getPedidos).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Pedidos');
    expect(container.textContent).toContain('AB12-CD34-EF56');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a coluna de impressao mostra impressos/total', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('3/8');

    if (typeof cleanup === 'function') cleanup();
  });

  test('"Novo pedido" leva ao wizard COM o prefixo do modulo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    container.querySelector('.btn--primary').click();
    expect(location.hash).toBe('#/mapoteca/pedidos/novo');

    if (typeof cleanup === 'function') cleanup();
  });
});
