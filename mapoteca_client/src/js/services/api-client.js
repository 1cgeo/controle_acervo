import { getToken, clearAuth } from '@store/auth-store.js';

/**
 * All server responses follow { version, success, message, dados, error }.
 * On success the `dados` payload is returned; on failure an Error is thrown
 * with the server `message` verbatim (so toasts can show it as-is).
 * On 401/403 the session is cleared and the user is redirected to
 * #/login?from=<current route>.
 */

function handleAuthError() {
  const current = location.hash.slice(1) || '/dashboard';
  clearAuth();
  if (!current.startsWith('/login')) {
    location.hash = `/login?from=${encodeURIComponent(current)}`;
  }
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

  // Auth failure: logout + redirect (except for the login request itself,
  // where a 401 simply means invalid credentials)
  if ((response.status === 401 || response.status === 403) && endpoint !== '/login') {
    handleAuthError();
    let message = 'Sessão expirada. Faça login novamente.';
    try {
      const json = await response.json();
      if (json && json.message) message = json.message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${response.status})`);
  }

  if (!response.ok || !json.success) {
    throw new Error(json.message || 'Erro na requisição');
  }

  return json.dados;
}

/**
 * GET request. Returns the `dados` payload.
 * @param {string} endpoint - e.g. '/mapoteca/pedido'
 * @returns {Promise<any>}
 */
export function apiGet(endpoint) {
  return apiRequest('GET', endpoint);
}

/**
 * POST request. Returns the `dados` payload.
 * @param {string} endpoint
 * @param {Object} [body]
 * @returns {Promise<any>}
 */
export function apiPost(endpoint, body = {}) {
  return apiRequest('POST', endpoint, body);
}

/**
 * PUT request. Returns the `dados` payload.
 * @param {string} endpoint
 * @param {Object} [body]
 * @returns {Promise<any>}
 */
export function apiPut(endpoint, body = {}) {
  return apiRequest('PUT', endpoint, body);
}

/**
 * DELETE request (bulk deletes send body like { cliente_ids: [1, 2] }).
 * @param {string} endpoint
 * @param {Object} [body]
 * @returns {Promise<any>}
 */
export function apiDelete(endpoint, body = undefined) {
  return apiRequest('DELETE', endpoint, body);
}

/**
 * Download a file (e.g. CSV export) with the Bearer token.
 * Fetches the endpoint as a blob and triggers a browser download.
 * @param {string} endpoint - e.g. '/mapoteca/relatorio/pedidos_mil?ano=2026&formato=csv'
 * @param {string} fallbackFilename - used when Content-Disposition is absent
 * @returns {Promise<void>}
 */
export async function apiDownload(endpoint, fallbackFilename) {
  const token = getToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`/api${endpoint}`, { headers });

  if (response.status === 401 || response.status === 403) {
    handleAuthError();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  if (!response.ok) {
    let message = `Erro ao baixar arquivo (HTTP ${response.status})`;
    try {
      const json = await response.json();
      if (json && json.message) message = json.message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  let filename = fallbackFilename;
  const disposition = response.headers.get('Content-Disposition');
  if (disposition) {
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    if (match) filename = decodeURIComponent(match[1]);
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

/**
 * Multipart upload (FormData) with the Bearer token. Do NOT set Content-Type:
 * the browser adds the multipart boundary. Returns the `dados` payload.
 * @param {string} endpoint
 * @param {FormData} formData - must include the file under the field the API expects
 * @returns {Promise<any>}
 */
export async function apiUpload(endpoint, formData) {
  const token = getToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`/api${endpoint}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if ((response.status === 401 || response.status === 403) && endpoint !== '/login') {
    handleAuthError();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${response.status})`);
  }

  if (!response.ok || !json.success) {
    throw new Error(json.message || 'Erro no upload do arquivo');
  }

  return json.dados;
}
