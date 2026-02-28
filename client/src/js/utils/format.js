/**
 * Format a date string to locale format.
 * @param {string} dateStr - ISO date string or YYYY-MM-DD
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string}
 */
export function formatDate(dateStr, options = {}) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  const defaults = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options,
  };
  return date.toLocaleDateString('pt-BR', defaults);
}

/**
 * Format a date string to include time.
 */
export function formatDateTime(dateStr) {
  return formatDate(dateStr, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format bytes to human-readable size.
 * @param {number} bytes
 * @param {number} decimals
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0 || bytes === null || bytes === undefined) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Format a number with locale grouping.
 * @param {number} num
 * @returns {string}
 */
export function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  return Number(num).toLocaleString('pt-BR');
}

/**
 * Format GB value with suffix.
 * @param {number} gb
 * @returns {string}
 */
export function formatGB(gb) {
  if (gb === null || gb === undefined) return '-';
  return `${Number(gb).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}

/**
 * Format a month string (YYYY-MM) to locale.
 * @param {string} monthStr - e.g. "2024-03"
 * @returns {string}
 */
export function formatMonth(monthStr) {
  if (!monthStr) return '-';
  const [year, month] = monthStr.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

/**
 * Format MB from bytes.
 */
export function bytesToMB(bytes) {
  if (!bytes) return '0.00';
  return (bytes / (1024 * 1024)).toFixed(2);
}

/**
 * Get file extension from filename.
 */
export function getExtension(filename) {
  if (!filename) return '-';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toUpperCase() : '-';
}
