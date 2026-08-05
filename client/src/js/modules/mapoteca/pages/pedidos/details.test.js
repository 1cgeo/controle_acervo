import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
vi.mock('@services/plataforma-service.js', async () => {
  const { mockPlataformaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockPlataformaService();
});
vi.mock('@modules/mapoteca/services/acervo-service.js', async () => {
  const { mockAcervoService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockAcervoService();
});

import { renderPedidoDetails } from '@modules/mapoteca/pages/pedidos/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const PEDIDO = {
  id: 55,
  cliente_id: 7,
  cliente_nome: '1º CGEO',
  tipo_cliente_nome: 'OM EB',
  localizador_pedido: 'AB12-CD34-EF56',
  situacao_pedido_id: 3,
  situacao_pedido_nome: 'Em andamento',
  data_pedido: '2026-06-10',
  prazo: '2026-06-30',
  documento_solicitacao: 'DIEx 123',
  documento_solicitacao_nup: '64536.000123/2026-11',
  palavras_chave: ['adestramento'],
  produtos: [
    {
      id: 900, produto_nome: 'Porto Alegre', mi: '2987-2', inom: 'SH-22-Y-B-VI-2',
      escala: '1:25.000', versao: '1', data_edicao: '2025-01-10', tipo_midia_nome: 'Papel',
      quantidade: 10, quantidade_impressa: 4, quantidade_restante: 6, impressao_concluida: false,
    },
  ],
  impressao: { concluida: false, itens_concluidos: 0, total_itens: 1 },
};

describe('renderPedidoDetails', () => {
  beforeEach(() => {
    svc.getPedido.mockResolvedValue(PEDIDO);
    svc.getAnexosPedido.mockResolvedValue([]);
  });

  test('busca o pedido do :id e monta cabecalho, resumo e itens', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    expect(svc.getPedido).toHaveBeenCalledWith(55);
    expect(container.querySelector('.page__title').textContent).toBe('Pedido #55');
    expect(container.textContent).toContain('AB12-CD34-EF56');
    expect(container.textContent).toContain('1 carta(s) · 10 exemplar(es)');
    expect(container.textContent).toContain('Produtos do pedido');
    expect(container.textContent).toContain('2987-2');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o link do cliente aponta para a rota do modulo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    const link = [...container.querySelectorAll('a')].find(a => a.textContent === '1º CGEO');
    expect(link.getAttribute('href')).toBe('#/mapoteca/clientes/7');

    if (typeof cleanup === 'function') cleanup();
  });

  test('carrega a secao de anexos do pedido', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    expect(svc.getAnexosPedido).toHaveBeenCalledWith(55);
    expect(container.textContent).toContain('Anexos do pedido');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a montagem NAO grava nada no servidor', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    expect(svc.updatePedido).not.toHaveBeenCalled();
    expect(svc.deletePedidos).not.toHaveBeenCalled();
    expect(svc.createProdutoPedido).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  test('pedido inexistente mostra a mensagem do servidor', async () => {
    svc.getPedido.mockRejectedValueOnce(new Error('Pedido não encontrado'));
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '999' }, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Pedido não encontrado');
    expect(container.textContent).toContain('Voltar para pedidos');

    if (typeof cleanup === 'function') cleanup();
  });

  // Antes havia um card "Resumo" fixo mais um bloco "Detalhes do pedido"
  // colapsado, e os dois repetiam cliente, DIEx, NUP, data e prazo.
  test('nao ha bloco colapsavel: tudo fica visivel de uma vez', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    expect(container.querySelector('details.detail-collapse')).toBeNull();
    expect(container.textContent).not.toContain('Detalhes do pedido');

    if (typeof cleanup === 'function') cleanup();
  });

  test('cada rotulo aparece uma vez so, sem o par Resumo mais Detalhes', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    const rotulos = [...container.querySelectorAll('.detail-card .detail-row__label, .detail-card__label')]
      .map(e => e.textContent.trim());
    const repetidos = rotulos.filter((r, i) => rotulos.indexOf(r) !== i);
    expect(repetidos).toEqual([]);

    if (typeof cleanup === 'function') cleanup();
  });

  test('mostra o contato DO PEDIDO e o geral da OM, separados', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Contato do pedido');
    expect(container.textContent).toContain('Contato geral da OM');

    if (typeof cleanup === 'function') cleanup();
  });

  // A etiqueta nao escreve nada, e quem embala o pacote e quem a imprime: por
  // isso ela NAO fica atras do perfil de gerente, ao contrario de editar e
  // excluir.
  test('oferece a etiqueta de envio', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    const botao = [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Etiqueta de envio'));
    expect(botao).toBeTruthy();

    if (typeof cleanup === 'function') cleanup();
  });

  test('a observacao interna aparece com o aviso de que o cliente nao a ve', async () => {
    svc.getPedido.mockResolvedValue({
      ...PEDIDO,
      observacao_interna: 'Sd Silva levou aos Correios em 29/07',
    });
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Observação interna');
    expect(container.textContent).toContain('Sd Silva levou aos Correios');
    expect(container.textContent).toContain('não aparece na consulta do cliente');

    if (typeof cleanup === 'function') cleanup();
  });

  test('pedido sem observacao interna nao mostra o bloco', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, { params: { id: '55' }, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).not.toContain('Observação interna');

    if (typeof cleanup === 'function') cleanup();
  });

});
