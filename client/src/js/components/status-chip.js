import { el } from '@utils/dom.js';

/**
 * Map of situacao_pedido_id -> chip color variant.
 * 2 Pedido Recebido, 3 Em andamento, 4 Remetido, 5 Concluído, 6 Cancelado,
 * 7 Aguardando produção, 8 Aguardando envio.
 *
 * O 8 REPETE o amarelo do 7 de propósito: as duas são esperas, e a paleta de
 * `chips.css` tem sete variantes, das quais 'default' é o cinza que o
 * `|| 'default'` já reserva para code desconhecido. Pintar o 8 de cinza o
 * faria parecer um code que a tela não conhece. Quem desempata os dois é o
 * RÓTULO, que o servidor escreve.
 *
 * COMEÇA NO 2 de propósito: o code 1 (Pré cadastramento) saiu do domínio em
 * 2026-08-08, e a lacuna na numeração fica, porque code de domínio não se
 * renumera. O `|| 'default'` de `chipSituacaoPedido` cobre qualquer code que
 * não esteja aqui, então nada quebra se um registro antigo aparecer.
 */
const SITUACAO_PEDIDO_VARIANT = {
  2: 'info',
  3: 'primary',
  4: 'secondary',
  5: 'success',
  6: 'error',
  7: 'warning',
  8: 'warning',
};

/**
 * Create a status chip.
 * @param {string} label
 * @param {'default'|'info'|'primary'|'secondary'|'success'|'error'|'warning'} [variant]
 * @returns {HTMLElement}
 */
export function chip(label, variant = 'default') {
  return el('span', { className: `chip chip--${variant}`, textContent: label });
}

/**
 * Create a chip colored by situacao_pedido_id.
 * @param {number} situacaoPedidoId - 2..8
 * @param {string} nome - display label (e.g. 'Em andamento')
 * @returns {HTMLElement}
 */
export function chipSituacaoPedido(situacaoPedidoId, nome) {
  const variant = SITUACAO_PEDIDO_VARIANT[situacaoPedidoId] || 'default';
  return chip(nome || `Situação ${situacaoPedidoId}`, variant);
}

/**
 * Create a solid badge (e.g. the red "Abaixo do mínimo" stock badge).
 * @param {string} label
 * @param {'error'|'warning'|'success'} [variant]
 * @returns {HTMLElement}
 */
export function badge(label, variant = 'error') {
  return el('span', { className: `badge badge--${variant}`, textContent: label });
}

/**
 * Convenience: the red "Abaixo do mínimo" badge for material stock.
 * @returns {HTMLElement}
 */
export function badgeAbaixoMinimo() {
  return badge('Abaixo do mínimo', 'error');
}
