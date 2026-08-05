import {
  apiGet, apiPost, apiPut, apiDelete, apiDownload, apiImagem, apiUploadComProgresso,
} from '@services/api-client.js';
import { cachedFetch, invalidate, TTL_DASHBOARD, TTL_DOMINIO } from '@services/cache.js';

/**
 * Camada de servico do modulo ACERVO: uma funcao por endpoint do backend.
 * Todas devolvem o payload `dados` (o api-client ja desembrulha o envelope).
 *
 * SEM PREFIXO: na fusao com o SCO so o orcamento ganhou prefixo.
 * As rotas do acervo continuam onde estavam ('/dashboard/...', '/acervo/...',
 * '/produtos', '/projetos', '/volumes', '/gerencia', '/arquivo'), conforme
 * server/src/routes.js. As rotas de PLATAFORMA ('/login', '/usuarios') moram em
 * '@services/plataforma-service.js'.
 *
 * CACHE: o dashboard chama muitos endpoints por aba, e o auto-refresh repete a
 * carga a cada 60 s. Todas as chaves usam o prefixo CACHE, entao invalidar o
 * dashboard do acervo nao derruba o cache dos outros modulos.
 */

const CACHE = 'acervo:dashboard';

const cached = (chave, endpoint) =>
  cachedFetch(`${CACHE}:${chave}`, () => apiGet(endpoint), TTL_DASHBOARD);

/** Descarta o cache do dashboard do acervo (usado pelo auto-refresh). */
export function invalidarDashboard() {
  invalidate(CACHE);
}

// ---- Aba 1: Visao Geral ----
export const getProdutosTotal = () => cached('produtos_total', '/dashboard/produtos_total');
export const getArquivosTotalGb = () => cached('arquivos_total_gb', '/dashboard/arquivos_total_gb');
export const getUsuariosTotal = () => cached('usuarios_total', '/dashboard/usuarios_total');
export const getSystemHealth = () => cached('system_health', '/dashboard/system_health');

// ---- Aba 2: Distribuicao ----
export const getProdutosTipo = () => cached('produtos_tipo', '/dashboard/produtos_tipo');
export const getProdutosEscala = () => cached('produtos_escala', '/dashboard/produtos_escala');
export const getGbTipoProduto = () => cached('gb_tipo_produto', '/dashboard/gb_tipo_produto');
export const getArquivosTipoArquivo = () => cached('arquivos_tipo_arquivo', '/dashboard/arquivos_tipo_arquivo');
export const getGbVolume = () => cached('gb_volume', '/dashboard/gb_volume');

// ---- Aba 3: Atividade ----
export const getArquivosDia = () => cached('arquivos_dia', '/dashboard/arquivos_dia');
export const getDownloadsDia = () => cached('downloads_dia', '/dashboard/downloads_dia');
export const getUltimosProdutos = () => cached('ultimos_produtos', '/dashboard/ultimos_produtos');
export const getUltimasVersoes = () => cached('ultimas_versoes', '/dashboard/ultimas_versoes');
export const getUltimosCarregamentos = () => cached('ultimos_carregamentos', '/dashboard/ultimos_carregamentos');
export const getUltimasModificacoes = () => cached('ultimas_modificacoes', '/dashboard/ultimas_modificacoes');
export const getUltimosDeletes = () => cached('ultimos_deletes', '/dashboard/ultimos_deletes');
export const getDownloads = () => cached('downloads', '/dashboard/download');
export const getSituacaoCarregamento = () => cached('situacao_carregamento', '/dashboard/situacao_carregamento');

// ---- Aba 4: Analises Avancadas ----
export const getProdutoActivityTimeline = (meses = 6) =>
  cached(`produto_timeline_${meses}`, `/dashboard/produto_activity_timeline?months=${meses}`);
export const getVersaoActivityTimeline = (meses = 6) =>
  cached(`versao_timeline_${meses}`, `/dashboard/versao_activity_timeline?months=${meses}`);
export const getStorageGrowthTrends = (meses = 6) =>
  cached(`storage_trends_${meses}`, `/dashboard/storage_growth_trends?months=${meses}`);
