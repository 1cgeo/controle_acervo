import { apiGet, apiPost, apiPut, apiDelete, apiDownload, apiUpload } from '@services/api-client.js';
import { cachedFetch, invalidate, TTL_DOMINIO, TTL_LISTA, TTL_DASHBOARD } from '@services/cache.js';

/**
 * Camada de servico do modulo MAPOTECA: uma funcao por endpoint do backend.
 * Todas devolvem o payload `dados` (o api-client ja desembrulha o envelope).
 *
 * PREFIXO: a fusao com o SCA (2026-07-27) NAO mexeu nas rotas da mapoteca. Elas
 * seguem em '/mapoteca/...' e '/mapoteca/dashboard/...', como em
 * server/src/routes.js. So o orcamento ganhou prefixo, porque os nomes dele
 * colidiam com os do acervo. As rotas de PLATAFORMA ('/login', '/usuarios')
 * moram em '@services/plataforma-service.js'.
 *
 * Leitura entra em cache (dominio 30 min, lista 5 min, dashboard 1 min); toda
 * mutacao invalida os prefixos de cache relacionados.
 */

const BASE = '/mapoteca';

// ---------------------------------------------------------------------------
// Domínios (públicos, cache 30 min)
// ---------------------------------------------------------------------------

/** @returns {Promise<Array<{code:number, nome:string}>>} */
export function getDominioTipoCliente() {
  return cachedFetch('dominio:tipo_cliente', () => apiGet(`${BASE}/dominio/tipo_cliente`), TTL_DOMINIO);
}

/** @returns {Promise<Array<{code:number, nome:string}>>} */
export function getDominioSituacaoPedido() {
  return cachedFetch('dominio:situacao_pedido', () => apiGet(`${BASE}/dominio/situacao_pedido`), TTL_DOMINIO);
}

/** @returns {Promise<Array<{code:number, nome:string}>>} */
export function getDominioCanalRecebimento() {
  return cachedFetch('dominio:canal_recebimento', () => apiGet(`${BASE}/dominio/canal_recebimento`), TTL_DOMINIO);
}

export function getDominioTipoMidia() {
  return cachedFetch('dominio:tipo_midia', () => apiGet(`${BASE}/dominio/tipo_midia`), TTL_DOMINIO);
}

/** @returns {Promise<Array<{code:number, nome:string}>>} */
export function getDominioTipoLocalizacao() {
  return cachedFetch('dominio:tipo_localizacao', () => apiGet(`${BASE}/dominio/tipo_localizacao`), TTL_DOMINIO);
}

