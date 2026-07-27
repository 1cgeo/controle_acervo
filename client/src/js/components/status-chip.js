import { el } from '@utils/dom.js';

/**
 * Map of situacao_pedido_id -> chip color variant.
 * 1 Pré-cadastramento, 2 DIEx/Ofício recebido, 3 Em andamento, 4 Remetido,
 * 5 Concluído, 6 Cancelado, 7 Aguardando produção.
 */
export const SITUACAO_PEDIDO_VARIANT = {
  1: 'default',
  2: 'info',
  3: 'primary',
  4: 'secondary',
  5: 'success',
  6: 'error',
  7: 'warning',
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
 * @param {number} situacaoPedidoId - 1..7
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
