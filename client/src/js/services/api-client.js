import { getToken, logout } from '@store/auth-store.js';

/**
 * Make a GET request to the API.
 * @param {string} endpoint - e.g. '/dashboard/produtos_total'
 * @returns {Promise<any>} - The `dados` field from the response
 */
export async function apiGet(endpoint) {
  return apiRequest('GET', endpoint);
}

/**
 * Make a POST request to the API.
 * @param {string} endpoint
 * @param {Object} body
 * @returns {Promise<any>}
 */
export async function apiPost(endpoint, body = {}) {
  return apiRequest('POST', endpoint, body);
}

async function apiRequest(method, endpoint, body = undefined) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`/api${endpoint}`, options);

  if (response.status === 401 || response.status === 403) {
    logout();
    throw new Error('Sessao expirada');
  }

  const json = await response.json();

  if (!json.success) {
    throw new Error(json.message || 'Erro na requisicao');
  }

  return json.dados;
}
