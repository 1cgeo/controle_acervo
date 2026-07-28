import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mocka o api-client: cada wrapper do service deve chamar apiGet/Post/Put/Delete
// com o metodo HTTP e a URL corretos (incluindo a query string).
//
// A fusao com o SCA (2026-07-27) NAO mexeu nas rotas da mapoteca: elas seguem
// em '/mapoteca/...' e '/mapoteca/dashboard/...'. Estes testes fazem isso
// cumprir. Um prefixo a mais (ex.: '/mapoteca/mapoteca/pedido') cairia em 404.
vi.mock('@services/api-client.js', () => ({
  apiGet: vi.fn(() => Promise.resolve(null)),
  apiPost: vi.fn(() => Promise.resolve(null)),
  apiPut: vi.fn(() => Promise.resolve(null)),
  apiDelete: vi.fn(() => Promise.resolve(null)),
  apiDownload: vi.fn(() => Promise.resolve(null)),
  apiUpload: vi.fn(() => Promise.resolve(null)),
}));

import { apiGet, apiPost, apiPut, apiDelete, apiDownload } from '@services/api-client.js';
import { clearCache } from '@services/cache.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

// A leitura passa pelo cache em memoria. Sem limpar, o 2o teste que le a mesma
// chave devolveria o valor guardado e o apiGet nem seria chamado.
beforeEach(() => {
  clearCache();
  vi.clearAllMocks();
});

describe('mapoteca-service: dominios', () => {
  test('cada dominio bate no seu caminho', async () => {
    await svc.getDominioTipoCliente();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dominio/tipo_cliente');

    await svc.getDominioSituacaoPedido();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dominio/situacao_pedido');

    await svc.getDominioCanalRecebimento();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dominio/canal_recebimento');

    await svc.getDominioTipoMidia();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dominio/tipo_midia');

    await svc.getDominioTipoLocalizacao();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dominio/tipo_localizacao');

    await svc.getDominioFormaEntrega();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dominio/forma_entrega');
  });
});

