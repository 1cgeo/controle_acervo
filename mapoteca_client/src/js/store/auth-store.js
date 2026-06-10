const AUTH_KEYS = {
  TOKEN: '@mapoteca-Token',
  EXPIRY: '@mapoteca-Token-Expiry',
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
export function isAdmin() {
  return localStorage.getItem(AUTH_KEYS.AUTHORIZATION) === 'ADMIN';
}

/**
 * Save auth data after a successful login.
 * Token expiry is stored as now + 1h (JWT lifetime).
 * @param {Object} data - { token, administrador, uuid }
 * @param {string} username
 */
export function saveAuth(data, username) {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 1);

  localStorage.setItem(AUTH_KEYS.TOKEN, data.token);
  localStorage.setItem(AUTH_KEYS.EXPIRY, expiry.toISOString());
  localStorage.setItem(AUTH_KEYS.AUTHORIZATION, data.administrador ? 'ADMIN' : 'USER');
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
