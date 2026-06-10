/**
 * Order tracking code format (RN04): XXXX-XXXX-XXXX, uppercase alphanumeric.
 */
export const LOCALIZADOR_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/**
 * Normalize user input (trim + uppercase).
 * @param {string} value
 * @returns {string}
 */
export function normalizeLocalizador(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * Validate the localizador format.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidLocalizador(value) {
  return LOCALIZADOR_REGEX.test(normalizeLocalizador(value));
}
