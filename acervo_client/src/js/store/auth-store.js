const AUTH_KEYS = {
  TOKEN: '@sca_dashboard-Token',
  EXPIRY: '@sca_dashboard-Token-Expiry',
  AUTHORIZATION: '@sca_dashboard-User-Authorization',
  UUID: '@sca_dashboard-User-uuid',
  USERNAME: '@sca_dashboard-User-username',
};

export function getToken() {
  return localStorage.getItem(AUTH_KEYS.TOKEN);
}

export function getUsername() {
  return localStorage.getItem(AUTH_KEYS.USERNAME) || '';
}

export function getUserUuid() {
  return localStorage.getItem(AUTH_KEYS.UUID) || '';
}

export function isAuthenticated() {
  const token = getToken();
  const expiry = localStorage.getItem(AUTH_KEYS.EXPIRY);
  if (!token || !expiry) return false;
  return new Date(expiry) > new Date();
}

export function isAdmin() {
  return localStorage.getItem(AUTH_KEYS.AUTHORIZATION) === 'ADMIN';
}

// Decode the exp claim from a JWT. Returns a Date or null when absent/invalid.
function decodeJwtExpiry(token) {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return null;
    const normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    if (typeof payload.exp !== 'number') return null;
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}

/**
 * Save auth data after successful login.
 * @param {Object} data - { token, administrador, uuid }
 * @param {string} username
 */
export function saveAuth(data, username) {
  const expiry = decodeJwtExpiry(data.token) || (() => {
    const fallback = new Date();
    fallback.setHours(fallback.getHours() + 1);
    return fallback;
  })();

  localStorage.setItem(AUTH_KEYS.TOKEN, data.token);
  localStorage.setItem(AUTH_KEYS.EXPIRY, expiry.toISOString());
  localStorage.setItem(AUTH_KEYS.AUTHORIZATION, data.administrador ? 'ADMIN' : 'USER');
  localStorage.setItem(AUTH_KEYS.UUID, data.uuid);
  localStorage.setItem(AUTH_KEYS.USERNAME, username);
}

/**
 * Clear all auth data and redirect to login.
 */
export function logout() {
  Object.values(AUTH_KEYS).forEach(key => localStorage.removeItem(key));
  window.location.hash = '#/login';
}
