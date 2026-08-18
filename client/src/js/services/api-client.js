import { getToken, clearAuth, atualizarSessao } from '@store/auth-store.js';
import { PREFIXO_API } from '@utils/base-path.js';

/**
 * Teto de espera de uma requisição de DADOS.
 *
 * Existe por causa da FILA de navegação (`client/src/js/router.js`): o router
 * resolve uma rota por vez. Sem teto, um servidor pendurado prende a fila e a
 * tela inteira para de navegar. Antes da fila ele prendia só a página que
 * pediu, e dava para sair dela clicando no menu.
 *
 * 30 s é folga larga para leitura. O UPLOAD não usa este teto, e por isso a
 * função dele não chama `buscar`: arquivo grande leva minutos, e cortar em 30 s
 * quebraria o envio legítimo.
 */
const TIMEOUT_MS = 30000;

/**
 * `fetch` com prazo, e com o aborto traduzido para uma frase acionável.
 *
 * Sem a tradução o toast mostraria "signal is aborted without reason", que não
 * diz nem o que houve nem o que fazer.
 */
async function buscar(url, options = {}) {
  try {
    return await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS) });
  } catch (erro) {
    if (erro && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) {
      throw new Error('O servidor demorou demais para responder. Tente de novo.');
    }
    throw erro;
  }
}

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
 *         (verifyPerfil). Deslogar aqui expulsa do sistema, no meio do
 *         trabalho, quem so clicou num botao que a tela nao devia ter mostrado.
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
    response = await buscar(`${PREFIXO_API}/login/sessao`, {
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

async function apiRequest(
  method,
  endpoint,
  body = undefined,
  { envelope = false, aceitaFalhaParcial = false } = {}
) {
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

  const response = await buscar(`${PREFIXO_API}${endpoint}`, options);

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

  if (!response.ok || (!json.success && !aceitaFalhaParcial)) {
    const erro = new Error(json.message || 'Erro na requisição');
    // O STATUS SOBREVIVE AO THROW. Sem ele, quem chama nao distingue a recusa
    // que se CONFIRMA (409, como a importacao da 5.1 que apagaria um Resumo
    // escrito) de um erro de verdade, e teria de casar o texto da mensagem --
    // que muda no dia em que alguem melhora a frase. E acrescimo: quem so le
    // `err.message` continua igual.
    erro.status = response.status;
    throw erro;
  }

  return envelope ? json : json.dados;
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
 * GET de rota PAGINADA NO SERVIDOR: devolve o envelope inteiro.
 *
 * `apiGet` entrega so o `dados`, e para a esmagadora maioria das rotas isso e o
 * certo -- o resto do envelope e protocolo. As rotas paginadas do `/gerencia`
 * sao a excecao: elas poem `pagination` ao LADO de `dados`
 * (`sendJsonAndLog(..., dados, null, { pagination })`), e a contagem total, o
 * numero de paginas e a pagina atual so existem ali. Lidas por `apiGet`, essas
 * telas nao teriam como desenhar o rodape, nem como dizer "1-20 de 349".
 *
 * Uma funcao propria, e nao um parametro no `apiGet`: quem chama esta sabe que
 * recebe `{ dados, pagination }`, e nenhuma das dezenas de chamadas existentes
 * muda de forma.
 *
 * @param {string} endpoint
 * @returns {Promise<{dados:any, pagination?:{totalItems:number, totalPages:number,
 *   currentPage:number, pageSize:number}}>}
 */
export function apiGetPaginado(endpoint) {
  return apiRequest('GET', endpoint, undefined, { envelope: true });
}

/**
 * POST de rota em que FALHA PARCIAL e resultado, e nao erro.
 *
 * O envelope do SCA carrega `success`, e o normal e que `success: false`
 * signifique "nao fez". Ha uma excecao: a rota que opera em LOTE e conclui com
 * parte feita e parte falhada. `POST /arquivo/renomear-padrao` responde
 * `sendJsonAndLog(dados.falhas === 0, ...)`, ou seja, HTTP 200, `success` FALSO
 * e o `dados` inteiro do lado -- com quantos renomearam, quantos faltam e, no
 * `detalhe`, QUAL arquivo falhou e por que.
 *
 * Lida pelo `apiPost`, essa resposta vira excecao e o `dados` e jogado fora na
 * linha seguinte: o lote com uma falha em quinhentos arquivos anuncia
 * "0 renomeado(s)" sem dizer qual arquivo travou. Teste que mocke o SERVICO nao
 * pega isso, porque o duble resolve onde o real rejeita.
 *
 * A guarda de HTTP continua valendo: `!response.ok` lanca do mesmo jeito. O que
 * esta opcao tolera e so o `success: false` de uma resposta 200 com corpo.
 *
 * @param {string} endpoint
 * @param {Object} body
 * @returns {Promise<any>} o `dados`, mesmo quando `success` e falso
 */
export function apiPostComFalhaParcial(endpoint, body) {
  return apiRequest('POST', endpoint, body, { aceitaFalhaParcial: true });
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

  // `fetch` CRU, sem o prazo do `buscar`: aqui o corpo é arquivo, e o envio
  // legítimo leva minutos. Um teto de 30 s cortaria o upload no meio e o
  // servidor ficaria com sessão pendente para a limpeza fechar depois.
  const response = await fetch(`${PREFIXO_API}${endpoint}`, {
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
    xhr.open(metodo, `${PREFIXO_API}${endpoint}`);

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

  const response = await buscar(`${PREFIXO_API}${endpoint}`, { headers });

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
 * O nome de arquivo que o SERVIDOR mandou, lido do `Content-Disposition`.
 *
 * QUEM MANDA E O CABECALHO, e nao o nome que quem chamou montou. Os dois lados
 * sabiam montar o nome do Anuario, e duas montagens divergem no primeiro dia em
 * que uma delas muda -- foi o que aconteceu quando o nome passou a levar a sigla
 * da instituicao. O nome de la e o unico; o daqui e queda.
 *
 * DUAS FORMAS, e a ordem importa. `filename*=UTF-8''...` (RFC 5987) e a que
 * carrega charset e vem percent-encoded, entao ela ganha quando as duas
 * aparecem: o `filename=` ao lado dela existe para cliente antigo, e costuma ser
 * a versao degradada do nome. O `filename=` simples e literal e NAO se decodifica
 * -- decodificar 'Relatorio_100%_2026.ods' lancaria URIError e derrubaria um
 * download que estava indo bem.
 *
 * @param {string|null} disposition
 * @returns {string|null} o nome, ou null quando o cabecalho nao traz nenhum
 */
function nomeDoCabecalho(disposition) {
  if (!disposition) return null;

  const estendido = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(disposition);
  if (estendido) {
    const bruto = estendido[1].trim().replace(/^"|"$/g, '');
    try {
      return decodeURIComponent(bruto) || null;
    } catch {
      // Percent-encoding quebrado: o literal ainda e melhor que nenhum nome.
      return bruto || null;
    }
  }

  const simples = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  if (simples) return simples[1].trim() || null;

  return null;
}

/**
 * Download a file (e.g. CSV export) with the Bearer token.
 * Fetches the endpoint as a blob and triggers a browser download.
 * @param {string} endpoint - e.g. '/relatorio/secao3/markdown?ano=2026&mes=5'
 * @param {string} fallbackFilename - so vale quando o servidor NAO manda
 *   `Content-Disposition` com nome. O nome do servidor sempre ganha.
 * @returns {Promise<void>}
 */
export async function apiDownload(endpoint, fallbackFilename) {
  const token = getToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await buscar(`${PREFIXO_API}${endpoint}`, { headers });

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

  const filename =
    nomeDoCabecalho(response.headers.get('Content-Disposition')) || fallbackFilename;

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
