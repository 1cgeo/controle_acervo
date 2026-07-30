// Fabricas de mock dos services do modulo mapoteca, para os testes das paginas.
//
// POR QUE EXISTE: `vi.mock` troca o MODULO INTEIRO. Uma pagina que importa um
// nome fora da fabrica quebra com "No X export is defined on the mock". Manter
// a lista num lugar so evita repetir 75 nomes em cada arquivo de teste e evita
// o teste vermelho quando o service ganha uma funcao nova.
//
// Uso num teste:
//
//   vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
//     const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
//     return mockMapotecaService();
//   });
//
//   import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
//   svc.getClientes.mockResolvedValue([{ id: 1, nome: '1º CGEO' }]);
//
// Este arquivo NAO entra no bundle: so os testes o importam.
import { vi } from 'vitest';

/** Leituras que devolvem lista. O default e `[]`. */
const LISTAS = [
  'getDominioTipoCliente', 'getDominioSituacaoPedido', 'getDominioCanalRecebimento',
  'getDominioTipoMidia', 'getDominioTipoLocalizacao', 'getDominioFormaEntrega',
  'getClientes', 'getPedidos', 'getPlotters', 'getManutencoes', 'getTiposMaterial',
  'getEstoqueMaterial', 'getEstoquePorLocalizacao', 'getConsumoMaterial',
  'getConsumoMensal', 'getOrdersTimeline', 'getClientActivity',
  'getPendingOrders', 'getStockByLocation', 'getEntregasPorTipoProduto',
  'getEntregasPorMidia', 'getOperacoesApoiadas', 'getEntregasPorMes',
  'getAnexosPedido', 'uploadAnexoPedido', 'getAnosMapoteca',
  'getProdutosAvulsos', 'getReconciliacaoAvulsos',
];

/** Leituras que devolvem objeto. O default e `{}`. */
const OBJETOS = [
  'getCliente', 'getPedido', 'getPedidoPorLocalizador', 'getPlotter', 'getManutencao',
  'getTipoMaterial', 'getEstoqueMaterialItem', 'getConsumoMaterialItem',
  'getImpressaoItem', 'getOrderStatus', 'getAvgFulfillmentTime',
  'getMaterialConsumption', 'getPlotterStatus', 'getResumoAnual', 'getRpcmtecAcervo',
];

/** Mutacoes e downloads. O default e `null`. */
const ACOES = [
  'createCliente', 'updateCliente', 'deleteClientes',
  'createPedido', 'updatePedido', 'deletePedidos',
  'createProdutoPedido', 'updateProdutoPedido', 'deleteProdutosPedido',
  'prepararDownloadImpressao', 'registrarImpressao', 'deleteImpressoes',
  'createPlotter', 'updatePlotter', 'deletePlotters',
  'createManutencao', 'updateManutencao', 'deleteManutencoes',
  'createProdutoAvulso', 'updateProdutoAvulso', 'deleteProdutosAvulsos',
  'createTipoMaterial', 'updateTipoMaterial', 'deleteTiposMaterial',
  'createEstoqueMaterial', 'updateEstoqueMaterial', 'deleteEstoqueMaterial',
  'transferirEstoque',
  'createConsumoMaterial', 'updateConsumoMaterial', 'deleteConsumoMaterial',
  'downloadRpcmtecDocx', 'downloadDashboardCsv',
  'downloadMeta4Ods',
  'getPedidosEmAberto', 'getImpressaoDoPedido', 'baixarCartaDoPedido',
  'downloadAnexoPedido', 'deleteAnexoPedido',
];

function preencher(alvo, nomes, valor) {
  for (const nome of nomes) {
    alvo[nome] = vi.fn(() => Promise.resolve(typeof valor === 'function' ? valor() : valor));
  }
}

/**
 * Mock completo de mapoteca-service.js, com um default inofensivo por funcao.
 * Nenhuma chamada sai para a rede: NENHUM teste escreve no servidor real.
 * @returns {Object} - o objeto de modulo para devolver na fabrica do vi.mock
 */
export function mockMapotecaService() {
  const mock = {};
  preencher(mock, LISTAS, () => []);
  preencher(mock, OBJETOS, () => ({}));
  preencher(mock, ACOES, null);
  // Envelope proprio: o mapa das entregas le `dados` e os totais, e um `{}` ou
  // um `[]` fariam a aba quebrar no primeiro acesso em vez de nascer vazia.
  mock.getEntregasGeo = vi.fn(() => Promise.resolve({
    ano: new Date().getFullYear(),
    filtrado: false,
    total_produtos: 0,
    total_ano: 0,
    sem_geometria: 0,
    dados: [],
  }));
  mock.getEntregasFiltros = vi.fn(() => Promise.resolve({
    ano: new Date().getFullYear(),
    tipos_produto: [],
    escalas: [],
    clientes: [],
  }));
  // Sincronas: nao devolvem promessa.
  mock.invalidateDashboardCache = vi.fn();
  return mock;
}

/**
 * Mock de acervo-service.js (busca no catalogo, usada pelo wizard de pedido).
 * @returns {Object}
 */
export function mockAcervoService() {
  return {
    buscarProdutos: vi.fn(() => Promise.resolve({ total: 0, page: 1, limit: 20, dados: [] })),
    getProdutoDetalhado: vi.fn(() => Promise.resolve({ versoes: [] })),
    getTiposProduto: vi.fn(() => Promise.resolve([])),
    getTiposEscala: vi.fn(() => Promise.resolve([])),
  };
}
