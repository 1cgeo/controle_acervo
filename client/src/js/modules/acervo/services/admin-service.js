import { apiGet, apiGetPaginado, apiPost, apiPostComFalhaParcial, apiPut, apiDelete } from '@services/api-client.js';
import { cachedFetch, invalidate, TTL_DOMINIO } from '@services/cache.js';

/**
 * Camada de servico da tela de ADMINISTRACAO do acervo (#/acervo/administracao).
 *
 * Separada de `acervo-service.js` de proposito: aquele e o servico das telas de
 * LEITURA e de cadastro de produto, e ja passa de 550 linhas. Aqui moram os
 * quatro cadastros estruturantes que ate 2026-08-02 so existiam no plugin do
 * QGIS -- volume de armazenamento, volume x tipo de produto, projeto e lote.
 *
 * SEM PREFIXO: as rotas do acervo nao mudaram na fusao de 2026-07-27
 * ('/volumes', '/projetos', '/gerencia'). Ver server/src/routes.js.
 *
 * CORPO EM ARRAY, ATE PARA UM. As rotas de volume recebem `{ volume_...: [...] }`
 * e as de exclusao recebem `{ ..._ids: [...] }`, porque nasceram para a carga em
 * lote do plugin. A tela grava UM por vez, e quem monta o envelope e este
 * modulo: obrigar cada chamador a lembrar da forma do corpo foi o que ja
 * produziu divergencia entre telas no passado. As de projeto e lote, ao
 * contrario, recebem o OBJETO puro -- a diferenca e do servidor
 * (`volumeSchema` x `projetoSchema`), e ela para aqui.
 */

// Projeto e lote sao lidos como DOMINIO em `acervo-service.js` (o campo
// `lote_id` da versao os oferece num select) e como LISTA aqui. E a mesma
// chave de cache, e por isso toda escrita desta tela a derruba: sem isso,
// cadastrar um lote e abrir o formulario de versao em seguida ofereceria a
// lista de antes por ate 30 minutos.
const CACHE_PROJETO = 'acervo:dominio:projeto';
const CACHE_LOTE = 'acervo:dominio:lote';

function invalidarCadastro() {
  invalidate(CACHE_PROJETO);
  invalidate(CACHE_LOTE);
}

// ---------------------------------------------------------------------------
// Volume de armazenamento
// ---------------------------------------------------------------------------

/**
 * Volumes de armazenamento cadastrados.
 *
 * NAO e cacheado: esta e a tela que os edita, e um TTL faria a linha recem
 * salva reaparecer com o valor antigo.
 * @returns {Promise<Array<{id:number, nome:string, volume:string,
 *   capacidade_gb:number, layout_origem:boolean}>>}
 */
export const getVolumesArmazenamento = () => apiGet('/volumes/volume_armazenamento');

/** @param {Object} volume - nome, volume, capacidade_gb, layout_origem */
export const criarVolumeArmazenamento = (volume) =>
  apiPost('/volumes/volume_armazenamento', { volume_armazenamento: [volume] });

/** @param {Object} volume - com `id` */
export const atualizarVolumeArmazenamento = (volume) =>
  apiPut('/volumes/volume_armazenamento', { volume_armazenamento: [volume] });

/** @param {Array<number>} ids */
export const excluirVolumesArmazenamento = (ids) =>
  apiDelete('/volumes/volume_armazenamento', { volume_armazenamento_ids: ids });

// ---------------------------------------------------------------------------
// Volume x tipo de produto
// ---------------------------------------------------------------------------

/**
 * Associacoes volume x tipo de produto, com o nome do tipo e do volume ja
 * resolvidos pelo servidor.
 * @returns {Promise<Array<{id:number, tipo_produto_id:number,
 *   volume_armazenamento_id:number, primario:boolean, tipo_produto:string,
 *   volume:string, nome_volume:string, volume_capacidade_gb:number}>>}
 */
export const getVolumeTipoProduto = () => apiGet('/volumes/volume_tipo_produto');

/** @param {Object} assoc - tipo_produto_id, volume_armazenamento_id, primario */
export const criarVolumeTipoProduto = (assoc) =>
  apiPost('/volumes/volume_tipo_produto', { volume_tipo_produto: [assoc] });