/** @returns {Promise<Array<{code:number, nome:string}>>} */
export function getDominioFormaEntrega() {
  return cachedFetch('dominio:forma_entrega', () => apiGet(`${BASE}/dominio/forma_entrega`), TTL_DOMINIO);
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

/** All clients with order statistics. */
export function getClientes() {
  return cachedFetch('clientes:list', () => apiGet(`${BASE}/cliente`), TTL_LISTA);
}

/** Client details with order history and statistics. */
export function getCliente(id) {
  return cachedFetch(`clientes:item:${id}`, () => apiGet(`${BASE}/cliente/${id}`), TTL_LISTA);
}

/** @param {{nome:string, tipo_cliente_id:number, ponto_contato_principal?:string, endereco_entrega_principal?:string}} cliente */
export function createCliente(cliente) {
  invalidate('clientes');
  return apiPost(`${BASE}/cliente`, cliente);
}

/** Same payload as createCliente plus `id`. */
export function updateCliente(cliente) {
  invalidate('clientes');
  return apiPut(`${BASE}/cliente`, cliente);
}

/** @param {number[]} ids */
export function deleteClientes(ids) {
  invalidate('clientes');
  invalidate('pedidos');
  invalidate('dashboard');
  return apiDelete(`${BASE}/cliente`, { cliente_ids: ids });
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

/**
 * Pedidos do ANO, com cliente, contagem de produtos e `itens_impressos`.
 * @param {number} ano
 */
export function getPedidos(ano) {
  // Por ANO, e a chave de cache junto: voltar ao ano anterior nao paga a busca
  // de novo, e `invalidate('pedidos')` continua limpando todos, porque a
  // invalidacao e por prefixo.
  return cachedFetch(`pedidos:list:${ano}`, () => apiGet(`${BASE}/pedido?ano=${ano}`), TTL_LISTA);
}

/**
 * Full order details: items (with quantidade_impressa/quantidade_restante/
 * impressao_concluida), resumo `impressao` and audit trail.
 */
export function getPedido(id) {
  return cachedFetch(`pedidos:item:${id}`, () => apiGet(`${BASE}/pedido/${id}`), TTL_LISTA);
}

/**
 * Public tracking lookup (no auth). Not cached.
 * @param {string} localizador - format XXXX-XXXX-XXXX
 */
export function getPedidoPorLocalizador(localizador) {
  return apiGet(`${BASE}/pedido/localizador/${encodeURIComponent(localizador)}`);
}

/**
 * Create order. Returns { id, localizador_pedido }.
 * RN02: situacao 5 requires data_atendimento; RN03: situacao 6 requires motivo_cancelamento.
 */
export function createPedido(pedido) {
  invalidate('pedidos');
  invalidate('clientes');
  invalidate('dashboard');
  return apiPost(`${BASE}/pedido`, pedido);
}

/** Same payload as createPedido plus `id` (localizador é imutável). */
export function updatePedido(pedido) {
  invalidate('pedidos');
  invalidate('clientes');
  invalidate('dashboard');
  return apiPut(`${BASE}/pedido`, pedido);
}

/** @param {number[]} ids */
export function deletePedidos(ids) {
  invalidate('pedidos');
  invalidate('clientes');
  invalidate('dashboard');
  return apiDelete(`${BASE}/pedido`, { pedido_ids: ids });
}

// ---------------------------------------------------------------------------
// Produtos do pedido (itens)
// ---------------------------------------------------------------------------

/**
 * Add an item to an order. `uuid_versao` is required (RN08 — no loose items).
 * @param {{uuid_versao:string, pedido_id:number, quantidade:number, tipo_midia_id:number,
 *   producao_especifica?:boolean, quantidade_fornecida?:number, tipo_midia_fornecida_id?:number,
 *   forma_entrega_id?:number, data_entrega?:string, observacao?:string}} item
 */
export function createProdutoPedido(item) {
  invalidate('pedidos');
  invalidate('dashboard');
  return apiPost(`${BASE}/produto_pedido`, item);
}

/** Same payload as createProdutoPedido plus `id`. */
export function updateProdutoPedido(item) {
  invalidate('pedidos');
  invalidate('dashboard');
  return apiPut(`${BASE}/produto_pedido`, item);
}

/** @param {number[]} ids */
export function deleteProdutosPedido(ids) {
  invalidate('pedidos');
  invalidate('dashboard');
  return apiDelete(`${BASE}/produto_pedido`, { produto_pedido_ids: ids });
}

// ---------------------------------------------------------------------------
// Impressão (log operacional)
// ---------------------------------------------------------------------------

/** Prepare PDFs download for printing an order (creates download tokens). */
/**
 * A FILA de atendimento: pedidos em aberto (nem concluídos, nem cancelados).
 *
 * SEM ano, ao contrário de getPedidos: o pedido de dezembro ainda não atendido é
 * trabalho em janeiro, e uma fila que esconde o atrasado não serve de fila.
 * Sem cache: é a tela de quem está trabalhando, e o número tem de bater com o que
 * a pessoa acabou de registrar.
 */
export function getPedidosEmAberto() {
  return apiGet(`${BASE}/pedido/em_aberto`);
}

/**
 * O que imprimir de um pedido: um item por linha, com a carta (uuid_arquivo) e o
 * que falta imprimir.
 *
 * Leitura pura. Não confundir com prepararDownloadImpressao, que cria token de
 * download e devolve caminho de volume para o plugin do QGIS.
 * @param {number} pedidoId
 */
export function getImpressaoDoPedido(pedidoId) {
  return apiGet(`${BASE}/pedido/${pedidoId}/impressao`);
}

/**
 * Baixa a CARTA de um item do pedido, para imprimir.
 *
 * Vai pela rota da MAPOTECA, e nao pela do acervo, por causa da permissao: quem
 * atende pedido tem operador na mapoteca e pode nao ter perfil nenhum no acervo.
 * Pelo `/acervo/arquivo/:uuid/download` ele levaria 403 no meio da tela feita
 * para ele. O servidor confere que o arquivo e a carta de um item DAQUELE pedido.
 *
 * @param {number} pedidoId
 * @param {string} uuidArquivo
 * @param {string} nomeArquivo - nome fisico, usado como nome do arquivo salvo
 */
export function baixarCartaDoPedido(pedidoId, uuidArquivo, nomeArquivo) {
  return apiDownload(
    `${BASE}/pedido/${pedidoId}/arquivo/${encodeURIComponent(uuidArquivo)}/download`,
    nomeArquivo
  );
}

export function prepararDownloadImpressao(pedidoId) {
  return apiPost(`${BASE}/pedido/${pedidoId}/download_impressao`);
}

/**
 * Register printing sessions.
 * @param {Array<{produto_pedido_id:number, quantidade:number, observacao?:string}>} registros
 */
export function registrarImpressao(registros) {
  invalidate('pedidos');
  return apiPost(`${BASE}/impressao`, { registros });
}

/** Printing history for an order item (with quantidade_impressa/restante). */
export function getImpressaoItem(produtoPedidoId) {
  return cachedFetch(
    `pedidos:impressao:${produtoPedidoId}`,
    () => apiGet(`${BASE}/produto_pedido/${produtoPedidoId}/impressao`),
    TTL_LISTA
  );
}

/** Remove printing records (admin corrections). @param {number[]} ids */
export function deleteImpressoes(ids) {
  invalidate('pedidos');
  return apiDelete(`${BASE}/impressao`, { impressao_ids: ids });
}

// ---------------------------------------------------------------------------
// Plotters e manutenções
// ---------------------------------------------------------------------------

/** All plotters with last maintenance date and maintenance count. */
export function getPlotters() {
  return cachedFetch('plotters:list', () => apiGet(`${BASE}/plotter`), TTL_LISTA);
}

/** Plotter details with maintenance history and cost statistics. */
export function getPlotter(id) {
  return cachedFetch(`plotters:item:${id}`, () => apiGet(`${BASE}/plotter/${id}`), TTL_LISTA);
}

/** @param {{ativo:boolean, nr_serie:string, modelo:string, data_aquisicao?:string, vida_util?:number}} plotter */
export function createPlotter(plotter) {
  invalidate('plotters');
  invalidate('dashboard');
  return apiPost(`${BASE}/plotter`, plotter);
}

/** Same payload as createPlotter plus `id`. */
export function updatePlotter(plotter) {
  invalidate('plotters');
  invalidate('dashboard');
  return apiPut(`${BASE}/plotter`, plotter);
}

/** @param {number[]} ids */
export function deletePlotters(ids) {
  invalidate('plotters');
  invalidate('dashboard');
  return apiDelete(`${BASE}/plotter`, { plotter_ids: ids });
}

/** All maintenance records with plotter details. */
export function getManutencoes() {
  return cachedFetch('plotters:manutencao:list', () => apiGet(`${BASE}/manutencao_plotter`), TTL_LISTA);
}

/** Single maintenance record. */
export function getManutencao(id) {
  return cachedFetch(`plotters:manutencao:item:${id}`, () => apiGet(`${BASE}/manutencao_plotter/${id}`), TTL_LISTA);
}

/** @param {{plotter_id:number, data_manutencao:string, valor:number, descricao?:string}} manutencao */
export function createManutencao(manutencao) {
  invalidate('plotters');
  invalidate('dashboard');
  return apiPost(`${BASE}/manutencao_plotter`, manutencao);
}

/** Same payload as createManutencao plus `id`. */
export function updateManutencao(manutencao) {
  invalidate('plotters');
  invalidate('dashboard');
  return apiPut(`${BASE}/manutencao_plotter`, manutencao);
}

/** @param {number[]} ids */
export function deleteManutencoes(ids) {
  invalidate('plotters');
  invalidate('dashboard');
  return apiDelete(`${BASE}/manutencao_plotter`, { manutencao_ids: ids });
}

// ---------------------------------------------------------------------------
// Produto avulso: o que a mapoteca imprime sem ser produto do acervo
// ---------------------------------------------------------------------------
//
// O corte é de POSSE, não de formato: o acervo guarda o que é nosso, com versão
// e arquivo; o avulso guarda o que só passou pela impressora (papel
// quadriculado, carta de outro CGEO, impresso de ocasião).

/** Todos os avulsos, com `vezes_pedido` (quantas vezes já foi impresso). */
export function getProdutosAvulsos() {
  return cachedFetch('avulsos:list', () => apiGet(`${BASE}/produto_avulso`), TTL_LISTA);
}

/**
 * Avulsos cujo MI JÁ existe no acervo.
 *
 * O avulso aceita MI de propósito (a carta de outro CGEO tem MI legítimo), então
 * nenhuma trava de banco impede registrar como avulso o que deveria estar
 * catalogado. Esta lista é o que ocupa o lugar daquela trava.
 */
export function getReconciliacaoAvulsos() {
  return cachedFetch('avulsos:reconciliacao', () => apiGet(`${BASE}/produto_avulso/reconciliacao`), TTL_LISTA);
}

/** @param {{nome:string, mi?:string, descricao?:string, tipo_produto_id?:number, tipo_escala_id?:number, denominador_escala_especial?:number, ativo?:boolean}} avulso */
export function createProdutoAvulso(avulso) {
  invalidate('avulsos');
  return apiPost(`${BASE}/produto_avulso`, avulso);
}

/** Mesmo corpo do create, mais `id`. */
export function updateProdutoAvulso(avulso) {
  invalidate('avulsos');
  return apiPut(`${BASE}/produto_avulso`, avulso);
}

/** @param {number[]} ids */
export function deleteProdutosAvulsos(ids) {
  invalidate('avulsos');
  return apiDelete(`${BASE}/produto_avulso`, { produto_avulso_ids: ids });
}

// ---------------------------------------------------------------------------
// Tipos de material
// ---------------------------------------------------------------------------

/** All material types with total stock and `abaixo_minimo` flag. */
export function getTiposMaterial() {
  return cachedFetch('materiais:list', () => apiGet(`${BASE}/tipo_material`), TTL_LISTA);
}

/** Material type details with stock per location and recent consumption. */
export function getTipoMaterial(id) {
  return cachedFetch(`materiais:item:${id}`, () => apiGet(`${BASE}/tipo_material/${id}`), TTL_LISTA);
}

/** @param {{nome:string, descricao?:string, estoque_minimo?:number, meta_anual?:number, ativo?:boolean}} material */
export function createTipoMaterial(material) {
  invalidate('materiais');
  return apiPost(`${BASE}/tipo_material`, material);
}

/** Same payload as createTipoMaterial plus `id`. */
export function updateTipoMaterial(material) {
  invalidate('materiais');
  return apiPut(`${BASE}/tipo_material`, material);
}

/** @param {number[]} ids */
export function deleteTiposMaterial(ids) {
  invalidate('materiais');
  invalidate('estoque');
  invalidate('consumo');
  return apiDelete(`${BASE}/tipo_material`, { tipo_material_ids: ids });
}

// ---------------------------------------------------------------------------
// Estoque de material
// ---------------------------------------------------------------------------

/** All stock records with material/location info. */
export function getEstoqueMaterial() {
  return cachedFetch('estoque:list', () => apiGet(`${BASE}/estoque_material`), TTL_LISTA);
}

/** Stock aggregated per location (cards). */
export function getEstoquePorLocalizacao() {
  return cachedFetch('estoque:por_localizacao', () => apiGet(`${BASE}/estoque_por_localizacao`), TTL_LISTA);
}

/** Single stock record. */
export function getEstoqueMaterialItem(id) {
  return cachedFetch(`estoque:item:${id}`, () => apiGet(`${BASE}/estoque_material/${id}`), TTL_LISTA);
}

/**
 * Create/upsert a stock record (unique key material + location).
 * @param {{tipo_material_id:number, localizacao_id:number, quantidade:number}} estoque
 */
export function createEstoqueMaterial(estoque) {
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiPost(`${BASE}/estoque_material`, estoque);
}

/** Same payload as createEstoqueMaterial plus `id`. */
export function updateEstoqueMaterial(estoque) {
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiPut(`${BASE}/estoque_material`, estoque);
}

/** @param {number[]} ids */
export function deleteEstoqueMaterial(ids) {
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiDelete(`${BASE}/estoque_material`, { estoque_material_ids: ids });
}

/**
 * Transfer material between locations (single transaction, FOR UPDATE lock).
 * Fails with 400 + clear message when the origin has insufficient balance.
 * @param {{tipo_material_id:number, origem_id:number, destino_id:number, quantidade:number}} transferencia
 */
export function transferirEstoque(transferencia) {
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiPost(`${BASE}/estoque_material/transferir`, transferencia);
}

// ---------------------------------------------------------------------------
// Consumo de material
// ---------------------------------------------------------------------------

/**
 * Consumption records with optional filters.
 * @param {{data_inicio?:string, data_fim?:string, tipo_material_id?:number}} [filtros]
 */
export function getConsumoMaterial(filtros = {}) {
  const params = new URLSearchParams();
  if (filtros.data_inicio) params.set('data_inicio', filtros.data_inicio);
  if (filtros.data_fim) params.set('data_fim', filtros.data_fim);
  if (filtros.tipo_material_id) params.set('tipo_material_id', String(filtros.tipo_material_id));
  const qs = params.toString();
  const key = `consumo:list:${qs}`;
  return cachedFetch(key, () => apiGet(`${BASE}/consumo_material${qs ? `?${qs}` : ''}`), TTL_LISTA);
}

/** Monthly consumption per material type for a year. */
export function getConsumoMensal(ano) {
  const anoParam = ano || new Date().getFullYear();
  return cachedFetch(`consumo:mensal:${anoParam}`, () => apiGet(`${BASE}/consumo_mensal?ano=${anoParam}`), TTL_LISTA);
}

/** Single consumption record. */
export function getConsumoMaterialItem(id) {
  return cachedFetch(`consumo:item:${id}`, () => apiGet(`${BASE}/consumo_material/${id}`), TTL_LISTA);
}

/**
 * Register consumption (always taken from Seção; the DB trigger enforces stock
 * and returns a verbatim pt-BR message on insufficient balance — show it in a toast).
 * @param {{tipo_material_id:number, quantidade:number, data_consumo:string}} consumo
 */
export function createConsumoMaterial(consumo) {
  invalidate('consumo');
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiPost(`${BASE}/consumo_material`, consumo);
}

/** Same payload as createConsumoMaterial plus `id`. */
export function updateConsumoMaterial(consumo) {
  invalidate('consumo');
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiPut(`${BASE}/consumo_material`, consumo);
}

/** @param {number[]} ids */
export function deleteConsumoMaterial(ids) {
  invalidate('consumo');
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiDelete(`${BASE}/consumo_material`, { consumo_material_ids: ids });
}

// ---------------------------------------------------------------------------
// RPCMTec (seção acervo) - rota /api/relatorio, fora do namespace /mapoteca
// ---------------------------------------------------------------------------

/**
 * Preview em tela do RPCMTec (seção acervo): mesmos dados do DOCX, no
 * envelope JSON (estadoAcervo, produtosPorTipo, mapotecaLinhas, insumos,
 * laiLinhas, totaisConsolidados).
 * @param {{ano:number, mes:number}} params
 */
export function getRpcmtecAcervo({ ano, mes }) {
  return apiGet(`/relatorio/rpcmtec?ano=${ano}&mes=${mes}`);
}

/**
 * Download do DOCX do RPCMTec (seção acervo: estado do acervo, produtos
 * entregues, mapoteca + insumos de impressão, LAI/órgãos públicos e totais
 * consolidados do mês e do ano).
 * @param {{ano:number, mes:number}} params
 */
export function downloadRpcmtecDocx({ ano, mes }) {
  const nome = `RPCMTec-acervo-${ano}-${String(mes).padStart(2, '0')}.docx`;
  return apiDownload(`/relatorio/rpcmtec/docx?ano=${ano}&mes=${mes}`, nome);
}

// ---------------------------------------------------------------------------
// RTM: a aba META4_DETALHADA
// ---------------------------------------------------------------------------

/**
 * Baixa a aba META4_DETALHADA do RTM em .ods: uma linha por ITEM de pedido do
 * ano, nas 15 colunas da aba, formatada para colar na planilha.
 *
 * A MESMA leitura sai em CSV por `/mapoteca/relatorio/impressao_detalhada`,
 * que a interface NÃO oferece de propósito (chefe, 2026-07-29): o CSV é para
 * agente e CLI, que querem o dado cru do banco ('Sulfite 90g', booleano). Quem
 * está na tela quer a planilha pronta.
 * @param {number} ano
 */
export function downloadMeta4Ods(ano) {
  return apiDownload(
    `${BASE}/relatorio/impressao_detalhada_ods?ano=${ano}`,
    `META4_DETALHADA_${ano}.ods`
  );
}

// ---------------------------------------------------------------------------
// Dashboard (cache 1 min)
// ---------------------------------------------------------------------------

const DASH = `${BASE}/dashboard`;

/** @returns {Promise<{total:number, em_andamento:number, concluidos:number, pendentes:number, distribuicao:Array<{id:number, nome:string, quantidade:number}>}>} */
// As quatro metricas de PEDIDO sao do ANO, pela data do pedido. E um recorte
// diferente do resumo anual e do mapa, que sao por data de ENTREGA: o pedido de
// dezembro entregue em janeiro conta em anos diferentes nos dois, e os dois
// estao certos. Cada aba diz na tela qual dos dois esta mostrando.

/** @param {number} ano */
export function getOrderStatus(ano) {
  return cachedFetch(`dashboard:order_status:${ano}`, () => apiGet(`${DASH}/order_status?ano=${ano}`), TTL_DASHBOARD);
}

/**
 * Entrada de pedidos mes a mes no ano.
 * @param {number} ano
 * @returns {Promise<Array<{mes:string, mes_numero:number, total_pedidos:number, total_produtos:number}>>}
 */
export function getOrdersTimeline(ano) {
  return cachedFetch(`dashboard:orders_timeline:${ano}`, () => apiGet(`${DASH}/orders_timeline?ano=${ano}`), TTL_DASHBOARD);
}

/** @param {number} ano @returns {Promise<{ano:number, media_geral:string|null, por_tipo_cliente:Array, mensal:Array}>} */
export function getAvgFulfillmentTime(ano) {
  return cachedFetch(`dashboard:avg_fulfillment_time:${ano}`, () => apiGet(`${DASH}/avg_fulfillment_time?ano=${ano}`), TTL_DASHBOARD);
}

/** Clientes que mais pediram NO ANO. @param {number} limite @param {number} ano */
export function getClientActivity(limite = 10, ano) {
  return cachedFetch(
    `dashboard:client_activity:${limite}:${ano}`,
    () => apiGet(`${DASH}/client_activity?limite=${limite}&ano=${ano}`),
    TTL_DASHBOARD
  );
}

/** Pending (not completed/cancelled) orders with `atrasado` and `dias_ate_prazo`. */
export function getPendingOrders() {
  return cachedFetch('dashboard:pending_orders', () => apiGet(`${DASH}/pending_orders`), TTL_DASHBOARD);
}

/** Stock aggregated per location. @returns {Promise<Array<{localizacao_id:number, localizacao:string, quantidade_total:string|number}>>} */
/**
 * Saldo de estoque por localizacao. SEM ano, de proposito: e o saldo de HOJE,
 * nao um acumulado de periodo. "Estoque de 2025" nao existe.
 */
export function getStockByLocation() {
  return cachedFetch('dashboard:stock_by_location', () => apiGet(`${DASH}/stock_by_location`), TTL_DASHBOARD);
}

/** Consumo mes a mes do ANO, mais o Top 5 de materiais. @param {number} ano */
export function getMaterialConsumption(ano) {
  return cachedFetch(`dashboard:material_consumption:${ano}`, () => apiGet(`${DASH}/material_consumption?ano=${ano}`), TTL_DASHBOARD);
}

/** Plotter status summary + list. */
export function getPlotterStatus() {
  return cachedFetch('dashboard:plotter_status', () => apiGet(`${DASH}/plotter_status`), TTL_DASHBOARD);
}

/** @returns {Promise<{ano:number, total_pedidos:number, total_entregas:number, oms_distintas_count:number, operacoes_distintas_count:number, custo_manutencao_total:number}>} */
export function getResumoAnual(ano) {
  const anoParam = ano || new Date().getFullYear();
  return cachedFetch(`dashboard:resumo_anual:${anoParam}`, () => apiGet(`${DASH}/resumo_anual?ano=${anoParam}`), TTL_DASHBOARD);
}

/** Deliveries grouped by product type and scale. @returns {Promise<Array<{tipo_produto:string, escala:string, total_pedidos:number, total_produtos:number}>>} */
export function getEntregasPorTipoProduto(ano) {
  const anoParam = ano || new Date().getFullYear();
  return cachedFetch(`dashboard:entregas_por_tipo_produto:${anoParam}`, () => apiGet(`${DASH}/entregas_por_tipo_produto?ano=${anoParam}`), TTL_DASHBOARD);
}

/** Deliveries grouped by media type. @returns {Promise<Array<{tipo_midia:string|null, total_produtos:number}>>} */
export function getEntregasPorMidia(ano) {
  const anoParam = ano || new Date().getFullYear();
  return cachedFetch(`dashboard:entregas_por_midia:${anoParam}`, () => apiGet(`${DASH}/entregas_por_midia?ano=${anoParam}`), TTL_DASHBOARD);
}

/** Supported operations. @returns {Promise<Array<{operacao:string, total_pedidos:number, total_produtos:number}>>} */
export function getOperacoesApoiadas(ano) {
  const anoParam = ano || new Date().getFullYear();
  return cachedFetch(`dashboard:operacoes_apoiadas:${anoParam}`, () => apiGet(`${DASH}/operacoes_apoiadas?ano=${anoParam}`), TTL_DASHBOARD);
}

/** Monthly deliveries (12 rows). @returns {Promise<Array<{mes:number, carta_topo:number, carta_orto:number, outros:number, total:number}>>} */
export function getEntregasPorMes(ano) {
  const anoParam = ano || new Date().getFullYear();
  return cachedFetch(`dashboard:entregas_por_mes:${anoParam}`, () => apiGet(`${DASH}/entregas_por_mes?ano=${anoParam}`), TTL_DASHBOARD);
}

/** Chaves de filtro do mapa, na ordem em que entram na URL e na chave de cache. */
const FILTROS_MAPA = ['tipo_produto_id', 'escala', 'cliente_id'];

/**
 * Entregas do ano com geometria, para o mapa do dashboard. Uma feição por
 * produto do acervo, com o total entregue.
 *
 * Os filtros entram na chave de cache, e não só na URL: sem isso, trocar de
 * cliente devolveria por um minuto o recorte do cliente anterior.
 *
 * @param {number} ano
 * @param {{tipo_produto_id?:number, escala?:string, cliente_id?:number}} [filtros]
 * @returns {Promise<{ano:number, filtrado:boolean, total_produtos:number, total_ano:number, sem_geometria:number, dados:Array<{id:number, nome:string, mi:string|null, tipo_produto:string, escala:string, total_pedidos:number, total_clientes:number, total_produtos:number, geom:Object}>}>}
 */
export function getEntregasGeo(ano, filtros = {}) {
  return buscarComFiltros('entregas_geo', ano, filtros);
}

/**
 * Opções dos filtros do mapa: só o que TEM entrega, com o quantitativo de cada
 * uma já CRUZADO pelos outros filtros ativos. Cada lista ignora o próprio
 * filtro, então escolher uma OM não deixa a lista de OMs com uma opção só.
 * @param {number} ano
 * @param {{tipo_produto_id?:number, escala?:string, cliente_id?:number}} [filtros]
 * @returns {Promise<{ano:number, tipos_produto:Array<{code:number, nome:string, produtos:number}>, escalas:Array<{escala:string, produtos:number}>, clientes:Array<{id:number, nome:string, produtos:number}>}>}
 */
export function getEntregasFiltros(ano, filtros = {}) {
  return buscarComFiltros('entregas_filtros', ano, filtros);
}

/** Monta query e chave de cache das duas rotas do mapa, que têm os mesmos filtros. */
function buscarComFiltros(rota, ano, filtros) {
  const anoParam = ano || new Date().getFullYear();
  const params = new URLSearchParams({ ano: String(anoParam) });
  const partes = [];
  for (const chave of FILTROS_MAPA) {
    const valor = filtros[chave];
    if (valor === null || valor === undefined || valor === '') continue;
    params.set(chave, String(valor));
    partes.push(`${chave}=${valor}`);
  }
  const chaveCache = `dashboard:${rota}:${anoParam}${partes.length ? `:${partes.join('&')}` : ''}`;
  return cachedFetch(chaveCache, () => apiGet(`${DASH}/${rota}?${params}`), TTL_DASHBOARD);
}

/**
 * Anos com dado na mapoteca, do mais recente para o mais antigo. Alimenta o
 * seletor de ano da navbar. Cache de DOMINIO (30 min): a lista só muda quando
 * nasce o primeiro pedido de um ano.
 * @returns {Promise<Array<number>>}
 */
export function getAnosMapoteca() {
  return cachedFetch('dominio:anos_mapoteca', () => apiGet(`${DASH}/anos`), TTL_DOMINIO);
}

const DASHBOARD_CSV_ENDPOINTS = [
  'entregas_por_tipo_produto',
  'entregas_por_midia',
  'operacoes_apoiadas',
  'entregas_por_mes',
];

/**
 * Download an annual dashboard dataset as CSV (token via fetch blob).
 * @param {'entregas_por_tipo_produto'|'entregas_por_midia'|'operacoes_apoiadas'|'entregas_por_mes'} nome
 * @param {number} [ano]
 */
export function downloadDashboardCsv(nome, ano) {
  if (!DASHBOARD_CSV_ENDPOINTS.includes(nome)) {
    return Promise.reject(new Error(`Exportação CSV indisponível para: ${nome}`));
  }
  const anoParam = ano || new Date().getFullYear();
  return apiDownload(`${DASH}/${nome}?ano=${anoParam}&formato=csv`, `${nome}_${anoParam}.csv`);
}

/** Drop all dashboard cache entries (used by the 60s auto-refetch). */
export function invalidateDashboardCache() {
  invalidate('dashboard');
}

// ---------------------------------------------------------------------------
// Anexos do pedido (documento de solicitação + arquivos, guardados no banco)
// ---------------------------------------------------------------------------

/** Lista os anexos (só metadados) de um pedido. */
export function getAnexosPedido(pedidoId) {
  return apiGet(`${BASE}/pedido/${pedidoId}/anexos`);
}

/**
 * Anexa um arquivo a um pedido. Devolve a lista atualizada de anexos.
 * @param {number} pedidoId
 * @param {File} file - o arquivo escolhido pelo usuário
 * @param {{ tipo_anexo_id?: number, descricao?: string }} [meta]
 */
export function uploadAnexoPedido(pedidoId, file, meta = {}) {
  const fd = new FormData();
  fd.append('arquivo', file);
  if (meta.tipo_anexo_id != null) fd.append('tipo_anexo_id', String(meta.tipo_anexo_id));
  if (meta.descricao) fd.append('descricao', meta.descricao);
  return apiUpload(`${BASE}/pedido/${pedidoId}/anexos`, fd);
}

/** Baixa o arquivo de um anexo (dispara o download no navegador). */
export function downloadAnexoPedido(anexoId, nomeFallback) {
  return apiDownload(`${BASE}/pedido/anexo/${anexoId}/download`, nomeFallback || `anexo_${anexoId}`);
}

/** Remove um anexo do pedido. */
export function deleteAnexoPedido(anexoId) {
  return apiDelete(`${BASE}/pedido/anexo/${anexoId}`);
}