export const getVersionStatistics = () => cached('version_statistics', '/dashboard/version_statistics');
export const getProjectStatusSummary = () => cached('project_status', '/dashboard/project_status_summary');
export const getUserActivityMetrics = (limite = 10) =>
  cached(`user_activity_${limite}`, `/dashboard/user_activity_metrics?limit=${limite}`);

/**
 * Exportacoes do acervo, consumidas pela barra de exportacao do dashboard.
 * Cada uma baixa um ZIP montado pelo servidor.
 */
export const EXPORTACOES_ACERVO = [
  {
    label: 'Exportar planilha (CSV)',
    title: 'Baixa um ZIP com CSVs no formato da planilha de referência, um por escala e tipo de produto',
    endpoint: '/acervo/export-planilha-csv',
    filename: 'planilha-acervo.zip',
  },
  {
    label: 'Exportar GeoJSON (site de produtos)',
    title: 'Baixa um ZIP com os GeoJSONs de situação geral, no formato que o site de produtos consome',
    endpoint: '/acervo/situacao-geral',
    filename: 'situacao-geral.zip',
  },
];

// ---------------------------------------------------------------------------
// Busca do acervo
// ---------------------------------------------------------------------------

/**
 * Monta a query string SO com o que foi preenchido.
 *
 * Mandar `termo=` vazio ou `tipo_produto_id=` sem valor faz o Joi do servidor
 * recusar ou filtrar por nada, e ainda polui a URL compartilhavel.
 * @param {Object} filtros
 * @returns {string}
 */
function queryString(filtros) {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor === null || valor === undefined || valor === '' || valor === false) continue;
    // Lista VAZIA e filtro nao aplicado, e nao filtro vazio: sem esta linha o
    // filtro de marcacao multipla sem nada marcado mandaria `tipo_produto_id=`
    // na URL, que o servidor ignora mas que suja todo link copiado da tela.
    if (Array.isArray(valor) && valor.length === 0) continue;
    params.set(chave, Array.isArray(valor) ? valor.join(',') : String(valor));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Busca de produtos: textual, por dominio e por recorte espacial.
 *
 * NAO passa pelo cache de propósito. O cache existe para o dashboard, que
 * repete as mesmas chamadas a cada 60 s; busca e sempre uma pergunta nova, e
 * guardar combinacao de filtro so gastaria memoria para nunca acertar.
 *
 * @param {Object} filtros - { termo, tipo_produto_id, tipo_escala_id,
 *   projeto_id, lote_id, bbox, palavra_chave, com_geometria, page, limit }
 * @returns {Promise<{total:number, page:number, limit:number,
 *   extent:Array<number>|null, dados:Array<Object>}>}
 */
export const buscarProdutos = (filtros = {}) =>
  apiGet(`/acervo/busca${queryString(filtros)}`);

/**
 * Geometria de TODOS os produtos que casam com os filtros, sem paginacao.
 *
 * Rota separada da lista de proposito: a lista pagina porque ninguem le 800
 * cartoes, mas o mapa nao pode paginar. Vinte poligonos numa tela de 800
 * resultados afirmam visualmente que o acervo tem vinte cartas ali.
 *
 * O acervo inteiro cabe em pouco mais de um megabyte de JSON, entao a chamada e
 * sempre a busca completa e nunca uma fatia.
 *
 * @param {Object} filtros - os MESMOS da busca (sem page/limit)
 * @returns {Promise<{total:number, truncado:boolean, dados:Array<Object>}>}
 */
export const buscarGeometrias = (filtros = {}) =>
  apiGet(`/acervo/busca/geometrias${queryString(filtros)}`);

/**
 * Opcoes dos filtros da busca, com o quantitativo de PRODUTOS de cada uma.
 *
 * Recebe os MESMOS filtros da busca, porque cada lista aplica os OUTROS e nunca
 * o proprio: escolher um tipo passa a mostrar quantos produtos daquele tipo
 * existem em cada escala, e trocar de escala continua possivel sem limpar nada
 * antes. Sem cache, pela mesma razao da busca: e sempre uma combinacao nova.
 *
 * @param {Object} filtros - os MESMOS da busca (sem page/limit)
 * @returns {Promise<{tipos_produto:Array, tipos_escala:Array, subtipos_produto:Array}>}
 */
