import { apiGet, apiPost, apiPut, apiDelete, apiDownload, apiUpload } from '@services/api-client.js';
import { cachedFetch, invalidate, TTL_DOMINIO, TTL_LISTA, TTL_DASHBOARD } from '@services/cache.js';

/**
 * Camada de servico do modulo MAPOTECA: uma funcao por endpoint do backend.
 * Todas devolvem o payload `dados` (o api-client ja desembrulha o envelope).
 *
 * PREFIXO: a fusao com o SCA NAO mexeu nas rotas da mapoteca. Elas
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
// SEM `getDominioTipoLocalizacao`. As quatro localizacoes deixaram de vir por
// rota em 2026-08-08, e os codigos delas passaram a viver em
// `@modules/mapoteca/movimento-material.js`. A razao e que a tela nao usa a
// localizacao so como RÓTULO: a regra "consumo so sai da Seção" precisa comparar
// contra o CODIGO 1, e um codigo lido de uma resposta HTTP nao serve de
// constante. Com os codigos ali, buscar os nomes de novo seria uma segunda fonte
// para a mesma coisa.

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
 * Pedidos do ANO, com cliente, contagem de produtos, `itens_impressos` e as
 * `palavras_chave` de cada linha.
 *
 * A PALAVRA-CHAVE FILTRA NO SERVIDOR, e nao aqui. Ela casa a etiqueta INTEIRA e
 * diferencia maiuscula de minuscula, porque e assim que o indice GIN de
 * `mapoteca.pedido.palavras_chave` responde: o opclass default de array atende
 * `@>`, `<@`, `&&` e `=`, e um `ILIKE` ou um `lower()` leriam a tabela inteira
 * com o indice ao lado sem tocar nele. Filtrar aqui, sobre a lista ja baixada,
 * daria a busca "por pedaco" que o campo NAO promete, e as duas telas passariam
 * a discordar do que e um acerto.
 *
 * @param {number} ano
 * @param {string|null} [palavraChave] - etiqueta inteira; nulo traz o ano todo
 */
export function getPedidos(ano, palavraChave = null) {
  // Por ANO e por ETIQUETA, e a chave de cache junto: voltar ao ano anterior ou
  // repetir a mesma busca nao paga a requisicao de novo, e
  // `invalidate('pedidos')` continua limpando todas, porque a invalidacao e por
  // prefixo.
  const filtro = palavraChave
    ? `&palavra_chave=${encodeURIComponent(palavraChave)}`
    : '';
  return cachedFetch(
    `pedidos:list:${ano}:${palavraChave || ''}`,
    () => apiGet(`${BASE}/pedido?ano=${ano}${filtro}`),
    TTL_LISTA
  );
}

/**
 * AS ETIQUETAS QUE JA EXISTEM, com a contagem de pedidos de cada uma, da mais
 * usada para a menos.
 *
 * PARA SUGERIR, e nao para filtrar: e o que o cadastro e a busca oferecem num
 * `datalist`. A busca casa a etiqueta INTEIRA e diferencia maiuscula de
 * minuscula, entao errar a grafia nao devolve resultado parecido, devolve nada,
 * e a lista e a unica forma de acertar sem adivinhar.
 *
 * DE TODOS OS ANOS, sem o filtro de ano da lista: a etiqueta atravessa o ano, e
 * sugerir so as do ano corrente faria a grafia velha renascer em janeiro.
 *
 * CACHE DE LISTA, e a chave entra no prefixo 'pedidos' de proposito: toda
 * escrita de pedido ja chama `invalidate('pedidos')`, entao a etiqueta cadastrada
 * agora aparece na sugestao seguinte sem codigo novo.
 *
 * @returns {Promise<Array<{etiqueta:string, pedidos:number}>>}
 */
