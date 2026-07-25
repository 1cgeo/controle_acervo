const AUTH_KEYS = {
  TOKEN: '@mapoteca-Token',
  EXPIRY: '@mapoteca-Token-Expiry',
  PERFIS: '@perfis-por-modulo',
  AUTHORIZATION: '@mapoteca-User-Authorization',
  UUID: '@mapoteca-User-uuid',
  USERNAME: '@mapoteca-User-username',
};

/** Get the stored JWT token (or null). */
export function getToken() {
  return localStorage.getItem(AUTH_KEYS.TOKEN);
}

/** Get the stored username (login). */
export function getUsername() {
  return localStorage.getItem(AUTH_KEYS.USERNAME) || '';
}

/** Get the stored user UUID. */
export function getUserUuid() {
  return localStorage.getItem(AUTH_KEYS.UUID) || '';
}

/**
 * Check whether there is a valid (non-expired) session.
 * @returns {boolean}
 */
export function isAuthenticated() {
  const token = getToken();
  const expiry = localStorage.getItem(AUTH_KEYS.EXPIRY);
  if (!token || !expiry) return false;
  return new Date(expiry) > new Date();
}

/**
 * Check whether the logged user has the ADMIN role.
 * @returns {boolean}
 */
// Administrador e GLOBAL: vale em qualquer modulo, e nao ha administrador de
// modulo. Os niveis abaixo (consulta, operador, gerente) sao por modulo.
export function isAdmin() {
  return localStorage.getItem(AUTH_KEYS.AUTHORIZATION) === 'ADMIN';
}

export const NIVEL = { consulta: 1, operador: 2, gerente: 3 };

/** Perfil do usuario num modulo (0 quando nao tem nenhum). */
export function getPerfil(modulo = 'mapoteca') {
  try {
    const perfis = JSON.parse(localStorage.getItem(AUTH_KEYS.PERFIS) || '{}');
    return perfis[modulo] || 0;
  } catch {
    return 0;
  }
}

/** Hierarquico: gerente satisfaz operador e consulta. Admin satisfaz tudo. */
export function temPerfil(minimo, modulo = 'mapoteca') {
  if (isAdmin()) return true;
  return getPerfil(modulo) >= (NIVEL[minimo] || 0);
}

/**
 * Save auth data after a successful login.
 * Token expiry is stored as now + 1h (JWT lifetime).
 * @param {Object} data - { token, administrador, uuid, perfis }
 * @param {string} username
 */
export function saveAuth(data, username) {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 1);

  localStorage.setItem(AUTH_KEYS.TOKEN, data.token);
  localStorage.setItem(AUTH_KEYS.EXPIRY, expiry.toISOString());
  localStorage.setItem(AUTH_KEYS.AUTHORIZATION, data.administrador ? 'ADMIN' : 'USER');
  localStorage.setItem(AUTH_KEYS.PERFIS, JSON.stringify(data.perfis || {}));
  localStorage.setItem(AUTH_KEYS.UUID, data.uuid || '');
  localStorage.setItem(AUTH_KEYS.USERNAME, username);
}

/**
 * Clear all auth data (does not redirect).
 */
export function clearAuth() {
  Object.values(AUTH_KEYS).forEach(key => localStorage.removeItem(key));
}

/**
 * Clear all auth data and redirect to login.
 */
export function logout() {
  clearAuth();
  window.location.hash = '#/login';
}
