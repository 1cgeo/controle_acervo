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

/**
 * Save auth data after successful login.
 * @param {Object} data - { token, administrador, uuid }
 * @param {string} username
 */
export function saveAuth(data, username) {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 1);

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
