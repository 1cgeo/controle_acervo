import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Dialogo de item do pedido: busca no catalogo do ACERVO (RN08) e campos do
// produto_pedido. Os dois services sao mockados; nada sai para a rede.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
vi.mock('@modules/mapoteca/services/acervo-service.js', async () => {
  const { mockAcervoService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockAcervoService();
});

import { openProdutoPedidoDialog } from '@modules/mapoteca/pages/pedidos/dialog-produto.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import * as acervo from '@modules/mapoteca/services/acervo-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  svc.getDominioTipoMidia.mockResolvedValue([{ code: 1, nome: 'Papel' }]);
  svc.getDominioFormaEntrega.mockResolvedValue([{ code: 1, nome: 'Correios' }]);
  acervo.getTiposProduto.mockResolvedValue([{ code: 1, nome: 'Carta Topográfica' }]);
  acervo.getTiposEscala.mockResolvedValue([{ code: 1, nome: '1:25.000' }]);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('openProdutoPedidoDialog', () => {
  test('abre com a busca do catalogo e os campos do item', async () => {
    await openProdutoPedidoDialog({ onSubmit: vi.fn() });
    await flush();

    expect(acervo.getTiposProduto).toHaveBeenCalled();
    expect(document.body.textContent).toContain('Produto do acervo');
    expect(document.body.textContent).toContain('Buscar no catálogo');
    expect(document.body.textContent).toContain('Dados do item');
  });

  test('a busca chama o service do acervo com o termo digitado', async () => {
    acervo.buscarProdutos.mockResolvedValue({ total: 0, page: 1, limit: 5, dados: [] });
    await openProdutoPedidoDialog({ onSubmit: vi.fn() });
    await flush();

    const input = [...document.querySelectorAll('input[type="text"]')][0];
    input.value = 'Porto Alegre';
    input.dispatchEvent(new Event('input'));

    const buscar = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Buscar no catálogo'));
    buscar.click();
    await flush();

    expect(acervo.buscarProdutos).toHaveBeenCalledWith(
      expect.objectContaining({ termo: 'Porto Alegre', page: 1, limit: 5 })
    );
  });

  test('busca vazia mostra a orientacao da RN08 (cadastre no acervo primeiro)', async () => {
    acervo.buscarProdutos.mockResolvedValue({ total: 0, page: 1, limit: 5, dados: [] });
    await openProdutoPedidoDialog({ onSubmit: vi.fn() });
    await flush();

    const buscar = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Buscar no catálogo'));
    buscar.click();
    await flush();

    expect(document.body.textContent).toContain('Produto não encontrado no acervo');
  });

  test('submeter sem produto selecionado nao chama o onSubmit', async () => {
    const onSubmit = vi.fn();
    await openProdutoPedidoDialog({ onSubmit });
    await flush();

    const adicionar = [...document.querySelectorAll('button')].find(b => b.textContent === 'Adicionar');
    adicionar.click();
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Selecione o produto e a versão no catálogo do acervo');
  });

  test('modo edicao pre-seleciona o produto e busca as outras versoes', async () => {
    acervo.getProdutoDetalhado.mockResolvedValue({
      id: 42, nome: 'Porto Alegre', mi: '2987-2', inom: 'SH-22', escala: '1:25.000',
      versoes: [{ uuid_versao: 'u1', versao: '1', versao_data_edicao: '2025-01-10' }],
    });

    await openProdutoPedidoDialog({
      item: {
        produto_id: 42, produto_nome: 'Porto Alegre', mi: '2987-2', inom: 'SH-22',
        escala: '1:25.000', uuid_versao: 'u1', versao: '1', quantidade: 5, tipo_midia_id: 1,
      },
      onSubmit: vi.fn(),
    });
    await flush();

    expect(acervo.getProdutoDetalhado).toHaveBeenCalledWith(42);
    expect(document.body.textContent).toContain('Produto selecionado');
    expect(document.body.textContent).toContain('Porto Alegre');
  });
});