/** @param {Object} assoc - com `id` */
export const atualizarVolumeTipoProduto = (assoc) =>
  apiPut('/volumes/volume_tipo_produto', { volume_tipo_produto: [assoc] });

/** @param {Array<number>} ids */
export const excluirVolumeTipoProduto = (ids) =>
  apiDelete('/volumes/volume_tipo_produto', { volume_tipo_produto_ids: ids });

// ---------------------------------------------------------------------------
// Projeto e lote
// ---------------------------------------------------------------------------

/**
 * Projetos. Cacheado com a MESMA chave do getter de dominio de
 * `acervo-service.js`: sao a mesma lista, e duas chaves fariam a tela de versao
 * e esta divergirem depois de um cadastro.
 */
export const getProjetos = () =>
  cachedFetch(CACHE_PROJETO, () => apiGet('/projetos/projeto'), TTL_DOMINIO);

export const getLotes = () =>
  cachedFetch(CACHE_LOTE, () => apiGet('/projetos/lote'), TTL_DOMINIO);

/** @param {Object} projeto - nome, descricao, data_inicio, data_fim, status_execucao_id */
export function criarProjeto(projeto) {
  invalidarCadastro();
  return apiPost('/projetos/projeto', projeto);
}

/** @param {Object} projeto - com `id` */
export function atualizarProjeto(projeto) {
  invalidarCadastro();
  return apiPut('/projetos/projeto', projeto);
}

/** @param {Array<number>} ids */
export function excluirProjetos(ids) {
  invalidarCadastro();
  return apiDelete('/projetos/projeto', { projeto_ids: ids });
}

/** @param {Object} lote - projeto_id, pit, nome, descricao, datas, status_execucao_id */
export function criarLote(lote) {
  invalidarCadastro();
  return apiPost('/projetos/lote', lote);
}

/** @param {Object} lote - com `id` */
export function atualizarLote(lote) {
  invalidarCadastro();
  return apiPut('/projetos/lote', lote);
}

/** @param {Array<number>} ids */
export function excluirLotes(ids) {
  invalidarCadastro();
  return apiDelete('/projetos/lote', { lote_ids: ids });
}

// ---------------------------------------------------------------------------
// Dominios que so esta tela usa
// ---------------------------------------------------------------------------

/**
 * Status de execucao (dominio.tipo_status_execucao), do projeto e do lote.
 * @returns {Promise<Array<{code:number, nome:string}>>}
 */
export const getStatusExecucao = () =>
  cachedFetch(
    'acervo:dominio:tipo_status_execucao',
    () => apiGet('/gerencia/dominio/tipo_status_execucao'),
    TTL_DOMINIO,
  );

// ---------------------------------------------------------------------------
// Diagnostico (gerente)
// ---------------------------------------------------------------------------
//
// As quatro rotas abaixo sao `verifyPerfil('gerente')`. Elas respondem a uma
// pergunta que a AUDITORIA nao responde: os invariantes de `#/acervo/auditoria`
// olham a coerencia entre TABELAS, e nenhum deles toca o disco. Aqui se compara
// o banco com o VOLUME, e se le o que ja foi excluido.
//
// Tres delas paginam NO SERVIDOR, e por isso passam pelo `apiGetPaginado`: a
// contagem total vem ao lado de `dados`, e o `apiGet` a descartaria.

const paginado = (endpoint, { page = 1, limit = 20 } = {}) =>
  apiGetPaginado(`${endpoint}?page=${page}&limit=${limit}`);

/**
 * Compara o BANCO com o DISCO: rele cada arquivo do volume, confere o checksum e
 * reclassifica o status.
 *
 * ESCREVE, ao contrario das outras tres, e nos dois sentidos -- marca como erro
 * o que nao bate e LIMPA a marca do que voltou a bater. E sincrona e pode levar
 * horas num acervo grande: nao ha progresso para acompanhar, porque a rota so
 * responde no fim.
 *
 * @returns {Promise<{arquivos_atualizados:number, arquivos_deletados_atualizados:number}>}
 */
export const verificarInconsistencias = () => apiPost('/gerencia/verificar_inconsistencias');

