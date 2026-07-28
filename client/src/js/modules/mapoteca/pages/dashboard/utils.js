import { monthName } from '@utils/format.js';

/**
 * Rotulo curto de mes ('Jan/26') para uma data ISO, sem passar por Date.
 *
 * Sem isto, `new Date('2026-01-01')` volta em UTC e, num fuso a oeste, o mes
 * exibido escorrega para dezembro do ano anterior. O corte por string nao tem
 * fuso nenhum para errar.
 *
 * @param {string} mesIso
 * @returns {string}
 */
export function mesLabel(mesIso) {
  const [ano, mes] = String(mesIso).slice(0, 10).split('-');
  if (!ano || !mes) return String(mesIso);
  return `${monthName(Number(mes)).slice(0, 3)}/${ano.slice(2)}`;
}
