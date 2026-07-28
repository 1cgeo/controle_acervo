import { getToken, clearAuth, atualizarSessao } from '@store/auth-store.js';

/**
 * All server responses follow { version, success, message, dados, error }.
 * On success the `dados` payload is returned; on failure an Error is thrown
 * with the server `message` verbatim (so toasts can show it as-is).
 *
 * 401 E 403 SAO COISAS DIFERENTES, e tratar os dois igual custou caro:
 *
 *   401 = a sessao acabou (token vencido, invalido, usuario inativo). Limpa e
 *         manda para o login.
 *   403 = a sessao esta viva e a pessoa nao tem perfil para AQUELA acao
 *         (verifyPerfil). Ate 2026-07-28 isto tambem deslogava, com a mensagem
 *         "Sessão expirada": quem clicava num botao que nao podia usar era
 *         expulso do sistema e perdia o que estava preenchendo.
 *
 * No 403 a mensagem do servidor ja diz o que falta ("Usuário necessita do
 * perfil gerente no módulo mapoteca"), entao ela sobe para o toast como esta, e
 * de quebra o perfil guardado no client e reconferido: se ele mudou, a tela
 * inteira se recarrega para parar de oferecer o que nao pode mais.
 */

function handleSessaoExpirada() {
  // Guarda a rota COMPLETA (com o prefixo do modulo) para voltar depois do login.
  const current = location.hash.slice(1) || '/';
  clearAuth();
  if (!current.startsWith('/login')) {
    location.hash = `/login?from=${encodeURIComponent(current)}`;
  }
}

/** Mensagem do envelope, com um padrao quando o corpo nao for legivel. */
async function mensagemDaResposta(response, padrao) {
  try {
    const json = await response.json();
    if (json && json.message) return json.message;
  } catch {
    // corpo ilegivel: fica o padrao
  }
  return padrao;
}

/**
 * Evento disparado quando a autorizacao guardada no client deixou de bater com
 * a do servidor. Quem escuta e o index.js, que recarrega a pagina: a sidebar e
 * os botoes sao montados uma vez, entao nao adianta so trocar o localStorage.
 *
 * E um evento, e nao um location.reload() aqui dentro, para o api-client nao
 * decidir navegacao: ele reporta o fato, a aplicacao decide o que fazer.
 */
export const EVENTO_SESSAO_MUDOU = 'sca:sessao-mudou';

/**
 * Reconfere no servidor o perfil que o client guardou no login.
 *
 * Usa fetch cru de proposito, para nao reentrar no tratamento de erro daqui.
 * Um 401 aqui significa que a sessao acabou de verdade, e ai sim desloga.
 *
 * @returns {Promise<boolean>} - true quando a autorizacao mudou
 */
export async function sincronizarSessao() {
  const token = getToken();
  if (!token) return false;

  let response;
  try {
    response = await fetch('/api/login/sessao', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Sem rede: mantem o que ja esta guardado.
    return false;
  }

  // Reconferir e melhoria, nunca pre-requisito: qualquer resposta estranha
  // (inclusive nenhuma) mantem o que ja esta guardado.
  if (!response) return false;
  if (response.status === 401) {
    handleSessaoExpirada();
    return false;
  }
  if (!response.ok) return false;

  try {
    const json = await response.json();
    if (!json || !json.success || !json.dados) return false;
    const mudou = atualizarSessao(json.dados);
    if (mudou) window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_MUDOU));
    return mudou;
  } catch {
    return false;
  }
}

/**
 * 403: nao desloga. Reconfere o perfil, e a sincronizacao avisa por evento se
 * ele mudou, para o menu e os botoes voltarem a bater com o que o servidor
 * aceita.
 * @param {Response} response
 * @param {string} padrao
 * @returns {Promise<Error>} - o erro a ser lancado por quem chamou
 */
async function tratarProibido(response, padrao) {
  const message = await mensagemDaResposta(response, padrao);
  await sincronizarSessao();
  return new Error(message);
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

  // Sessao acabou: limpa e volta ao login. No proprio /login um 401 e so
  // credencial errada, entao segue para o tratamento comum de erro.
  if (response.status === 401 && endpoint !== '/login') {
    handleSessaoExpirada();
    throw new Error(
      await mensagemDaResposta(response, 'Sessão expirada. Faça login novamente.')
    );
  }

  // Sem perfil para esta acao: a sessao continua de pe.
  if (response.status === 403 && endpoint !== '/login') {
    throw await tratarProibido(response, 'Você não tem perfil para esta ação.');
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
 * @param {string} endpoint - e.g. '/notas_credito'
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
 * Upload one or more files via multipart/form-data with the Bearer token.
 * Does NOT set Content-Type: the browser adds it with the correct boundary.
 * Same envelope/401-403 handling as apiRequest; returns the `dados` payload.
 * @param {string} endpoint - e.g. '/arquivo?nota_credito_id=5'
 * @param {FormData} formData - body with the file(s)
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

  if (response.status === 401) {
    handleSessaoExpirada();
    throw new Error(
      await mensagemDaResposta(response, 'Sessão expirada. Faça login novamente.')
    );
  }

  if (response.status === 403) {
    throw await tratarProibido(response, 'Você não tem perfil para enviar arquivo.');
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${response.status})`);
  }

  if (!response.ok || !json.success) {
    throw new Error(json.message || 'Erro no envio do arquivo');
  }

  return json.dados;
}

/**
 * Download a file (e.g. CSV export) with the Bearer token.
 * Fetches the endpoint as a blob and triggers a browser download.
 * @param {string} endpoint - e.g. '/relatorio/secao3/markdown?ano=2026&mes=5'
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

  if (response.status === 401) {
    handleSessaoExpirada();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  if (response.status === 403) {
    throw await tratarProibido(response, 'Você não tem perfil para baixar este arquivo.');
  }

  if (!response.ok) {
    throw new Error(
      await mensagemDaResposta(response, `Erro ao baixar arquivo (HTTP ${response.status})`)
    );
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
