import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mocka o api-client: cada wrapper do service deve chamar apiGet/Post/Put/Delete
// com o metodo HTTP e a URL corretos (incluindo a query string).
//
// A fusao com o SCA NAO mexeu nas rotas da mapoteca: elas seguem
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
    // A lista de pedidos é do ANO: ela respeita o contexto do módulo.
    await svc.getPedidos(2026);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/pedido?ano=2026');

    await svc.getPedido(9);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/pedido/9');

    await svc.deletePedidos([9]);
    expect(apiDelete).toHaveBeenCalledWith('/mapoteca/pedido', { pedido_ids: [9] });
  });

  // A ROTA DA SITUACAO E OUTRA, e o caminho e o que fecha a cadeia entre o
  // dialogo da lista e o servidor: '/mapoteca/pedido' aqui reescreveria a linha
  // inteira do pedido, que e exatamente o que esta funcao existe para evitar.
  test('updateSituacaoPedido bate no sufixo /situacao, com o id na URL', async () => {
    await svc.updateSituacaoPedido(192, { situacao_pedido_id: 8 });
    expect(apiPut).toHaveBeenCalledWith('/mapoteca/pedido/192/situacao', {
      situacao_pedido_id: 8,
    });
    // O PUT do pedido inteiro nao e chamado por tabela nenhuma daqui.
    expect(apiPut).toHaveBeenCalledTimes(1);
  });

  // A busca por etiqueta e do SERVIDOR: ela usa o indice GIN de
  // `mapoteca.pedido.palavras_chave`, e filtrar aqui, sobre a lista ja baixada,
  // daria a busca "por pedaco" que o campo nao promete.
  test('getPedidos manda a palavra-chave na query, escapada', async () => {
    await svc.getPedidos(2026, 'Extra-PIT');
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/pedido?ano=2026&palavra_chave=Extra-PIT');

    await svc.getPedidos(2026, 'Mapeamento Sistemático');
    expect(apiGet).toHaveBeenCalledWith(
      '/mapoteca/pedido?ano=2026&palavra_chave=Mapeamento%20Sistem%C3%A1tico'
    );
  });

  // A chave de cache tem de carregar a etiqueta: sem ela, buscar 'Extra-PIT'
  // depois de abrir o ano devolveria a lista inteira, servida do cache.
  test('a etiqueta entra na chave de cache, e nao serve a busca anterior', async () => {
    apiGet.mockClear();

    await svc.getPedidos(2030);
    await svc.getPedidos(2030, 'Extra-PIT');
    await svc.getPedidos(2030, 'Adestramento');
    // A repetida sai do cache, e nao paga a requisicao de novo.
    await svc.getPedidos(2030, 'Extra-PIT');

    expect(apiGet).toHaveBeenCalledTimes(3);
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

  test('registrarImpressao leva a data quando ela vem', async () => {
    // A data e opcional: sem ela o servidor grava agora. COM ela, registrar na
    // segunda o que saiu na sexta conta na sexta, e o consumo de papel cai no
    // mes certo do RPCMTec.
    await svc.registrarImpressao([
      { produto_pedido_id: 4, quantidade: 2, data_impressao: '2026-07-31' },
    ]);
    expect(apiPost).toHaveBeenCalledWith('/mapoteca/impressao', {
      registros: [{ produto_pedido_id: 4, quantidade: 2, data_impressao: '2026-07-31' }],
    });
  });

  test('corrigirDataImpressao e PUT numa rota propria, com motivo', async () => {
    // Rota separada, e nao um campo do POST: no servidor ela e GERENTE, enquanto
    // registrar e operador. O motivo e obrigatorio e vai para a auditoria.
    await svc.corrigirDataImpressao(12, { data_impressao: '2026-07-31', motivo: 'lancado no dia errado' });
    expect(apiPut).toHaveBeenCalledWith('/mapoteca/impressao/12/data', {
      data_impressao: '2026-07-31',
      motivo: 'lancado no dia errado',
    });
  });

  // A ETIQUETA NAO TEM CACHE na leitura (o diálogo só libera o Imprimir quando a
  // tela bate com o SALVO), e a GRAVACAO derruba o cache da LISTA de pedidos: a
  // coluna CEP dela sai de `mapoteca.etiqueta_envio`, e sem isto o CEP corrigido
  // levava até cinco minutos para aparecer, com a busca por ele sem achar nada.
  test('a etiqueta le sem cache e a gravacao derruba a lista de pedidos', async () => {
    await svc.getEtiquetaEnvio(42);
    await svc.getEtiquetaEnvio(42);
    expect(apiGet).toHaveBeenCalledTimes(2);

    apiGet.mockClear();
    await svc.getPedidos(2026);
    expect(apiGet).toHaveBeenCalledTimes(1);
    // Servida do cache: prova que a chave estava guardada.
    await svc.getPedidos(2026);
    expect(apiGet).toHaveBeenCalledTimes(1);

    await svc.salvarEtiquetaEnvio(42, { destinatario: '18º BI Mtz', cep: '90850-240' });
    expect(apiPut).toHaveBeenCalledWith('/mapoteca/pedido/42/etiqueta', {
      destinatario: '18º BI Mtz', cep: '90850-240',
    });

    await svc.getPedidos(2026);
    expect(apiGet).toHaveBeenCalledTimes(2);
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

describe('mapoteca-service: insumos, estoque e o livro de movimentos', () => {
  test('tipo_material e a leitura do estoque', async () => {
    await svc.getTiposMaterial();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/tipo_material');

    await svc.getEstoqueMaterial();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/estoque_material');
  });

  // A PODA DAS ROTAS DE ESCRITA DE ESTOQUE, de 2026-08-08. As quatro sairam do
  // servidor, e uma funcao sobrevivente aqui produziria 404 no clique -- ou, pior,
  // voltaria a existir junto com a rota e faria a soma do livro deixar de bater
  // com o saldo. O saldo e o acumulado do livro, e nao ha segunda porta.
  test('o service NAO tem mais escrita de estoque', () => {
    expect(svc.createEstoqueMaterial).toBeUndefined();
    expect(svc.updateEstoqueMaterial).toBeUndefined();
    expect(svc.deleteEstoqueMaterial).toBeUndefined();
    expect(svc.transferirEstoque).toBeUndefined();
  });

  // `consumo_material` virou UM dos quatro tipos do livro. A rota inteira sumiu.
  test('o service NAO fala mais em consumo_material', () => {
    expect(svc.getConsumoMaterial).toBeUndefined();
    expect(svc.createConsumoMaterial).toBeUndefined();
    expect(svc.updateConsumoMaterial).toBeUndefined();
    expect(svc.deleteConsumoMaterial).toBeUndefined();
  });

  test('getMovimentosMaterial monta a query so com o filtro preenchido', async () => {
    await svc.getMovimentosMaterial();
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/movimento_material');

    await svc.getMovimentosMaterial({
      data_inicio: '2026-01-01', tipo_material_id: 3, tipo_movimento_id: 3,
    });
    expect(apiGet).toHaveBeenCalledWith(
      '/mapoteca/movimento_material?data_inicio=2026-01-01&tipo_material_id=3&tipo_movimento_id=3'
    );
  });

  test('as tres mutacoes do livro batem na rota do livro', async () => {
    const movimento = {
      tipo_material_id: 1,
      tipo_movimento_id: 3,
      quantidade: 2,
      data_movimento: '2026-08-08',
      localizacao_origem_id: 1,
      localizacao_destino_id: null,
      motivo: null,
    };
    await svc.createMovimentoMaterial(movimento);
    expect(apiPost).toHaveBeenCalledWith('/mapoteca/movimento_material', movimento);

    await svc.updateMovimentoMaterial({ id: 9, ...movimento });
    expect(apiPut).toHaveBeenCalledWith('/mapoteca/movimento_material', { id: 9, ...movimento });

    await svc.deleteMovimentosMaterial([9]);
    expect(apiDelete).toHaveBeenCalledWith('/mapoteca/movimento_material', {
      movimento_material_ids: [9],
    });
  });

  test('getConsumoMensal usa o ano pedido', async () => {
    await svc.getConsumoMensal(2025);
    expect(apiGet).toHaveBeenCalledWith('/mapoteca/consumo_mensal?ano=2025');
  });
});

describe('mapoteca-service: relatorios', () => {
  // O RPCMTec não tem função aqui: o relatório é da Divisão inteira e mora em
  // @services/rpcmtec-service.js. O caso é o inverso do comum, e guarda contra
  // alguém trazer o relatório de volta para dentro da mapoteca.
  test('o service da mapoteca NAO expoe mais nada de RPCMTec', () => {
    const doRpcmtec = Object.keys(svc).filter(k => /rpcmtec/i.test(k));
    expect(doRpcmtec).toEqual([]);
  });

  // A aba META4_DETALHADA do RTM não sai deste service, e sim da tela do
  // RPCMTec, onde ela é baixada junto do Anuário e do DOCX e respeita o MÊS
  // escolhido. A ROTA `/mapoteca/relatorio/impressao_detalhada_ods` continua no
  // servidor, anual, para agente e CLI: o que saiu foi o caminho do CLIENT.
  test('a aba META4 do RTM nao sai mais deste service', () => {
    expect(svc.downloadMeta4Ods).toBeUndefined();
    expect(svc.downloadMeta4Csv).toBeUndefined();
  });
});

describe('mapoteca-service: dashboard', () => {
  test('cada painel bate em /mapoteca/dashboard', async () => {
    // As métricas de PEDIDO são por ano, contadas pela data do pedido. Não há
    // janela deslizante ("últimos 6 meses"): ela não respeitaria o ano.
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

// Exportações do service que NÃO batem numa rota quando chamadas com
// `(1, {})`: `downloadDashboardCsv` monta a URL e delega, `uploadAnexoPedido`
// precisa de um File de verdade, e `invalidateDashboardCache` só mexe no cache
// em memória. Nomeadas de propósito, para função nova não sumir da varredura.
const SEM_ROTA_PROPRIA = [
  'downloadDashboardCsv', 'invalidateDashboardCache', 'uploadAnexoPedido',
];

describe('mapoteca-service: nenhum caminho escapa do namespace', () => {
  test('toda rota e /mapoteca/... ou o /relatorio do RPCMTec', async () => {
    // Toda funcao exportada e chamada com argumentos inofensivos; o api-client
    // esta mockado, entao nada sai para a rede. O que importa e o 1o argumento.
    const espioes = [apiGet, apiPost, apiPut, apiDelete, apiDownload];
    const totalDeChamadas = () => espioes.reduce((s, e) => s + e.mock.calls.length, 0);

    const funcoes = Object.entries(svc).filter(([, v]) => typeof v === 'function');
    const explodiram = [];
    const semRota = [];
    for (const [nome, fn] of funcoes) {
      const antes = totalDeChamadas();
      try {
        const r = fn(1, {});
        if (r && typeof r.catch === 'function') await r.catch(() => {});
      } catch (err) {
        explodiram.push(`${nome}: ${err.message}`);
      }
      if (totalDeChamadas() === antes) semRota.push(nome);
    }
    // Engolir a exceção em silêncio tiraria a função que quebrou da varredura, e
    // o caso seguiria verde justamente por causa do defeito.
    expect(explodiram).toEqual([]);
    // Toda função exportada bate em UMA rota. As poucas que não batem ficam
    // nomeadas aqui: função nova que não chega ao servidor cai neste ponto, em
    // vez de sumir da varredura sem aviso.
    expect(semRota).toEqual(SEM_ROTA_PROPRIA);

    const caminhos = espioes.flatMap(spy => spy.mock.calls.map(args => args[0]));
    expect(caminhos).toHaveLength(funcoes.length - SEM_ROTA_PROPRIA.length);
    for (const caminho of caminhos) {
      expect(
        caminho.startsWith('/mapoteca/') || caminho.startsWith('/relatorio/rpcmtec')
      ).toBe(true);
    }
  });
});