/** Arquivos com status de erro (de carregamento ou de exclusao). Paginado. */
export const getArquivosIncorretos = (opcoes) =>
  paginado('/gerencia/arquivos_incorretos', opcoes);

/** A lapide: o que foi excluido do acervo, com motivo e autor. Paginado. */
export const getArquivosDeletados = (opcoes) =>
  paginado('/gerencia/arquivos_deletados', opcoes);

/** Os downloads que foram junto da lapide do arquivo. Paginado. */
export const getDownloadsDeletados = (opcoes) =>
  paginado('/gerencia/downloads_deletados', opcoes);

// ---------------------------------------------------------------------------
// Manutencao (administrador global)
// ---------------------------------------------------------------------------
//
// As quatro rotas abaixo sao `verifyAdmin`, e nao `verifyPerfil`: nenhuma delas
// e trabalho de modulo. Duas mexem no BANCO inteiro (as visoes materializadas),
// uma mexe no DISCO (o renome) e uma rele byte do volume (o checksum).
//
// SEM CACHE em nenhuma: sao acoes, nao consultas.

/**
 * Atualiza (REFRESH CONCURRENTLY) todas as `acervo.mv_produto_*`.
 *
 * Existem gatilhos que ja atualizam essas visoes a cada escrita, e o handler de
 * excecao deles engole a falha para nao derrubar a operacao principal. Este
 * botao e o conserto de quando isso aconteceu.
 */
export const atualizarViewsMaterializadas = () =>
  apiPost('/acervo/refresh_materialized_views');

/**
 * Cria as visoes que ainda nao existem (`CREATE MATERIALIZED VIEW IF NOT
 * EXISTS`), uma por par tipo de produto x escala.
 *
 * E da INSTALACAO, e do dia em que um `code` novo entra em `dominio.tipo_produto`
 * ou `dominio.tipo_escala`: sem ela, o par novo simplesmente nao tem visao.
 */
export const criarViewsMaterializadas = () =>
  apiPost('/acervo/create_materialized_views');

/**
 * Marca como `failed` o download que ficou `pending` alem da expiracao.
 */
export const limparDownloadsExpirados = () =>
  apiPost('/acervo/cleanup-expired-downloads');

/**
 * Reconcilia o nome FISICO do arquivo com o padrao derivado dos metadados.
 *
 * O cliente NAO manda nome: ele sai de `acervo.nome_arquivo_padrao`, a mesma
 * funcao do invariante `7a`. Trabalha por LOTE de propósito, e e para chamar em
 * laco ate `restantes` zerar -- uma passada inteira numa requisicao so seguraria
 * a conexao por dezenas de minutos.
 *
 * @param {{limite?:number, dry_run?:boolean, motivo:string, arquivo_ids?:Array<number>}} corpo
 * @returns {Promise<{dry_run:boolean, divergentes_total:number, nesta_chamada:number,
 *   restantes:number, renomeados:number, so_banco:number, falhas:number,
 *   detalhe:Array<Object>, amostra?:Array<{id:number, de:string, para:string}>,
 *   interrompido?:string}>}
 */
// `apiPostComFalhaParcial`, e nao `apiPost`: esta rota responde HTTP 200 com
// `success: false` quando parte do lote falhou, e o `dados` do lado traz o que
// renomeou, o que falta e QUAL arquivo travou. Pelo `apiPost` isso virava
// excecao e o `detalhe` se perdia (ver o comentario em `api-client.js`).
export const renomearPadrao = (corpo) => apiPostComFalhaParcial('/arquivo/renomear-padrao', corpo);

/**
 * Rele o arquivo no volume e grava o checksum e o tamanho MEDIDOS.
 *
 * Para depois de recompressao sem perda: o pixel e o mesmo, os bytes nao. O
 * cliente nao declara checksum nem tamanho, pela mesma politica do upload web.
 *
 * @param {{arquivo_ids:Array<number>, motivo:string}} corpo
 * @returns {Promise<{solicitados:number, alterados:number, inalterados:number,
 *   economia_mb:number, arquivos:Array<Object>}>}
 */
export const atualizarChecksum = (corpo) => apiPost('/arquivo/atualizar-checksum', corpo);
