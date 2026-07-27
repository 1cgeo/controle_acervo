const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

/**
 * Format a date (ISO string or Date) as DD/MM/YYYY.
 * Date-only strings (YYYY-MM-DD) are formatted without timezone conversion
 * to avoid off-by-one-day shifts.
 * @param {string|Date} value
 * @returns {string} - DD/MM/YYYY or '-' when empty/invalid
 */
export function formatDate(value) {
  if (!value) return '-';

  if (typeof value === 'string') {
    const match = DATE_ONLY_RE.exec(value);
    if (match && !value.includes('T')) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Format a datetime (ISO string or Date) as DD/MM/YYYY HH:mm.
 * @param {string|Date} value
 * @returns {string}
 */
export function formatDateTime(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a number with pt-BR locale grouping.
 * @param {number|string} num
 * @returns {string}
 */
export function formatNumber(num) {
  if (num === null || num === undefined || num === '') return '-';
  const parsed = Number(num);
  if (isNaN(parsed)) return '-';
  return parsed.toLocaleString('pt-BR');
}

/**
 * Format a value as BRL currency (R$ 1.234,56).
 * @param {number|string} value
 * @returns {string}
 */
export function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '-';
  const parsed = Number(value);
  if (isNaN(parsed)) return '-';
  return parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Convert a Date (or date-like) to ISO date string (YYYY-MM-DD) for API payloads.
 * @param {Date|string} value
 * @returns {string|null}
 */
export function toIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = DATE_ONLY_RE.exec(value);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/**
 * Get the pt-BR month name for a month number (1-12).
 * @param {number} mes - 1 to 12
 * @returns {string}
 */
export function monthName(mes) {
  const idx = Number(mes) - 1;
  return MONTH_NAMES[idx] || String(mes);
}