export const getBuscaFacetas = (filtros = {}) =>
  apiGet(`/acervo/busca/facetas${queryString(filtros)}`);

/**
 * Baixa o resultado da busca em CSV.
 *
 * Exporta o conjunto INTEIRO, e nao a pagina na tela. Com `ids` preenchido sai
 * so o que a pessoa selecionou, e os demais filtros continuam valendo: o CSV
 * nunca traz algo que a busca corrente nao traria.
 *
 * @param {Object} filtros - os mesmos da busca, mais `ids` opcional
 * @param {string} [nomeArquivo]
 * @returns {Promise<void>}
 */
export const baixarBuscaCsv = (filtros = {}, nomeArquivo = 'busca-acervo.csv') =>
  apiDownload(`/acervo/busca/csv${queryString(filtros)}`, nomeArquivo);

/**
 * Palavras-chave em uso, para sugerir a etiqueta em vez de exigir adivinhacao.
 * Cacheado como dominio: a lista muda quando alguem cataloga, nao a cada tecla.
 * @param {string} [termo]
 * @returns {Promise<Array<{palavra:string, usos:number}>>}
 */
export const getPalavrasChave = (termo = '') =>
  cachedFetch(
    `acervo:palavras_chave:${termo}`,
    () => apiGet(`/acervo/palavras_chave${queryString({ termo })}`),
    TTL_DOMINIO
  );

/**
 * Ficha completa do produto: dados, versoes, arquivos e relacionamentos.
 * @param {number} produtoId
 * @returns {Promise<Object>}
 */
export const getProdutoDetalhado = (produtoId) =>
  apiGet(`/acervo/produto/detalhado/${produtoId}`);

/**
 * Baixa UM arquivo do acervo pelo navegador.
 *
 * O servidor le o volume e faz stream: o navegador nunca ve caminho de rede, e
 * nenhum volume precisa de servidor HTTP. E diferente do par
 * prepare/confirm-download, que devolve o CAMINHO do volume e existe para o
 * plugin do QGIS, que roda em maquina que monta o share.
 *
 * Identifica pelo uuid_arquivo, e nao pelo id: a URL vira historico do navegador
 * e linha de log, e o inteiro sequencial convidaria a varrer o acervo trocando o
 * numero.
 *
 * @param {string} uuidArquivo
 * @param {string} nomeArquivo - nome fisico, usado como nome do arquivo salvo
 */
export const baixarArquivoDoAcervo = (uuidArquivo, nomeArquivo) =>
  apiDownload(
    `/acervo/arquivo/${encodeURIComponent(uuidArquivo)}/download`,
    nomeArquivo
  );

/**
 * Miniatura de uma versao, para a ficha do produto.
 *
 * Devolve `null` quando a versao nao tem imagem (produto so vetorial, ou
 * arquivo que falhou na renderizacao). Quem chama ja sabe disso antes de pedir,
 * pelo `tem_miniatura` da ficha detalhada; esta funcao so nao mente quando
 * chamada as cegas.
 *
 * Quem chama tem de liberar a URL devolvida com `URL.revokeObjectURL`.
 */
export const getMiniaturaVersao = (versaoId) =>
  apiImagem(`/acervo/versao/${versaoId}/miniatura`);

// Dominios dos filtros da busca. TTL de dominio: sao tabelas que quase nao mudam.
export const getTiposProduto = () =>
  cachedFetch('acervo:dominio:tipo_produto', () => apiGet('/gerencia/dominio/tipo_produto'), TTL_DOMINIO);

export const getTiposEscala = () =>
  cachedFetch('acervo:dominio:tipo_escala', () => apiGet('/gerencia/dominio/tipo_escala'), TTL_DOMINIO);

/**
 * Subtipos de produto. Cada um pertence a um tipo (`tipo_id`), e a busca usa
 * isso para estreitar a lista quando ha um tipo escolhido.
 * @returns {Promise<Array<{code:number, nome:string, tipo_id:number}>>}
 */
