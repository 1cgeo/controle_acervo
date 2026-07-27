import { describe, test, expect, vi, beforeEach } from 'vitest';

// O acervo-service mora no modulo mapoteca porque so o wizard de pedido o usa,
// mas as ROTAS sao do acervo. Estes testes travam isso: se alguem prefixar as
// chamadas com '/mapoteca', a busca do catalogo para de achar produto.
vi.mock('@services/api-client.js', () => ({
  apiGet: vi.fn(() => Promise.resolve(null)),
}));

import { apiGet } from '@services/api-client.js';
import { clearCache } from '@services/cache.js';
import {
  buscarProdutos, getProdutoDetalhado, getTiposProduto, getTiposEscala,
} from '@modules/mapoteca/services/acervo-service.js';

beforeEach(() => {
  clearCache();
  vi.clearAllMocks();
});

describe('acervo-service', () => {
  test('buscarProdutos sempre manda page e limit', async () => {
    await buscarProdutos();
    expect(apiGet).toHaveBeenCalledWith('/acervo/busca?page=1&limit=20');
  });

  test('buscarProdutos monta os filtros preenchidos', async () => {
    await buscarProdutos({ termo: 'Rio', tipo_produto_id: 2, tipo_escala_id: 3, page: 2, limit: 5 });
    expect(apiGet).toHaveBeenCalledWith(
      '/acervo/busca?termo=Rio&tipo_produto_id=2&tipo_escala_id=3&page=2&limit=5'
    );
  });

  test('getProdutoDetalhado busca o produto com as versoes', async () => {
    await getProdutoDetalhado(42);
    expect(apiGet).toHaveBeenCalledWith('/acervo/produto/detalhado/42');
  });

  test('os dominios do acervo vem de /gerencia, nao de /mapoteca', async () => {
    await getTiposProduto();
    expect(apiGet).toHaveBeenCalledWith('/gerencia/dominio/tipo_produto');

    await getTiposEscala();
    expect(apiGet).toHaveBeenCalledWith('/gerencia/dominio/tipo_escala');
  });

  test('nenhuma rota do acervo carrega o prefixo do modulo mapoteca', async () => {
    await buscarProdutos({ termo: 'x' });
    await getProdutoDetalhado(1);
    await getTiposProduto();
    await getTiposEscala();
    for (const [caminho] of apiGet.mock.calls) {
      expect(caminho.startsWith('/mapoteca')).toBe(false);
    }
  });
});
