// Sessao UNICA da plataforma SCA. Os tres modulos (acervo, mapoteca, orcamento)
// vivem na mesma origem e no mesmo client, entao a chave de sessao e uma so, com
// o prefixo '@sca-'. Antes cada client tinha o seu ('@mapoteca-*', '@orcamento-*'),
// o que obrigava a mesma pessoa a logar duas vezes no mesmo navegador.

const AUTH_KEYS = {
  TOKEN: '@sca-Token',
  EXPIRY: '@sca-Token-Expiry',
  AUTHORIZATION: '@sca-User-Authorization',
  PERFIS: '@sca-perfis',
  MODULOS: '@sca-modulos',
  UUID: '@sca-User-uuid',
  USERNAME: '@sca-User-username',
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
 * Administrador e GLOBAL: vale em qualquer modulo, e nao ha administrador de
 * modulo. Os niveis abaixo (consulta, operador, gerente) sao por modulo.
 * @returns {boolean}
 */
export function isAdmin() {
  return localStorage.getItem(AUTH_KEYS.AUTHORIZATION) === 'ADMIN';
}

export const NIVEL = { consulta: 1, operador: 2, gerente: 3 };

function lerJson(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return padrao;
    const valor = JSON.parse(bruto);
    return valor === null || valor === undefined ? padrao : valor;
  } catch {
    return padrao;
  }
}

/**
 * Mapa modulo -> nivel devolvido pelo POST /api/login, fora do token de proposito.
 * @returns {Object}
 */
export function getPerfis() {
  return lerJson(AUTH_KEYS.PERFIS, {});
}

/**
 * Catalogo de modulos do servidor: [{ code, nome, nome_abrev }].
 * A tela usa isto para o NOME do modulo, em vez de decorar codigo ou rotulo.
 * @returns {Array<{code:number, nome:string, nome_abrev:string}>}
 */
export function getCatalogoModulos() {
  const lista = lerJson(AUTH_KEYS.MODULOS, []);
  return Array.isArray(lista) ? lista : [];
}

/**
 * Nome de exibicao de um modulo, vindo do catalogo do servidor.
 * @param {string} modulo - nome_abrev (ex.: 'orcamento')
 * @returns {string} - o nome do catalogo, ou o proprio nome_abrev quando ele faltar
 */
export function nomeModulo(modulo) {
  const achado = getCatalogoModulos().find(m => m.nome_abrev === modulo);
  return achado ? achado.nome : modulo;
}

/**
 * Perfil do usuario num modulo (0 quando nao tem nenhum).
 * @param {string} modulo - nome_abrev do modulo
 * @returns {number}
 */
export function getPerfil(modulo) {
  return getPerfis()[modulo] || 0;
}

/**
 * Hierarquico: gerente satisfaz operador e consulta. Admin satisfaz tudo.
 * @param {'consulta'|'operador'|'gerente'} minimo
 * @param {string} modulo - nome_abrev do modulo
 * @returns {boolean}
 */
export function temPerfil(minimo, modulo) {
  if (isAdmin()) return true;
  return getPerfil(modulo) >= (NIVEL[minimo] || 0);
}

/**
 * A pessoa entra neste modulo? Administrador global entra em todos, mesmo sem
 * nenhuma linha de perfil.
 * @param {string} modulo - nome_abrev do modulo
 * @returns {boolean}
 */
export function temAcessoModulo(modulo) {
  if (isAdmin()) return true;
  return getPerfil(modulo) > 0;
}

/**
 * Save auth data after a successful login.
 * Token expiry is stored as now + 1h (JWT lifetime).
 * @param {Object} data - { token, administrador, uuid, perfis, modulos }
 * @param {string} username
 */
export function saveAuth(data, username) {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 1);

  localStorage.setItem(AUTH_KEYS.TOKEN, data.token);
  localStorage.setItem(AUTH_KEYS.EXPIRY, expiry.toISOString());
  localStorage.setItem(AUTH_KEYS.AUTHORIZATION, data.administrador ? 'ADMIN' : 'USER');
  localStorage.setItem(AUTH_KEYS.PERFIS, JSON.stringify(data.perfis || {}));
  localStorage.setItem(AUTH_KEYS.MODULOS, JSON.stringify(data.modulos || []));
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