export const getSubtiposProduto = () =>
  cachedFetch('acervo:dominio:subtipo_produto', () => apiGet('/gerencia/dominio/subtipo_produto'), TTL_DOMINIO);

/**
 * Tipos de versao (1 Regular, 2 Registro histórico, 3 Planejada).
 *
 * A lista chega inteira do servidor, e QUEM FILTRA e a tela: o formulario de
 * versao oferece so Regular e Planejada, e essa escolha e de interface, nao de
 * dominio. Filtrar aqui esconderia o tipo 2 de quem so quer EXIBIR o rotulo de
 * uma versao historica que ja existe.
 */
export const getTiposVersao = () =>
  cachedFetch('acervo:dominio:tipo_versao', () => apiGet('/gerencia/dominio/tipo_versao'), TTL_DOMINIO);

export const getTiposRelacionamento = () =>
  cachedFetch('acervo:dominio:tipo_relacionamento', () => apiGet('/gerencia/dominio/tipo_relacionamento'), TTL_DOMINIO);

export const getTiposArquivo = () =>
  cachedFetch('acervo:dominio:tipo_arquivo', () => apiGet('/gerencia/dominio/tipo_arquivo'), TTL_DOMINIO);

export const getSituacoesCarregamento = () =>
  cachedFetch('acervo:dominio:situacao_carregamento', () => apiGet('/gerencia/dominio/situacao_carregamento'), TTL_DOMINIO);

/**
 * Projetos e lotes, para o campo `lote_id` da versao.
 *
 * Cacheados como dominio, e nao como lista: sao dezenas de linhas que mudam
 * quando um projeto novo comeca, e nao a cada cadastro de versao.
 */
export const getProjetos = () =>
  cachedFetch('acervo:dominio:projeto', () => apiGet('/projetos/projeto'), TTL_DOMINIO);

export const getLotes = () =>
  cachedFetch('acervo:dominio:lote', () => apiGet('/projetos/lote'), TTL_DOMINIO);

// ---------------------------------------------------------------------------
// Escrita: produto, versao e relacionamento
// ---------------------------------------------------------------------------

/**
 * Descarta o que uma escrita torna mentira.
 *
 * Sao dois prefixos, e nao o `acervo:` inteiro, porque os DOMINIOS (tipo de
 * produto, escala, subtipo) nao mudam por cadastrar produto: derrubar os tres
 * junto faria cada gravacao custar quatro requisicoes de tabela que ninguem
 * alterou. O que muda e o quantitativo do dashboard e a lista de palavras-chave
 * em uso, que e alimentada pelas versoes.
 *
 * A BUSCA nao aparece aqui porque nunca entrou no cache: cada combinacao de
 * filtro e uma pergunta nova (ver `buscarProdutos`).
 */
function invalidarEscrita() {
  invalidate(CACHE);
  invalidate('acervo:palavras_chave');
}

/**
 * Cria produtos SEM versao e SEM arquivo (a casca).
 *
 * O corpo e um OBJETO com a chave `produtos`, ao contrario das rotas de versao,
 * que recebem array puro. A diferenca e do servidor (`produtoSchema.produtos` x
 * `produtoSchema.versoesPlanejadas`), e quem chama nao deve ter de lembrar dela:
 * esta funcao recebe a lista e monta o envelope.
 *
 * @param {Array<Object>} produtos
 * @returns {Promise<any>}
 */
export function criarProdutos(produtos) {
  invalidarEscrita();
  return apiPost('/produtos/produtos', { produtos });
}

/**
 * Atualiza UM produto, com o objeto inteiro.
 *
 * `subtipo_produto_id` AUSENTE significa "não mexe", e nao null: e o campo que
 * carrega a identidade do produto (24 = Carta Topográfica Militar). Quem quer
 * despinar manda null explicito. Ver o comentario de produto_schema.js.
 *
 * @param {Object} produto - com `id`
 */
export function atualizarProduto(produto) {
  invalidarEscrita();
  return apiPut('/produtos/produto', produto);
}

