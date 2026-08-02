import { apiGet, apiGetPaginado } from './api-client.js';

/**
 * Service da RASTREABILIDADE: o que foi alterado, quando e por quem.
 *
 * SERVICE PRÓPRIO, e não mais um bloco dentro de `plataforma-service.js`, por
 * duas razões:
 *
 * 1. ESCOPO. `/api/auditoria` é rota de plataforma, mas o assunto não é
 *    "administrar o sistema": é o histórico de dado dos três módulos. Ele é
 *    consumido pelo `components/historico/`, que aparece em seis fichas de
 *    módulos diferentes, e por `#/rastreabilidade`. Nenhuma dessas telas quer o
 *    resto do `plataforma-service`.
 *
 * 2. TESTE. `plataforma-service.js` é grande (usuários, perfis, PIT, acessos), e
 *    a fábrica de mock dele em `service-mocks.js` já lista dezenas de funções.
 *    Toda tela que mostrar histórico teria de manter aquela lista em dia por
 *    causa de três funções que não têm nada a ver com o resto. Um módulo pequeno,
 *    com uma responsabilidade, se mocka inteiro em três linhas no próprio teste.
 *
 * SEM CACHE em nenhuma das três: o histórico é justamente o que muda a cada
 * escrita, e uma resposta guardada por cinco minutos mostraria a ficha já
 * alterada com o histórico de antes, que é o modo de falhar mais caro que estas
 * telas têm.
 */

/**
 * Histórico de UM registro, do mais novo para o mais antigo.
 *
 * A resposta já vem com o diff RENDERIZADO pelo servidor (`mudancas`, com rótulo
 * em português e os dois valores em texto) e o `resumo` de cada registro. O
 * cliente não traduz nada: são ~60 tabelas auditadas e ~25 domínios, e a tela de
 * rastreabilidade mistura os três módulos numa página só. Ver
 * server/src/auditoria/renderizar.js.
 *
 * @param {string} modulo - acervo, mapoteca, orcamento ou plataforma
 * @param {string} entidade - o agregado ('pedido', 'produto', 'usuario')
 * @param {string|number} id
 * @returns {Promise<Array>}
 */
export const getHistorico = (modulo, entidade, id) =>
  apiGet(`/auditoria/${modulo}/${entidade}/${id}`);

/**
 * A varredura (#/rastreabilidade), paginada no SERVIDOR.
 *
 * Sai por `apiGetPaginado` porque o `pagination` vem ao LADO de `dados` no
 * envelope, e o `apiGet` o descarta. Paginação de servidor porque isto é a
 * lápide do sistema inteiro e não cabe numa resposta.
 *
 * @param {Object} params - page, limit e os filtros
 * @returns {Promise<{dados: Array, pagination: Object}>}
 */
export const getRastreabilidade = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([chave, valor]) => {
    if (valor !== null && valor !== undefined && valor !== '') query.set(chave, valor);
  });
  return apiGetPaginado(`/auditoria?${query.toString()}`);
};

/**
 * As opções dos combos, já recortadas pelo perfil de quem pergunta.
 *
 * Rota separada porque a tela as pede UMA vez e a lista muda a cada filtro;
 * junto dos eventos, elas seriam recalculadas a cada página.
 * @returns {Promise<Object>}
 */
export const getFiltrosRastreabilidade = () => apiGet('/auditoria/filtros');
