import { criarSeletorAno as criarSeletorAnoBase } from '@components/seletor-ano.js';
import { getAnos } from '../services/orcamento-service.js';
import * as yearStore from '../store/year-store.js';

/**
 * Seletor de ano do modulo ORCAMENTO, montado na navbar via `navbarExtras`.
 *
 * Lista os anos com dado e o ano de contexto atual. "+ Outro ano…" existe aqui,
 * e nao na mapoteca, porque no orcamento o ano tambem decide ONDE se cadastra:
 * comecar a lancar um exercicio novo passa por escolher um ano ainda vazio.
 * @returns {{elements: Array<HTMLElement>, cleanup: Function}}
 */
export function criarSeletorAno() {
  return criarSeletorAnoBase({
    store: yearStore,
    carregarAnos: getAnos,
    permitirOutroAno: true,
    title: 'Ano de referência (define o ano em que você cadastra)',
  });
}