export function getPalavrasChave() {
  return cachedFetch(
    'pedidos:palavras_chave',
    () => apiGet(`${BASE}/pedido/palavras_chave`),
    TTL_LISTA
  );
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
 * Add an item to an order. `uuid_versao` is required (RN08, no loose items).
 * @param {{uuid_versao:string, pedido_id:number, quantidade:number, tipo_midia_id:number,
 *   producao_especifica?:boolean, tipo_midia_fornecida_id?:number,
 *   observacao?:string}} item
 *
 * A forma de entrega e a data de entrega são do PEDIDO (`forma_entrega_id` e
 * `data_atendimento`), e não do item.
 *
 * A quantidade fornecida saiu do item em 2026-08-08: media IGUAL à pedida em
 * 1759 de 1759 linhas. A MÍDIA fornecida ficou, com as 25 divergências reais
 * dela; o sufixo comum às duas era coincidência.
 */
export function createProdutoPedido(item) {
  invalidate('pedidos');
  invalidate('dashboard');
  return apiPost(`${BASE}/produto_pedido`, item);
}

/**
 * VÁRIOS itens de uma vez, no mesmo pedido, numa transação só.
 *
 * O `pedido_id` vai FORA do array e não se repete em cada item: um lote é de um
 * pedido, e itens de pedidos diferentes seriam dois lotes.
 *
 * Rota própria (`/produto_pedido/lote`), e não o POST de um item aceitando
 * array: aquele é o CRUD genérico que o `mapoteca_cli` consome, e ele posta um
 * objeto.
 *
 * @param {number} pedidoId
 * @param {Array<{uuid_versao?:string, nome_avulso?:string, quantidade:number, tipo_midia_id:number}>} itens
 */
export function createProdutosPedido(pedidoId, itens) {
  invalidate('pedidos');
  invalidate('dashboard');
  return apiPost(`${BASE}/produto_pedido/lote`, { pedido_id: pedidoId, itens });
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
export function getPedidosEmAberto(incluirRemetidos = false) {
  // Sem a query o servidor devolve a fila de IMPRESSÃO (1, 2 e 3), que é o
  // contrato que o plugin do QGIS já instalado espera. Com ela devolve a fila de
  // ATENDIMENTO, que traz também o Remetido (4), ainda à espera do Concluído.
  const sufixo = incluirRemetidos ? '?incluir_remetidos=true' : '';
  return apiGet(`${BASE}/pedido/em_aberto${sufixo}`);
}

/**
 * O que imprimir de um pedido: um item por linha, com a carta (uuid_arquivo) e o
 * que falta imprimir.
 *
 * Leitura pura. Não confundir com POST /pedido/:id/download_impressao, que cria
 * token de download e devolve caminho de volume para o plugin do QGIS (ver o
 * comentário logo abaixo de `baixarCartaDoPedido`).
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

// SEM `prepararDownloadImpressao`: POST /mapoteca/pedido/:id/download_impressao
// cria token de download e devolve CAMINHO DE VOLUME, que só serve ao plugin do
// QGIS (ferramentas_mapoteca/gui/pedidos/impressao_manager.py). O plugin chama a
// rota pelo cliente Python dele, e nunca por aqui. Um navegador não abre caminho
// de volume: a tela de atendimento baixa o PDF por `baixarCartaDoPedido`.

/**
 * Register printing sessions.
 *
 * `data_impressao` é QUANDO a impressão aconteceu, e é opcional: omitida, o
 * servidor grava agora. Ela existe porque registrar na segunda o que saiu na
 * sexta jogaria o consumo de papel para o mês errado, e o RPCMTec reporta por
 * mês.
 * @param {Array<{produto_pedido_id:number, quantidade:number, observacao?:string,
 *   data_impressao?:string}>} registros
 */
export function registrarImpressao(registros) {
  invalidate('pedidos');
  return apiPost(`${BASE}/impressao`, { registros });
}

/**
 * Corrige a DATA de uma sessão de impressão já gravada.
 *
 * GERENTE no servidor, ao contrário de registrar, que é operador: mudar QUANDO
 * um gasto aconteceu muda o número que o RPCMTec reporta naquele mês. Por isso o
 * `motivo` é obrigatório, e vai para a auditoria.
 *
 * A quantidade NÃO se corrige: a impressão é livro-caixa (só POST e DELETE).
 * Lançou a mais, exclui a sessão e lança de novo.
 * @param {number} impressaoId
 * @param {{data_impressao:string, motivo:string}} dados
 */
export function corrigirDataImpressao(impressaoId, dados) {
  invalidate('pedidos');
  return apiPut(`${BASE}/impressao/${impressaoId}/data`, dados);
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
// Insumos (tipo de material)
// ---------------------------------------------------------------------------
//
// O CADASTRO DE INSUMO E DO OPERADOR desde 2026-08-08, e era de gerente: quem
// faz a contagem na prateleira e quem descobre, ali, que o cartucho novo ainda
// nao existe no sistema. Quem barra a escrita segue sendo o servidor.
//
// O material NAO tem mais `categoria_id`, `tipo_midia_id` nem `meta_anual`. A
// categoria so escolhia entre a 7.2 (Papel) e a 7.3 (Tintas) do RPCMTec, e o
// chefe fundiu as duas; a midia era a ponte impressao -> consumo, e a ponte
// morreu; a meta anual nunca teve leitor. A UNIDADE vai no NOME do insumo.

/**
 * Todo insumo, com os DOIS totais e o alerta de minimo ja resolvido:
 * `estoque_total` (as quatro localizacoes), `estoque_disponivel` (Secao +
 * Almoxarifado) e `abaixo_minimo`, que compara contra o DISPONIVEL.
 */
export function getTiposMaterial() {
  return cachedFetch('materiais:list', () => apiGet(`${BASE}/tipo_material`), TTL_LISTA);
}

/** Ficha do insumo: saldo por localizacao, livro recente e estatisticas de consumo. */
export function getTipoMaterial(id) {
  return cachedFetch(`materiais:item:${id}`, () => apiGet(`${BASE}/tipo_material/${id}`), TTL_LISTA);
}

/** @param {{nome:string, descricao?:string, estoque_minimo?:number, ativo?:boolean}} material */
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
  invalidate('movimentos');
  return apiDelete(`${BASE}/tipo_material`, { tipo_material_ids: ids });
}

// ---------------------------------------------------------------------------
// Estoque de material: SO LEITURA
// ---------------------------------------------------------------------------
//
// NAO EXISTEM MAIS `createEstoqueMaterial`, `updateEstoqueMaterial`,
// `deleteEstoqueMaterial` nem `transferirEstoque`, desde 2026-08-08. As quatro
// rotas sairam do servidor (`POST`, `PUT`, `DELETE /estoque_material` e
// `POST /estoque_material/transferir`), e as quatro escreviam o saldo DIRETO,
// sem data e sem motivo.
//
// Hoje o saldo e o acumulado do LIVRO, aplicado por gatilho. Quem quer mudar o
// saldo lanca um movimento: Entrada, Transferencia ou Consumo. Manter uma porta
// de escrita ao lado do livro faria a soma do livro deixar de bater com o saldo
// no primeiro uso, e ai nenhum dos dois explicaria mais nada.

/** Linhas de saldo (material x localizacao), com quem alterou e quando. */
export function getEstoqueMaterial() {
  return cachedFetch('estoque:list', () => apiGet(`${BASE}/estoque_material`), TTL_LISTA);
}

// SEM `getEstoqueMaterialItem(id)`: a ficha do insumo ja traz a linha inteira
// (localização, quantidade, quem alterou e quando).
//
// SEM `getEstoquePorLocalizacao`, desde 2026-08-08. Ela alimentava os cartoes da
// tela de Estoque, que nao existe mais; o grafico "Estoque por Localização" do
// dashboard sai de `getStockByLocation`, que e outra rota e ja existia. Duas
// funcoes para o mesmo agregado so dariam dois numeros para divergir.

// ---------------------------------------------------------------------------
// O LIVRO DE MOVIMENTOS
// ---------------------------------------------------------------------------
//
// Entrada, Transferencia e Consumo, numa lista so e cada linha com data, origem,
// destino e motivo. Ele substituiu `/consumo_material`, que guardava so um dos
// movimentos e por isso nunca explicou um saldo inteiro. LER e de consulta;
// LANCAR e de operador.
//
// SAO TRES TIPOS, e so. A Contagem (code 4) saiu do dominio na 1.48.0, depois de
// medido que nao havia uma linha dela em banco nenhum para preservar.

/**
 * O livro, com filtro opcional. `tipo_movimento_id` existe porque a tela e UMA:
 * quem quer so o consumo filtra o tipo 3, em vez de existir uma segunda rota.
 * @param {{data_inicio?:string, data_fim?:string, tipo_material_id?:number,
 *   tipo_movimento_id?:number}} [filtros]
 */
export function getMovimentosMaterial(filtros = {}) {
  const params = new URLSearchParams();
  if (filtros.data_inicio) params.set('data_inicio', filtros.data_inicio);
  if (filtros.data_fim) params.set('data_fim', filtros.data_fim);
  if (filtros.tipo_material_id) params.set('tipo_material_id', String(filtros.tipo_material_id));
  if (filtros.tipo_movimento_id) params.set('tipo_movimento_id', String(filtros.tipo_movimento_id));
  const qs = params.toString();
  return cachedFetch(
    `movimentos:list:${qs}`,
    () => apiGet(`${BASE}/movimento_material${qs ? `?${qs}` : ''}`),
    TTL_LISTA
  );
}

/**
 * Consumo mes a mes por insumo, do ano. E a MESMA fonte da coluna "Consumo no
 * mes" da 7.2 do RPCMTec (`getConsumoMensalPorTipo` no servidor): a tela le o
 * numero que o relatorio imprime, para os dois nao poderem divergir.
 */
export function getConsumoMensal(ano) {
  const anoParam = ano || new Date().getFullYear();
  return cachedFetch(`movimentos:mensal:${anoParam}`, () => apiGet(`${BASE}/consumo_mensal?ano=${anoParam}`), TTL_LISTA);
}

/**
 * Lanca um movimento. A FORMA depende do tipo, e o servidor recusa com 400
 * nomeando o campo:
 *
 *   Entrada        sem origem, com destino
 *   Transferencia  origem e destino, DIFERENTES entre si
 *   Consumo        origem = Seção, sem destino
 *
 * Nao ha tipo de AJUSTE: o saldo se corrige pelo movimento que de fato
 * aconteceu, e lancamento errado se conserta por `updateMovimentoMaterial` ou
 * `deleteMovimentosMaterial`, que mexem no saldo pelo gatilho.
 *
 * O gatilho do banco recusa saldo insuficiente com uma mensagem em portugues
 * pronta para o toast, e ela sai literal.
 * @param {{tipo_material_id:number, tipo_movimento_id:number, quantidade:number,
 *   data_movimento:string, localizacao_origem_id?:number|null,
 *   localizacao_destino_id?:number|null, motivo?:string|null}} movimento
 */
export function createMovimentoMaterial(movimento) {
  invalidate('movimentos');
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiPost(`${BASE}/movimento_material`, movimento);
}

/** Same payload as createMovimentoMaterial plus `id`. */
export function updateMovimentoMaterial(movimento) {
  invalidate('movimentos');
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiPut(`${BASE}/movimento_material`, movimento);
}

/** @param {number[]} ids */
export function deleteMovimentosMaterial(ids) {
  invalidate('movimentos');
  invalidate('estoque');
  invalidate('materiais');
  invalidate('dashboard');
  return apiDelete(`${BASE}/movimento_material`, { movimento_material_ids: ids });
}

// SEM as chamadas do RPCMTec: elas vivem em @services/rpcmtec-service.js, junto
// com a tela. Daqui sairia so a secao do acervo e da mapoteca, e o relatorio
// inteiro sai de
// /api/rpcmtec.

// ---------------------------------------------------------------------------
// RTM: a aba META4_DETALHADA
// ---------------------------------------------------------------------------


// O Anuario Estatistico NAO tem chamada aqui: as rotas dele sao
// /api/rpcmtec/anuario, e quem as consome e @services/rpcmtec-service.js.

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

/** @returns {Promise<{ano:number, total_pedidos:number, total_entregas:number, oms_distintas_count:number, operacoes_distintas_count:number}>} */
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
 * filtro de ano de cada tela. Cache de DOMINIO (30 min): a lista só muda quando
 * nasce o primeiro pedido de um ano, e por isso as varias telas que a pedem
 * gastam uma busca só.
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

// ---------------------------------------------------------------------------
// Etiqueta de envio do pedido
// ---------------------------------------------------------------------------

/**
 * Etiqueta salva do pedido, ou `null` quando o pedido ainda não tem etiqueta.
 *
 * SEM cache, de propósito: o diálogo só libera o botão Imprimir quando a tela
 * bate com o que está SALVO. Uma resposta de 5 minutos atrás liberaria a
 * impressão de um endereço que outra pessoa já corrigiu.
 * @param {number} pedidoId
 * @returns {Promise<null|{id:number, destinatario:string, aos_cuidados:string,
 *   endereco:string, cep:string}>}
 */
export function getEtiquetaEnvio(pedidoId) {
  return apiGet(`${BASE}/pedido/${pedidoId}/etiqueta`);
}

/**
 * Grava a etiqueta do pedido: cria na primeira vez, substitui nas seguintes.
 * Devolve a linha como o banco a gravou, que é o que o diálogo compara com a
 * tela.
 * @param {number} pedidoId
 * @param {{destinatario:string, aos_cuidados?:string, endereco?:string, cep?:string}} dados
 */
export function salvarEtiquetaEnvio(pedidoId, dados) {
  return apiPut(`${BASE}/pedido/${pedidoId}/etiqueta`, dados);
}

// ---------------------------------------------------------------------------
// Histórico do pedido (auditoria)
// ---------------------------------------------------------------------------
//
// NÃO MORA MAIS AQUI. O histórico das seis fichas do sistema sai de
// `@components/historico/`, que lê `/auditoria/<modulo>/<entidade>/<id>` por
// `@services/rastreabilidade-service.js`. Aquela rota devolve o diff pronto
// ("Situação: Em andamento → Concluído"); a antiga
// `/mapoteca/pedido/:id/auditoria` devolvia só o NOME DA COLUNA que mudou, e
// nenhuma tela a consumia.
