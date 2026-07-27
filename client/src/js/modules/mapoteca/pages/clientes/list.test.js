import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderClientesList } from '@modules/mapoteca/pages/clientes/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const CLIENTES = [
  {
    id: 1, nome: '1º CGEO', tipo_cliente_nome: 'OM EB', ponto_contato_principal: 'S3',
    total_pedidos: 4, data_ultimo_pedido: '2026-06-01', pedidos_em_andamento: 1,
  },
  {
    id: 2, nome: 'Prefeitura de Porto Alegre', tipo_cliente_nome: 'Órgão público',
    ponto_contato_principal: null, total_pedidos: 1, data_ultimo_pedido: null,
    pedidos_em_andamento: 0,
  },
];

describe('renderClientesList', () => {
  beforeEach(() => {
    svc.getClientes.mockResolvedValue(CLIENTES);
  });

  test('monta o titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getClientes).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Clientes');
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();
    expect(container.textContent).toContain('1º CGEO');
    expect(container.textContent).toContain('Prefeitura de Porto Alegre');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o botao de exclusao em lote nasce escondido', async () => {
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const botao = container.querySelector('.btn--danger');
    expect(botao.classList.contains('hidden')).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  test('erro do service esvazia a tabela sem derrubar a pagina', async () => {
    svc.getClientes.mockRejectedValueOnce(new Error('Erro de conexão'));
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Nenhum cliente cadastrado');

    if (typeof cleanup === 'function') cleanup();
  });
});