/**
 * Exclui produtos, com as versoes e os arquivos deles.
 *
 * O motivo e obrigatorio no servidor, e nao e enfeite: as linhas vao para as
 * tabelas `*_deletado`, e sem ele a exclusao vira um registro sumido sem
 * historia.
 *
 * @param {Array<number>} ids
 * @param {string} motivo
 */
export function excluirProdutos(ids, motivo) {
  invalidarEscrita();
  return apiDelete('/produtos/produto', { produto_ids: ids, motivo_exclusao: motivo });
}

/**
 * Cria versoes PLANEJADAS em produtos que ja existem.
 *
 * Corpo em ARRAY puro, como a rota historica irma. Planejada e promessa de
 * producao: nasce sem arquivo, e o arquivo entra nesta MESMA versao quando a
 * producao terminar.
 *
 * @param {Array<Object>} versoes - cada uma com `produto_id`
 */
export function criarVersoesPlanejadas(versoes) {
  invalidarEscrita();
  return apiPost('/produtos/versao_planejada', versoes);
}

/**
 * Cria produto e versao planejada de uma vez, para a folha que ainda nao esta
 * no acervo. Corpo em ARRAY puro, e cada produto traz suas `versoes`.
 * @param {Array<Object>} produtos
 */
export function criarProdutoComVersaoPlanejada(produtos) {
  invalidarEscrita();
  return apiPost('/produtos/produto_versao_planejada', produtos);
}

/**
 * Cria produto e versao de REGISTRO HISTORICO de uma vez.
 *
 * Irma da planejada, e com o MESMO corpo: quem separa as duas e a ROTA, e nao um
 * inteiro escondido no corpo. Ver o comentario de `criarVersoesHistoricas`.
 * @param {Array<Object>} produtos
 */
export function criarProdutoComVersaoHistorica(produtos) {
  invalidarEscrita();
  return apiPost('/produtos/produto_versao_historica', produtos);
}

/**
 * Cria versoes de REGISTRO HISTORICO em produtos que ja existem.
 *
 * Mesma forma da planejada, e de proposito: as duas nascem SEM arquivo, e o que
 * as separa e o significado. Historica e a folha que existe no mundo e o acervo
 * registra sem ter o arquivo (edicao antiga, carta de outro orgao); planejada e
 * promessa de producao, e ganha o arquivo na MESMA versao quando ela terminar.
 *
 * @param {Array<Object>} versoes - cada uma com `produto_id`
 */
export function criarVersoesHistoricas(versoes) {
  invalidarEscrita();
  return apiPost('/produtos/versao_historica', versoes);
}

/**
 * Atualiza UMA versao, com o objeto inteiro.
 *
 * `uuid_versao` segue IMUTAVEL por aqui de proposito: nesta rota ele chegaria
 * junto de vinte outros campos e troca-lo seria acidente. A troca deliberada tem
 * rota propria (`POST /produtos/versao/uuid`, perfil gerente).
 *
 * `palavras_chave` ausente PRESERVA o que esta gravado; mandar `[]` zera.
 *
 * @param {Object} versao - com `id`
 */
export function atualizarVersao(versao) {
  invalidarEscrita();
  return apiPut('/produtos/versao', versao);
}

/**
 * Exclui versoes, com os arquivos delas. Motivo obrigatorio, pela mesma razao
 * de `excluirProdutos`.
 * @param {Array<number>} ids
 * @param {string} motivo
 */
export function excluirVersoes(ids, motivo) {
  invalidarEscrita();
  return apiDelete('/produtos/versao', { versao_ids: ids, motivo_exclusao: motivo });
}

/**
 * Exclui ARQUIVOS, sem tocar na versao que os contem.
 *
 * A web ja acrescentava arquivo a uma versao que existe (`enviarArquivosEmVersao`)
 * e nao tinha como tirar nenhum: o arquivo mandado por engano so saia pelo plugin
 * do QGIS, ou levando a versao inteira junto. A rota e `verifyPerfil('gerente')`,
 * como a exclusao de versao.
 *
 * O motivo e obrigatorio no servidor pela mesma razao das outras exclusoes: a
 * linha vai para `acervo.arquivo_deletado`, e sem motivo a exclusao vira um
 * registro sumido sem historia. Os bytes seguem no volume.
 *
 * @param {Array<number>} ids
 * @param {string} motivo
 */
