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
    throw new Error('Sessão expirada');
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${response.status})`);
  }

  if (!json.success) {
    throw new Error(json.message || 'Erro na requisição');
  }

  return json.dados;
}

/**
 * Download a binary file (e.g. a ZIP export) from the API with auth and
 * trigger a browser download. Throws on error.
 * @param {string} endpoint - e.g. '/acervo/export-planilha-csv'
 * @param {string} filename - suggested download filename
 */
export async function downloadFile(endpoint, filename) {
  const token = getToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`/api${endpoint}`, { method: 'GET', headers });

  if (response.status === 401 || response.status === 403) {
    logout();
    throw new Error('Sessão expirada');
  }

  if (!response.ok) {
    throw new Error(`Falha na exportação (HTTP ${response.status})`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