describe('mapoteca-service: clientes e pedidos', () => {
  test('getClientes e getCliente', async () => {
    await svc.getClientes();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/cliente');

    await svc.getCliente(12);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/cliente/12');
  });

  test('createCliente e updateCliente mandam o corpo', async () => {
    await svc.createCliente({ nome: '1º CGEO', tipo_cliente_id: 1 });
    expect(apiPost).toHaveBeenCalledWith('/mapoteca/cliente', { nome: '1º CGEO', tipo_cliente_id: 1 });

    await svc.updateCliente({ id: 3, nome: 'CMS' });
    expect(apiPut).toHaveBeenCalledWith('/mapoteca/cliente', { id: 3, nome: 'CMS' });
  });

  test('deleteClientes manda os ids no corpo', async () => {
    await svc.deleteClientes([1, 2]);
    expect(apiDelete).toHaveBeenCalledWith('/mapoteca/cliente', { cliente_ids: [1, 2] });
  });

  test('getPedidos, getPedido e deletePedidos', async () => {
    // Do ANO: a lista passou a respeitar o contexto do modulo em 2026-07-28.
    await svc.getPedidos(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/pedido?ano=2026');

    await svc.getPedido(9);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/pedido/9');

    await svc.deletePedidos([9]);
    expect(apiDelete).toHaveBeenCalledWith('/mapoteca/pedido', { pedido_ids: [9] });
  });

  test('getPedidoPorLocalizador escapa o codigo na URL', async () => {
    await svc.getPedidoPorLocalizador('AB12-CD34-EF56');
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/pedido/localizador/AB12-CD34-EF56');
  });

  test('produto_pedido e impressao', async () => {
    await svc.createProdutoPedido({ uuid_versao: 'u', pedido_id: 1, quantidade: 2, tipo_midia_id: 1 });
    expect(apiPost).toHaveBeenCalledWith('/mapoteca/produto_pedido', {
      uuid_versao: 'u', pedido_id: 1, quantidade: 2, tipo_midia_id: 1,
    });

    await svc.deleteProdutosPedido([4]);
    expect(apiDelete).toHaveBeenCalledWith('/mapoteca/produto_pedido', { produto_pedido_ids: [4] });

    await svc.registrarImpressao([{ produto_pedido_id: 4, quantidade: 2 }]);
    expect(apiPost).toHaveBeenCalledWith('/mapoteca/impressao', {
      registros: [{ produto_pedido_id: 4, quantidade: 2 }],
    });

    await svc.getImpressaoItem(4);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/produto_pedido/4/impressao');
  });

  test('anexos do pedido', async () => {
    await svc.getAnexosPedido(7);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/pedido/7/anexos');

    await svc.downloadAnexoPedido(3, 'diex.pdf');
    expect(apiDownload).toHaveBeenCalledWith('/mapoteca/pedido/anexo/3/download', 'diex.pdf');

    await svc.deleteAnexoPedido(3);
    expect(apiDelete).toHaveBeenCalledWith('/mapoteca/pedido/anexo/3');
  });
});

describe('mapoteca-service: material, estoque e consumo', () => {
  test('tipo_material e estoque', async () => {
    await svc.getTiposMaterial();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/tipo_material');

    await svc.getEstoqueMaterial();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/estoque_material');

    await svc.getEstoquePorLocalizacao();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/estoque_por_localizacao');

    await svc.transferirEstoque({ tipo_material_id: 1, origem_id: 1, destino_id: 2, quantidade: 5 });
    expect(apiPost).toHaveBeenCalledWith('/mapoteca/estoque_material/transferir', {
      tipo_material_id: 1, origem_id: 1, destino_id: 2, quantidade: 5,
    });
  });

  test('getConsumoMaterial monta a query so com o filtro preenchido', async () => {
    await svc.getConsumoMaterial();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/consumo_material');

    await svc.getConsumoMaterial({ data_inicio: '2026-01-01', tipo_material_id: 3 });
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/consumo_material?data_inicio=2026-01-01&tipo_material_id=3');
  });

  test('getConsumoMensal usa o ano pedido', async () => {
    await svc.getConsumoMensal(2025);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/consumo_mensal?ano=2025');
  });
});

describe('mapoteca-service: relatorios', () => {


  test('o RPCMTec fica FORA de /mapoteca: e a rota do acervo', async () => {
    await svc.getRpcmtecAcervo({ ano: 2026, mes: 6 });
    expect(apiGet).toHaveBeenCalledWith('/relatorio/rpcmtec?ano=2026&mes=6');

    await svc.downloadRpcmtecDocx({ ano: 2026, mes: 6 });
    expect(apiDownload).toHaveBeenCalledWith(
      '/relatorio/rpcmtec/docx?ano=2026&mes=6',
      'RPCMTec-acervo-2026-06.docx'
    );
  });
});

describe('mapoteca-service: dashboard', () => {
  test('cada painel bate em /mapoteca/dashboard', async () => {
    // As metricas de PEDIDO passaram a ser por ano em 2026-07-28, contadas pela
    // data do pedido. A janela deslizante ("ultimos 6 meses") saiu junto: ela
    // nao tem como respeitar um ano de contexto.
    await svc.getOrderStatus(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/order_status?ano=2026');

    await svc.getOrdersTimeline(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/orders_timeline?ano=2026');

    await svc.getAvgFulfillmentTime(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/avg_fulfillment_time?ano=2026');

    await svc.getClientActivity(10, 2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/client_activity?limite=10&ano=2026');

    await svc.getMaterialConsumption(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/material_consumption?ano=2026');

    // O estoque e o unico que NAO leva ano: e o saldo de hoje.
    await svc.getStockByLocation();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/stock_by_location');

    await svc.getResumoAnual(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/resumo_anual?ano=2026');

    await svc.getEntregasPorMes(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/entregas_por_mes?ano=2026');
  });

  test('o mapa das entregas leva os filtros na query, e omite os vazios', async () => {
    await svc.getEntregasGeo(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/entregas_geo?ano=2026');

    await svc.getEntregasGeo(2026, { cliente_id: 38 });
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/entregas_geo?ano=2026&cliente_id=38');

    await svc.getEntregasGeo(2026, { tipo_produto_id: 2, escala: '1:50.000', cliente_id: null });
    expect(apiGet).toHaveBeenCalledWith(
      '/mapoteca/dashboard/entregas_geo?ano=2026&tipo_produto_id=2&escala=1%3A50.000'
    );

    await svc.getEntregasFiltros(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/entregas_filtros?ano=2026');

    // As opcoes tambem levam os filtros: e o servidor que cruza o quantitativo
    // de cada uma pelos OUTROS filtros ativos.
    await svc.getEntregasFiltros(2026, { cliente_id: 38 });
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/dashboard/entregas_filtros?ano=2026&cliente_id=38');
  });

  // Sem os filtros na CHAVE do cache, trocar de OM devolveria por um minuto o
  // recorte da OM anterior, com o mapa parado e o resumo mentindo.
  test('os filtros entram na chave de cache, e nao so na URL', async () => {
    await svc.getEntregasGeo(2026, { cliente_id: 38 });
    await svc.getEntregasGeo(2026, { cliente_id: 5 });
    expect(apiGet).toHaveBeenCalledTimes(2);

    // A mesma combinação, essa sim, sai do cache.
    await svc.getEntregasGeo(2026, { cliente_id: 5 });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  test('downloadDashboardCsv recusa um dataset sem CSV', async () => {
    await expect(svc.downloadDashboardCsv('order_status', 2026)).rejects.toThrow(/Exportação CSV indisponível/);
    expect(apiDownload).not.toHaveBeenCalled();
  });
});

describe('mapoteca-service: cache', () => {
  test('a segunda leitura da mesma chave sai do cache', async () => {
    await svc.getClientes();
    await svc.getClientes();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test('a mutacao invalida o cache da lista', async () => {
    await svc.getClientes();
    await svc.createCliente({ nome: 'x', tipo_cliente_id: 1 });
    await svc.getClientes();
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});

describe('mapoteca-service: nenhum caminho escapa do namespace', () => {
  test('toda rota e /mapoteca/... ou o /relatorio do RPCMTec', async () => {
    // Toda funcao exportada e chamada com argumentos inofensivos; o api-client
    // esta mockado, entao nada sai para a rede. O que importa e o 1o argumento.
    for (const fn of Object.values(svc)) {
      if (typeof fn !== 'function') continue;
      try {
        const r = fn(1, {});
        if (r && typeof r.catch === 'function') await r.catch(() => {});
      } catch {
        continue;
      }
    }
    const caminhos = [apiGet, apiPost, apiPut, apiDelete, apiDownload]
      .flatMap(spy => spy.mock.calls.map(args => args[0]));

    expect(caminhos.length).toBeGreaterThan(20);
    for (const caminho of caminhos) {
      expect(
        caminho.startsWith('/mapoteca/') || caminho.startsWith('/relatorio/rpcmtec')
      ).toBe(true);
    }
  });
});
