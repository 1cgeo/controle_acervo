import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderClienteDetails } from '@modules/mapoteca/pages/clientes/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const CLIENTE = {
  id: 7,
  nome: '1º CGEO',
  tipo_cliente_nome: 'OM EB',
  ponto_contato_principal: 'Seção de Geoinformação',
  endereco_entrega_principal: 'Porto Alegre',
  estatisticas: {
    total_pedidos: 12, pedidos_em_andamento: 2, pedidos_concluidos: 10,
    total_produtos: 340, data_primeiro_pedido: '2024-02-01', data_ultimo_pedido: '2026-06-10',
  },
  ultimos_pedidos: [
    {
      id: 55, data_pedido: '2026-06-10', situacao_pedido_id: 5,
      situacao_pedido_nome: 'Concluído', documento_solicitacao: 'DIEx 123',
      prazo: '2026-06-20', quantidade_produtos: 8,
    },
  ],
};

describe('renderClienteDetails', () => {
  beforeEach(() => {
    svc.getCliente.mockResolvedValue(CLIENTE);
  });

  test('busca o cliente do :id da rota e mostra nome, estatisticas e pedidos', async () => {
    const container = document.createElement('div');
    const cleanup = await renderClienteDetails(container, { params: { id: '7' }, query: new URLSearchParams() });
    await flush();

    expect(svc.getCliente).toHaveBeenCalledWith(7);
    expect(container.querySelector('.page__title').textContent).toBe('1º CGEO');
    expect(container.textContent).toContain('Total de pedidos');
    expect(container.textContent).toContain('Últimos pedidos');
    expect(container.textContent).toContain('DIEx 123');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o voltar aponta para a lista COM o prefixo do modulo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderClienteDetails(container, { params: { id: '7' }, query: new URLSearchParams() });
    await flush();

    location.hash = '#/mapoteca/clientes/7';
    const voltar = container.querySelector('.btn--text');
    voltar.click();
    expect(location.hash).toBe('#/mapoteca/clientes');

    if (typeof cleanup === 'function') cleanup();
  });

  test('cliente inexistente mostra a mensagem do servidor e o botao de voltar', async () => {
    svc.getCliente.mockRejectedValueOnce(new Error('Cliente não encontrado'));
    const container = document.createElement('div');
    const cleanup = await renderClienteDetails(container, { params: { id: '999' }, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Cliente não encontrado');
    expect(container.textContent).toContain('Voltar para clientes');

    if (typeof cleanup === 'function') cleanup();
  });
});
