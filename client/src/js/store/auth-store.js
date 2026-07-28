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
 * O que a pessoa pode NESTE modulo, num objeto so, para a tela decidir o que
 * mostrar sem repetir o nome do modulo em cada botao:
 *
 *   const pode = permissoes('mapoteca')
 *   if (pode.gerente) cabecalho.appendChild(novoClienteBtn)
 *
 * O nome do campo e o MESMO nivel que o `verifyPerfil` da rota exige no
 * servidor, entao o gate da tela se le ao lado do gate real: escrever
 * `pode.gerente` onde o servidor pede `verifyPerfil('gerente', 'mapoteca')`.
 * Esconder botao e ERGONOMIA, nunca seguranca: quem barra e o servidor.
 *
 * @param {string} modulo - nome_abrev do modulo
 * @returns {{consulta:boolean, operador:boolean, gerente:boolean, admin:boolean}}
 */
export function permissoes(modulo) {
  return {
    consulta: temPerfil('consulta', modulo),
    operador: temPerfil('operador', modulo),
    gerente: temPerfil('gerente', modulo),
    admin: isAdmin(),
  };
}

/**
 * Save auth data after a successful login.
 * Token expiry is stored as now + 1h (JWT lifetime).
 * @param {Object} data - { token, administrador, uuid, perfis, modulos }
 * @param {string} username
 */
/**
 * Momento em que o token expira, LIDO DO PROPRIO TOKEN (claim `exp`).
 *
 * Ate 2026-07-27 isto era `agora + 1 hora`, fixo no codigo, duplicando um valor
 * que so o servidor conhece. Quando a duracao do servidor virou 8h (chave
 * JWT_EXPIRACAO), o client continuaria deslogando em 1h: o conserto pela metade
 * pareceria pronto e a pessoa seguiria caindo fora no meio do trabalho.
 *
 * Lendo o `exp`, os dois lados nunca mais divergem. Se o token nao trouxer
 * `exp`, cai em 1 hora, que e o comportamento antigo e conservador.
 * @param {string} token
 * @returns {Date}
 */
function expiracaoDoToken(token) {
  try {
    const payload = String(token).split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json).exp;
    if (typeof exp === 'number') return new Date(exp * 1000);
  } catch {
    // Token ilegivel: cai no padrao abaixo.
  }
  const padrao = new Date();
  padrao.setHours(padrao.getHours() + 1);
  return padrao;
}

export function saveAuth(data, username) {
  const expiry = expiracaoDoToken(data.token);

  localStorage.setItem(AUTH_KEYS.TOKEN, data.token);
  localStorage.setItem(AUTH_KEYS.EXPIRY, expiry.toISOString());
  localStorage.setItem(AUTH_KEYS.AUTHORIZATION, data.administrador ? 'ADMIN' : 'USER');
  localStorage.setItem(AUTH_KEYS.PERFIS, JSON.stringify(data.perfis || {}));
  localStorage.setItem(AUTH_KEYS.MODULOS, JSON.stringify(data.modulos || []));
  localStorage.setItem(AUTH_KEYS.UUID, data.uuid || '');
  localStorage.setItem(AUTH_KEYS.USERNAME, username);
}

/**
 * Reescreve SO a autorizacao (administrador, perfis e catalogo de modulos) a
 * partir do GET /api/login/sessao, sem tocar em token, validade nem login.
 *
 * O login e um retrato: quem foi rebaixado no meio do expediente continuava
 * vendo botao que o servidor ja recusava. Isto atualiza o retrato sem obrigar
 * a pessoa a sair e entrar de novo.
 *
 * @param {Object} data - { administrador, perfis, modulos }
 * @returns {boolean} - true quando algo de fato mudou
 */
export function atualizarSessao(data) {
  const autorizacaoNova = data.administrador ? 'ADMIN' : 'USER';
  const perfisNovos = JSON.stringify(data.perfis || {});
  const modulosNovos = JSON.stringify(data.modulos || []);

  const mudou =
    localStorage.getItem(AUTH_KEYS.AUTHORIZATION) !== autorizacaoNova ||
    localStorage.getItem(AUTH_KEYS.PERFIS) !== perfisNovos ||
    localStorage.getItem(AUTH_KEYS.MODULOS) !== modulosNovos;

  localStorage.setItem(AUTH_KEYS.AUTHORIZATION, autorizacaoNova);
  localStorage.setItem(AUTH_KEYS.PERFIS, perfisNovos);
  localStorage.setItem(AUTH_KEYS.MODULOS, modulosNovos);

  return mudou;
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
