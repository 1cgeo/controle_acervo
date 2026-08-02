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
  return proibidoComMensagem(await mensagemDaResposta(response, padrao));
}

/**
 * O 403 a partir de uma mensagem ja extraida.
 *
 * Existe separado de `tratarProibido` porque o XMLHttpRequest nao produz um
 * `Response`: ele entrega texto. A REGRA do 403 (nao desloga, reconfere o
 * perfil, avisa por evento se ele mudou) e uma so, e duas copias dela
 * divergiriam no primeiro ajuste.
 * @param {string} message
 * @returns {Promise<Error>}
 */
async function proibidoComMensagem(message) {
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
 * Envia arquivo por multipart/form-data COM progresso de subida.
 *
 * Por que XMLHttpRequest, e nao `fetch`: o `fetch` nao reporta quanto do corpo
 * ja subiu. Ele resolve quando a resposta chega, e antes disso nao ha evento
 * nenhum. Para um arquivo de centenas de MB (o acervo tem ortoimagem de 3 GB)
 * isso e uma tela parada por minutos, sem diferenca visivel entre "enviando" e
 * "travado", e a pessoa cancela um envio que estava indo bem. O
 * `xhr.upload.onprogress` e a unica API de navegador que da esse numero.
 *
 * O `apiUpload` acima continua como esta, de proposito: o orçamento e a mapoteca
 * enviam anexo pequeno, onde a barra nao muda nada, e trocar a implementacao
 * deles cobraria o risco sem entregar o ganho.
 *
 * Devolve `{ promessa, abortar }` em vez de so a promessa porque cancelar e
 * parte do recurso: sem `abortar()`, fechar o assistente no meio de um envio de
 * 3 GB deixaria a subida correndo ate o fim, invisivel.
 *
 * @param {string} endpoint - ex.: '/arquivo/upload?session=abc'
 * @param {FormData} formData - corpo com o(s) arquivo(s)
 * @param {(info:{carregado:number, total:number, porcentagem:number|null})=>void} [onProgress]
 *   `porcentagem` vem null quando o navegador nao sabe o tamanho total.
 * @param {{metodo?:'POST'|'PUT'}} [opcoes]
 * @returns {{promessa:Promise<any>, abortar:Function}}
 */
export function apiUploadComProgresso(endpoint, formData, onProgress, { metodo = 'POST' } = {}) {
  const xhr = new XMLHttpRequest();
  let abortado = false;

  const promessa = new Promise((resolve, reject) => {
    xhr.open(metodo, `/api${endpoint}`);

    const token = getToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    // Content-Type NAO se declara: o navegador o escreve com o boundary certo.

    if (onProgress && xhr.upload) {
      xhr.upload.addEventListener('progress', (e) => {
        onProgress({
          carregado: e.loaded,
          total: e.total,
          porcentagem: e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null,
        });
      });
    }

    /** Mensagem do envelope no texto cru do XHR, com um padrao quando ilegivel. */
    const mensagem = (padrao) => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (json && json.message) return json.message;
      } catch {
        // corpo ilegivel: fica o padrao
      }
      return padrao;
    };

    xhr.addEventListener('load', async () => {
      // Sessao acabou: limpa e volta ao login, como no resto do api-client.
      if (xhr.status === 401) {
        handleSessaoExpirada();
        reject(new Error(mensagem('Sessão expirada. Faça login novamente.')));
        return;
      }

      // Sem perfil para esta acao: a sessao continua de pe.
      if (xhr.status === 403) {
        reject(await proibidoComMensagem(
          mensagem('Você não tem perfil para enviar arquivo.')
        ));
        return;
      }

      let json;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error(`Resposta inválida do servidor (HTTP ${xhr.status})`));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300 || !json.success) {
        reject(new Error(json.message || 'Erro no envio do arquivo'));
        return;
      }

      resolve(json.dados);
    });

    // Rede caiu no meio da subida. Distinguir de `abort` importa: um e falha, o
    // outro e a pessoa desistindo, e a tela nao deve pintar de vermelho o que
    // ela mesma pediu.
    xhr.addEventListener('error', () => {
      reject(new Error('Falha de rede durante o envio do arquivo'));
    });

    xhr.addEventListener('timeout', () => {
      reject(new Error('O envio do arquivo expirou'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Envio cancelado'));
    });

    xhr.send(formData);
  });

  return {
    promessa,
    abortar: () => {
      if (abortado) return;
      abortado = true;
      xhr.abort();
    },
  };
}

/**
 * Busca uma imagem da API e devolve uma URL de objeto para uma tag `img`.
 *
 * A tag de imagem não manda cabeçalho, então `src` apontando direto para a rota
 * chegaria sem o token e tomaria 401. Por isso a imagem vem por `fetch`, que
 * leva o Bearer, e vira `blob:` para o navegador desenhar.
 *
 * O cache HTTP continua valendo: `fetch` passa pelo cache do navegador, então a
 * segunda visita à mesma ficha revalida pela etiqueta e recebe 304, sem baixar
 * os bytes de novo.
 *
 * Devolve `null` quando não existe imagem (404), porque ausência é caso NORMAL
 * aqui: produto só vetorial não tem miniatura. Quem chama trata como "sem
 * imagem", e não como falha.
 *
 * IMPORTANTE: quem chama precisa liberar a URL com `URL.revokeObjectURL` ao
 * descartar o elemento. Sem isso o blob fica na memória da aba até recarregar,
 * e percorrer uma seleção de 50 produtos vazaria 50 imagens.
 *
 * @param {string} endpoint
 * @returns {Promise<string|null>} URL de objeto, ou null se não houver imagem
 */
export async function apiImagem(endpoint) {
  const token = getToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`/api${endpoint}`, { headers });

  if (response.status === 404) {
    return null;
  }

  if (response.status === 401) {
    handleSessaoExpirada();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  if (response.status === 403) {
    throw await tratarProibido(response, 'Você não tem perfil para ver esta imagem.');
  }

  if (!response.ok) {
    throw new Error(`Não foi possível carregar a imagem (HTTP ${response.status})`);
  }

  return URL.createObjectURL(await response.blob());
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
