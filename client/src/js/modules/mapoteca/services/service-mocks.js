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
  'getDominioTipoMidia', 'getDominioFormaEntrega',
  'getClientes', 'getPedidos', 'getTiposMaterial',
  'getEstoqueMaterial', 'getMovimentosMaterial',
  'getConsumoMensal', 'getOrdersTimeline', 'getClientActivity',
  'getPendingOrders', 'getStockByLocation', 'getEntregasPorTipoProduto',
  'getEntregasPorMidia', 'getOperacoesApoiadas', 'getEntregasPorMes',
  'getAnexosPedido', 'uploadAnexoPedido', 'getAnosMapoteca',
  // A lista de etiquetas que a busca e o cadastro sugerem. Entra aqui como
  // LISTA, e o default `[]` importa: as duas telas a chamam soltas, com `catch`
  // proprio, e um mock que devolvesse `undefined` quebraria o `.map` delas.
  'getPalavrasChave',
];

/** Leituras que devolvem objeto. O default e `{}`. */
const OBJETOS = [
  'getCliente', 'getPedido', 'getPedidoPorLocalizador', 'getTipoMaterial',
  'getImpressaoItem', 'getOrderStatus', 'getAvgFulfillmentTime',
  'getMaterialConsumption', 'getResumoAnual',
];

/** Mutacoes e downloads. O default e `null`. */
const ACOES = [
  'createCliente', 'updateCliente', 'deleteClientes',
  'createPedido', 'updatePedido', 'updateSituacaoPedido', 'deletePedidos',
  'createProdutoPedido', 'createProdutosPedido', 'updateProdutoPedido', 'deleteProdutosPedido',
  'registrarImpressao', 'corrigirDataImpressao', 'deleteImpressoes',
  'createTipoMaterial', 'updateTipoMaterial', 'deleteTiposMaterial',
  // O estoque nao tem mutacao: o saldo e o acumulado do LIVRO, e quem o move e
  // um movimento.
  'createMovimentoMaterial', 'updateMovimentoMaterial', 'deleteMovimentosMaterial',
  'downloadDashboardCsv',
  'getPedidosEmAberto', 'getImpressaoDoPedido', 'baixarCartaDoPedido',
  'downloadAnexoPedido', 'deleteAnexoPedido',
  // getEtiquetaEnvio e leitura, mas entra aqui e nao em OBJETOS porque o default
  // `null` e o VERDADEIRO: pedido sem etiqueta salva devolve null. Um `{}` por
  // default faria o teste ver "etiqueta salva vazia" e apagar a tela.
  'salvarEtiquetaEnvio', 'getEtiquetaEnvio',
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
 * Mock de plataforma-service.js, que o pedido usa porque a
 * meta do PIT saiu do modulo orcamento e virou dado de plataforma.
 *
 * As duas funcoes de ROTULO nao sao mockadas, e sim reexportadas de verdade:
 * elas sao puras, nao tocam a rede, e um mock delas so faria o teste conferir a
 * propria fabrica em vez do texto que a tela mostra.
 * @returns {Object}
 */
export async function mockPlataformaService() {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    getMetasPit: vi.fn(() => Promise.resolve([])),
    getAnosMetaPit: vi.fn(() => Promise.resolve([])),
    getMetaPit: vi.fn(() => Promise.resolve({})),
    createMetaPit: vi.fn(() => Promise.resolve(null)),
    updateMetaPit: vi.fn(() => Promise.resolve(null)),
    deleteMetaPit: vi.fn(() => Promise.resolve(null)),
    getUsuarios: vi.fn(() => Promise.resolve([])),
    criarUsuario: vi.fn(() => Promise.resolve({ uuid: 'u-novo' })),
    atualizarUsuario: vi.fn(() => Promise.resolve(null)),
    excluirUsuario: vi.fn(() => Promise.resolve(null)),
    resetarSenhas: vi.fn(() => Promise.resolve({ total: 1 })),
    getModulos: vi.fn(() => Promise.resolve([])),
    getTiposPerfil: vi.fn(() => Promise.resolve([])),
    getPostosGrad: vi.fn(() => Promise.resolve([])),
    getMeuPerfil: vi.fn(() => Promise.resolve({})),
    atualizarMeuPerfil: vi.fn(() => Promise.resolve(null)),
    alterarMinhaSenha: vi.fn(() => Promise.resolve(null)),
    codigoMetaPit: real.codigoMetaPit,
    rotuloMetaPit: real.rotuloMetaPit,
  };
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
