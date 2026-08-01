import { apiGet, apiDownload } from '@services/api-client.js';

/**
 * Camada de servico do PONTO DE CONTROLE.
 *
 * Arquivo separado do acervo-service.js por um motivo de contrato, e nao de
 * tamanho: o ponto de controle tem schema proprio no banco
 * (`ponto_controle.*`), rota propria (`/ponto_controle`) e dominios que nao sao
 * os do acervo. Misturar as duas camadas faria parecer que
 * `/gerencia/dominio/*` tambem serve aqui, e nao serve.
 *
 * O perfil, esse sim, e o do ACERVO: ver server/src/ponto_controle/*.
 */

function queryString(filtros) {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor === null || valor === undefined || valor === '' || valor === false) continue;
    params.set(chave, String(valor));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Lista de pontos, paginada.
 *
 * Sem cache, pela mesma razao da busca do acervo: cada combinacao de filtro e
 * uma pergunta nova, e guardar combinacao so gastaria memoria.
 *
 * @param {Object} filtros - { lote_id, projeto_id, estado_id, municipio_id,
 *   bbox, geometria, cod_ponto, pagina, por_pagina }
 * @returns {Promise<{total:number, pagina:number, pontos:Array<Object>}>}
 */
export const buscarPontos = (filtros = {}) =>
  apiGet(`/ponto_controle${queryString(filtros)}`);

/**
 * Posicao de TODOS os pontos do filtro, sem paginacao.
 *
 * Rota separada da lista de proposito, como no acervo: a lista pagina porque
 * ninguem le 500 cartoes, mas o mapa nao pode paginar. Cinquenta pontos numa
 * tela de quinhentos afirmam visualmente que a missao tem cinquenta pontos ali.
 *
 * @param {Object} filtros - os MESMOS da lista (sem pagina/por_pagina)
 * @returns {Promise<{total:number, pontos:Array<Object>}>}
 */
export const buscarPosicoes = (filtros = {}) =>
  apiGet(`/ponto_controle/posicoes${queryString(filtros)}`);

/**
 * Opcoes dos filtros COM o quantitativo de cada uma.
 *
 * Recebe os MESMOS filtros da lista, porque cada opcao aplica os OUTROS e nunca
 * o proprio: escolher um projeto passa a mostrar quantos pontos daquele projeto
 * existem em cada lote, e trocar de lote continua possivel sem limpar nada
 * antes. Sem cache, pela mesma razao da lista.
 *
 * @param {Object} filtros
 * @returns {Promise<{projetos:Array, lotes:Array, estados:Array, municipios:Array}>}
 */
export const getFacetas = (filtros = {}) =>
  apiGet(`/ponto_controle/facetas${queryString(filtros)}`);

/**
 * Ficha do ponto pelo CODIGO, e nao pelo id.
 *
 * O cod_ponto e a identidade global do ponto, como o MI/INOM e do produto: ele
 * sobrevive a reimportacao e cabe num link que se manda por DIEx.
 *
 * Vem com os dominios ja resolvidos em `<dominio>_nome`, e SEM o caminho dos
 * arquivos no volume, que e infraestrutura e nao informacao do ponto.
 *
 * @param {string} codPonto
 * @returns {Promise<Object>}
 */
export const getPonto = (codPonto) =>
  apiGet(`/ponto_controle/${encodeURIComponent(codPonto)}`);

/**
 * CSV do resultado, com os dominios resolvidos.
 *
 * Exporta o conjunto INTEIRO que os filtros descrevem, ou so os `ids`
 * selecionados. Nunca a pagina que esta na tela.
 *
 * @param {Object} filtros
 * @param {string} [nomeArquivo]
 */
export const baixarPontosCsv = (filtros = {}, nomeArquivo = 'pontos-de-controle.csv') =>
  apiDownload(`/ponto_controle/csv${queryString(filtros)}`, nomeArquivo);

/**
 * Baixa um dos DOIS arquivos do ponto.
 *
 * O servidor entrega os BYTES, e nao um caminho de rede como o acervo faz: o
 * acervo pode devolver caminho porque quem baixa e o plugin QGIS, que enxerga o
 * share, e a tela do navegador nao enxerga.
 *
 * @param {string} codPonto
 * @param {'pacote'|'monografia'} tipo
 * @param {string} nomeArquivo
 */
export const baixarArquivoDoPonto = (codPonto, tipo, nomeArquivo) =>
  apiDownload(
    `/ponto_controle/${encodeURIComponent(codPonto)}/download/${tipo}`,
    nomeArquivo
  );

/**
 * Numeros da aba de ponto de controle do dashboard.
 *
 * Uma chamada so, e nao sete: a aba pinta tudo de uma vez, e o assunto e um so.
 *
 * @returns {Promise<Object>}
 */
export const getDashboardPontoControle = () => apiGet('/ponto_controle/dashboard');

/**
 * Códigos de ponto ainda livres, por UF e tipo.
 *
 * Era o P14 do plugin, e mudou de lado em 2026-07-29 por CORRETUDE: lá a
 * resposta saía da camada da missão aberta no QGIS, que conhece só os pontos
 * daquela missão, e por isso declarava livre um código que outra missão já
 * tinha usado. Aqui a base é o acervo inteiro.
 *
 * Sem `uf`, devolve o resumo por grupo. Com `uf`, o `tipo` é obrigatório: HV e
 * BASE são numerações separadas.
 *
 * @param {Object} params - { uf, tipo, quantidade }
 */
export const getCodigosDisponiveis = (params = {}) =>
  apiGet(`/ponto_controle/codigos_disponiveis${queryString(params)}`);
