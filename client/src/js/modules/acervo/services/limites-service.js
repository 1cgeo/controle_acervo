import { apiGet } from '@services/api-client.js';
import { cachedFetch, TTL_DOMINIO } from '@services/cache.js';

/**
 * Limite politico-administrativo: o contorno do estado ou do municipio
 * filtrado, para a tela destacar o lugar e enquadrar nele.
 *
 * Servico proprio, e nao mais uma funcao no acervo-service ou no
 * ponto-controle-service, pela mesma razao que a rota e propria no servidor: o
 * schema `limites` e dado de REFERENCIA. As DUAS telas o consultam, e pendurar
 * no servico de uma faria a outra importar do vizinho.
 */

/**
 * Contorno e caixa envolvente de um limite.
 *
 * Com cache de dominio: a malha do IBGE nao muda entre duas telas: quem alterna
 * estado e municipio no filtro pediria a mesma geometria varias vezes por
 * minuto, e o estado maior passa de algumas dezenas de KB.
 *
 * @param {'estado'|'municipio'} tipo
 * @param {number|string} id - codigo do IBGE
 * @returns {Promise<{tipo:string, id:number, nome:string, sigla:string|null,
 *   bbox:Array<number>, geometria:Object}>}
 */
export const getLimite = (tipo, id) =>
  cachedFetch(
    `limites:${tipo}:${id}`,
    () => apiGet(`/limites/${tipo}/${encodeURIComponent(id)}`),
    TTL_DOMINIO
  );