export function excluirArquivos(ids, motivo) {
  invalidarEscrita();
  return apiDelete('/arquivo/arquivo', { arquivo_ids: ids, motivo_exclusao: motivo });
}

/**
 * Relacionamentos entre versoes (insumo, complementar, conjunto).
 *
 * As tres funcoes montam o envelope que cada rota espera, e ele NAO e o mesmo:
 * POST e PUT levam `versao_relacionamento`, o DELETE leva
 * `versao_relacionamento_ids`. Deixar isso para quem chama transformaria um
 * detalhe do schema em regra decorada por cada tela.
 *
 * O servidor recusa auto-relacionamento, par duplicado (409) e CICLO em relacao
 * de Insumo. A tela nao reimplementa nenhuma das tres: mostra a mensagem que
 * volta daqui.
 *
 * @param {Array<{versao_id_1:number, versao_id_2:number, tipo_relacionamento_id:number}>} lista
 */
/**
 * Todas as linhas de `acervo.versao_relacionamento`, com os dois lados.
 *
 * A ficha detalhada do produto NAO serve para trocar o tipo de uma relacao: ela
 * devolve a "versao relacionada" ja resolvida por um CASE, e portanto nao diz
 * qual das duas e a `versao_id_1`. O PUT exige as duas na ordem gravada, e
 * chutar a ordem inverteria o sentido da relacao de Insumo em silencio, que e
 * justamente o que a deteccao de ciclo do servidor percorre.
 *
 * Sem cache: quem chama isto esta prestes a ESCREVER, e uma direcao lida de
 * cinco minutos atras e a informacao errada na hora errada.
 *
 * @returns {Promise<Array<{id:number, versao_id_1:number, versao_id_2:number, tipo_relacionamento_id:number}>>}
 */
export const getRelacionamentos = () => apiGet('/produtos/versao_relacionamento');

export function criarRelacionamentos(lista) {
  invalidarEscrita();
  return apiPost('/produtos/versao_relacionamento', { versao_relacionamento: lista });
}

/** Cada item leva tambem o `id` da linha de relacionamento. */
export function atualizarRelacionamentos(lista) {
  invalidarEscrita();
  return apiPut('/produtos/versao_relacionamento', { versao_relacionamento: lista });
}

/** @param {Array<number>} ids */
export function excluirRelacionamentos(ids) {
  invalidarEscrita();
  return apiDelete('/produtos/versao_relacionamento', { versao_relacionamento_ids: ids });
}

/**
 * Geometria e identificacao de uma folha do mapa indice, por MI ou por INOM.
 *
 * Existe para o cadastro nao exigir que alguem desenhe a mao um poligono que a
 * DSG ja definiu: informado o MI, o resto da identidade da folha vem junto. A
 * folha existe no SCN esteja ou nao catalogada, entao esta rota nao consulta o
 * acervo.
 *
 * MANDA UM DOS DOIS, nunca os dois: a rota recusa a combinacao, e o MI ganha
 * quando os dois vem preenchidos. A regra fica AQUI, e nao em cada tela: quem
 * abre um formulario com os dois campos ja preenchidos nao tem por que saber
 * disso, e cada tela que resolvesse por conta poderia escolher o outro.
 *
 * Sem cache: cada folha e uma pergunta diferente, e guardar por MI encheria a
 * memoria da aba com uma entrada por carta consultada.
 *
 * @param {{mi?:string, inom?:string}} chave - um dos dois basta
 * @returns {Promise<{inom:string, mi:string, sem_mi:boolean, tipo_escala_id:number, geom:string}>}
 */
export const getFolha = ({ mi = '', inom = '' } = {}) =>
  apiGet(`/produtos/folha${queryString(mi ? { mi } : { inom })}`);

