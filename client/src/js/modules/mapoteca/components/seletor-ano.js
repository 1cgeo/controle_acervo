import { criarSeletorAno as criarSeletorAnoBase } from '@components/seletor-ano.js';
import { getAnosMapoteca } from '../services/mapoteca-service.js';
import * as yearStore from '../store/year-store.js';

/**
 * Seletor de ano do modulo MAPOTECA, montado na navbar via `navbarExtras`.
 *
 * Lista os anos que TÊM pedido ou entrega, mais o ano de contexto. Sem "+ Outro
 * ano…", ao contrario do orcamento: aqui o ano so filtra o que ja aconteceu, e
 * escolher um ano sem movimento nenhum so entregaria telas em branco.
 * @returns {{elements: Array<HTMLElement>, cleanup: Function}}
 */
export function criarSeletorAno() {
  return criarSeletorAnoBase({
    store: yearStore,
    carregarAnos: getAnosMapoteca,
    title: 'Ano de referência (filtra os painéis por ano da mapoteca)',
  });
}
