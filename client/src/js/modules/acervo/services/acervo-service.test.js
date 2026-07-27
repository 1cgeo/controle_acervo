import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@services/api-client.js', () => ({
  apiGet: vi.fn((endpoint) => Promise.resolve({ endpoint })),
}));

import { apiGet } from '@services/api-client.js';
import { clearCache } from '@services/cache.js';
import * as acervoService from './acervo-service.js';

/** Caminho pedido na ultima chamada do apiGet. */
const ultimoEndpoint = () => apiGet.mock.calls[apiGet.mock.calls.length - 1][0];

beforeEach(() => {
  clearCache();
  apiGet.mockClear();
});

describe('acervo-service: caminhos da API', () => {
  test('as rotas do acervo NAO ganharam prefixo na fusao', async () => {
    // Se alguma virasse '/acervo/dashboard/...' esta expectativa quebraria.
    await acervoService.getProdutosTotal();
    expect(ultimoEndpoint()).toBe('/dashboard/produtos_total');

    await acervoService.getSystemHealth();
    expect(ultimoEndpoint()).toBe('/dashboard/system_health');

    for (const chamada of apiGet.mock.calls) {
      expect(chamada[0].startsWith('/dashboard/')).toBe(true);
    }
  });

  test('cada funcao da aba 1 aponta para o seu endpoint', async () => {
    const esperado = [
      [acervoService.getProdutosTotal, '/dashboard/produtos_total'],
      [acervoService.getArquivosTotalGb, '/dashboard/arquivos_total_gb'],
      [acervoService.getUsuariosTotal, '/dashboard/usuarios_total'],
      [acervoService.getSystemHealth, '/dashboard/system_health'],
    ];
    for (const [fn, endpoint] of esperado) {
      await fn();
      expect(ultimoEndpoint()).toBe(endpoint);
    }
  });

  test('cada funcao da aba 2 aponta para o seu endpoint', async () => {
    const esperado = [
      [acervoService.getProdutosTipo, '/dashboard/produtos_tipo'],
      [acervoService.getProdutosEscala, '/dashboard/produtos_escala'],
      [acervoService.getGbTipoProduto, '/dashboard/gb_tipo_produto'],
      [acervoService.getArquivosTipoArquivo, '/dashboard/arquivos_tipo_arquivo'],
      [acervoService.getGbVolume, '/dashboard/gb_volume'],
    ];
    for (const [fn, endpoint] of esperado) {
      await fn();
      expect(ultimoEndpoint()).toBe(endpoint);
    }
  });

  test('cada funcao da aba 3 aponta para o seu endpoint', async () => {
    const esperado = [
      [acervoService.getArquivosDia, '/dashboard/arquivos_dia'],
      [acervoService.getDownloadsDia, '/dashboard/downloads_dia'],
      [acervoService.getUltimosProdutos, '/dashboard/ultimos_produtos'],
      [acervoService.getUltimasVersoes, '/dashboard/ultimas_versoes'],
      [acervoService.getUltimosCarregamentos, '/dashboard/ultimos_carregamentos'],
      [acervoService.getUltimasModificacoes, '/dashboard/ultimas_modificacoes'],
      [acervoService.getUltimosDeletes, '/dashboard/ultimos_deletes'],
      // O endpoint do historico e singular no servidor: '/dashboard/download'.
      [acervoService.getDownloads, '/dashboard/download'],
      [acervoService.getSituacaoCarregamento, '/dashboard/situacao_carregamento'],
    ];
    for (const [fn, endpoint] of esperado) {
      await fn();
      expect(ultimoEndpoint()).toBe(endpoint);
    }
  });

  test('as funcoes com periodo mandam o parametro months', async () => {
    await acervoService.getProdutoActivityTimeline(12);
    expect(ultimoEndpoint()).toBe('/dashboard/produto_activity_timeline?months=12');

    await acervoService.getVersaoActivityTimeline(24);
    expect(ultimoEndpoint()).toBe('/dashboard/versao_activity_timeline?months=24');

    await acervoService.getStorageGrowthTrends(6);
    expect(ultimoEndpoint()).toBe('/dashboard/storage_growth_trends?months=6');

    await acervoService.getUserActivityMetrics(10);
    expect(ultimoEndpoint()).toBe('/dashboard/user_activity_metrics?limit=10');
  });

  test('o periodo padrao e de 6 meses', async () => {
    await acervoService.getProdutoActivityTimeline();
    expect(ultimoEndpoint()).toBe('/dashboard/produto_activity_timeline?months=6');
  });
});

describe('acervo-service: cache', () => {
  test('a segunda chamada seguida sai do cache, sem bater na API', async () => {
    await acervoService.getProdutosTotal();
    await acervoService.getProdutosTotal();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test('periodos diferentes nao dividem a mesma chave', async () => {
    await acervoService.getStorageGrowthTrends(6);
    await acervoService.getStorageGrowthTrends(12);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  test('invalidarDashboard faz a proxima chamada bater na API de novo', async () => {
    await acervoService.getProdutosTotal();
    acervoService.invalidarDashboard();
    await acervoService.getProdutosTotal();
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});

describe('acervo-service: exportacoes', () => {
  test('as duas exportacoes tem endpoint e nome de arquivo', () => {
    expect(acervoService.EXPORTACOES_ACERVO).toHaveLength(2);
    const endpoints = acervoService.EXPORTACOES_ACERVO.map(e => e.endpoint);
    expect(endpoints).toEqual(['/acervo/export-planilha-csv', '/acervo/situacao-geral']);
    for (const item of acervoService.EXPORTACOES_ACERVO) {
      expect(item.label).toBeTruthy();
      expect(item.filename.endsWith('.zip')).toBe(true);
    }
  });
});