// ---------------------------------------------------------------------------
// Envio de arquivo pelo NAVEGADOR (versão Regular)
// ---------------------------------------------------------------------------
//
// UMA requisição: os metadados e os bytes vão juntos. Não há sessão a abrir nem
// a fechar, porque não há janela entre reservar o destino e gravar -- é o mesmo
// raciocínio de `/catalogar/product`. Ou tudo entra no acervo, ou nada entra.
//
// O que esta tela NÃO manda, e cada um por uma razão:
//   - o NOME FÍSICO, que o servidor deriva de `acervo.nome_arquivo_padrao` (a
//     mesma regra que o invariante 7a audita);
//   - a EXTENSÃO, que sai do arquivo escolhido;
//   - o CHECKSUM e o TAMANHO, que o servidor mede enquanto grava.
// Mandar qualquer um deles é 400, de propósito: descartado em silêncio, a tela
// acreditaria ter gravado o que mandou.
//
// A ORDEM DAS PARTES IMPORTA: `dados` primeiro, arquivos depois. O destino de
// cada byte sai dos metadados, e eles são lidos enquanto o corpo ainda chega.

/** Monta o corpo multipart na ordem que o servidor exige. */
function corpoDoEnvio(dados, arquivos) {
  const corpo = new FormData();
  corpo.append('dados', JSON.stringify(dados));
  for (const arquivo of arquivos) corpo.append('arquivos', arquivo);
  return corpo;
}

/**
 * Versão nova, com arquivos, em produto que já existe.
 *
 * @param {{produto_id:number, versao:Object, arquivos:Array<Object>}} dados
 * @param {Array<File>} arquivos - na MESMA ordem de `dados.arquivos`
 * @param {Function} [onProgress]
 * @returns {{promessa:Promise<Object>, abortar:Function}}
 */
export function enviarVersaoComArquivos(dados, arquivos, onProgress) {
  invalidarEscrita();
  return apiUploadComProgresso(
    '/arquivo/upload-web/versao', corpoDoEnvio(dados, arquivos), onProgress
  );
}

/** Produto novo, com a primeira versão e os arquivos dela. */
export function enviarProdutoComArquivos(dados, arquivos, onProgress) {
  invalidarEscrita();
  return apiUploadComProgresso(
    '/arquivo/upload-web/produto', corpoDoEnvio(dados, arquivos), onProgress
  );
}

/**
 * Arquivos novos numa versão que JÁ EXISTE.
 *
 * É o que completa a versão PLANEJADA: ela nasce sem arquivo, de propósito, e o
 * arquivo entra nesta MESMA versão quando a produção termina. O tipo dela NÃO
 * muda por ganhar arquivo -- quem quiser mudar edita a versão.
 *
 * @param {{versao_id:number, arquivos:Array<Object>}} dados
 * @param {Array<File>} arquivos - na MESMA ordem de `dados.arquivos`
 */
export function enviarArquivosEmVersao(dados, arquivos, onProgress) {
  invalidarEscrita();
  return apiUploadComProgresso(
    '/arquivo/upload-web/arquivos', corpoDoEnvio(dados, arquivos), onProgress
  );
}

// ---- Auditoria dos invariantes logicos ----
//
// SEM CACHE, ao contrario do dashboard: auditoria e medicao do AGORA, e quem
// abre a tela depois de corrigir um defeito precisa ver a contagem cair. Servir
// do cache mostraria o numero de antes da correcao, que e o modo de falhar mais
// caro desta tela -- ela existe justamente para dizer se ja acabou.
//
// A rota exige gerente no acervo (o administrador global passa por cima).

/**
 * Roda os invariantes no servidor.
 *
 * @param {{severidade?:string, codigos?:string, amostra?:number}} [opcoes]
 * @returns {Promise<Array<{codigo:string, severidade:string, titulo:string,
 *   total:number|null, amostra:Array<Object>, truncada?:boolean, erro?:string}>>}
 */
export function getAuditoria({ severidade = '', codigos = '', amostra = 50 } = {}) {
  const params = new URLSearchParams();
  if (severidade) params.set('severidade', severidade);
  if (codigos) params.set('codigos', codigos);
  params.set('amostra', String(amostra));
  return apiGet(`/acervo/auditoria?${params.toString()}`);
}
