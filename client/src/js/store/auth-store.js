// Sessao UNICA da plataforma SCA. Os modulos de tela (acervo, mapoteca,
// orcamento, equipamento)
// vivem na mesma origem e no mesmo client, entao a chave de sessao e uma so, com
// o prefixo '@sca-'. Antes cada client tinha o seu ('@mapoteca-*', '@orcamento-*'),
// o que obrigava a mesma pessoa a logar duas vezes no mesmo navegador.

import { clearCache } from '@services/cache.js';

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

const NIVEL = { consulta: 1, operador: 2, gerente: 3 };

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
function getPerfis() {
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
 * O perfil da pessoa neste modulo esta na LISTA? Nao e hierarquico.
 *
 * Existe porque nivel minimo nao descreve a mapoteca: la o
 * OPERADOR tem duas telas proprias (atender pedidos e consumo de material) e NAO
 * ve as telas de leitura, embora seja um nivel acima de consulta. Com
 * `temPerfil('consulta')` ele veria o dashboard, os clientes e os pedidos, que e
 * exatamente o que se quer evitar.
 *
 * Onde o minimo continua servindo (acervo, orcamento), nada muda: a rota declara
 * `perfil` e ninguem precisa listar nivel.
 *
 * Admin satisfaz qualquer lista.
 * @param {Array<'consulta'|'operador'|'gerente'>} perfis
 * @param {string} modulo - nome_abrev do modulo
 * @returns {boolean}
 */
export function ehDeAlgumPerfil(perfis, modulo) {
  if (isAdmin()) return true;
  const meu = getPerfil(modulo);
  return (perfis || []).some(p => NIVEL[p] === meu);
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
 * A pessoa TEM ACESSO AO SISTEMA? Administrador global tem, e quem tem qualquer
 * perfil em qualquer modulo tambem.
 *
 * ESTAR LOGADO E TER ACESSO NAO SAO A MESMA COISA. A conta que o administrador
 * acabou de criar nasce SEM linha em `dgeo.usuario_perfil`: ela entra, e nao ha
 * nada la dentro que seja dela. Para essa pessoa o sistema e uma tela so, a do
 * proprio cadastro, com o pedido de acesso; o resto aparece quando a concessao
 * chegar.
 *
 * Espelha o `verifyAcesso` do servidor, que pergunta o mesmo ao BANCO. Isto aqui
 * so evita oferecer uma tela que responderia 403.
 *
 * @returns {boolean}
 */
export function temAlgumAcesso() {
  if (isAdmin()) return true;
  return Object.values(getPerfis()).some(nivel => Number(nivel) > 0);
}

/**
 * Os acessos da pessoa, prontos para a tela: um item por modulo em que ela tem
 * perfil, com o NOME do modulo (do catalogo do servidor) e o do nivel.
 *
 * O administrador global sai com a lista dos modulos TODOS, marcados como
 * `administrador`: ele nao tem linha de perfil nenhuma, e uma lista vazia diria
 * a ele que nao tem acesso a nada.
 *
 * @returns {Array<{modulo:string, nome:string, nivel:number, perfil:string}>}
 */
export function meusAcessos() {
  const NOME_NIVEL = { 1: 'Consulta', 2: 'Operador', 3: 'Gerente' };

  if (isAdmin()) {
    return getCatalogoModulos().map(m => ({
      modulo: m.nome_abrev,
      nome: m.nome,
      nivel: 0,
      perfil: 'Administrador',
    }));
  }

  return Object.entries(getPerfis())
    .filter(([, nivel]) => Number(nivel) > 0)
    .map(([modulo, nivel]) => ({
      modulo,
      nome: nomeModulo(modulo),
      nivel: Number(nivel),
      perfil: NOME_NIVEL[Number(nivel)] || String(nivel),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * A pessoa e GERENTE de pelo menos um modulo?
 *
 * Existe para a tela de Rastreabilidade, que e do administrador global e do
 * gerente de qualquer modulo, e que por isso nao cabe no par `admin` /
 * `qualquer pessoa logada` que a sidebar tinha. Quem decide de verdade e o
 * `verifyRastreabilidade` do servidor, lendo o banco; isto aqui so evita
 * oferecer no menu uma tela que levaria 403.
 *
 * NAO inclui o administrador de proposito: quem chama decide se o soma, e nos
 * dois casos a leitura fica explicita (`isAdmin() || ehGerenteDeAlgumModulo()`).
 *
 * @returns {boolean}
 */
export function ehGerenteDeAlgumModulo() {
  return Object.values(getPerfis()).some(nivel => Number(nivel) >= NIVEL.gerente);
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
 * Momento em que o token expira, LIDO DO PROPRIO TOKEN (claim `exp`).
 *
 * NUNCA calcule `agora + N`: a duracao e do servidor (chave JWT_EXPIRACAO), e um
 * valor fixo aqui duplica o que so ele conhece. Quando os dois divergem, a
 * pessoa cai fora no meio do trabalho e o defeito parece consertado.
 *
 * Sem o claim `exp`, cai em 1 hora, que e o padrao conservador.
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

/**
 * Guarda a autenticacao depois de um login bem-sucedido.
 * @param {Object} data - { token, administrador, uuid, perfis, modulos }
 * @param {string} username
 */
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
 * Apaga a sessao inteira: o que esta no localStorage E o que o
 * `services/cache.js` guardou em memoria. Nao redireciona.
 *
 * O CACHE SAI JUNTO, e essa e a parte que faltava. As chaves do cache
 * ('pedidos:list', 'dominio:...') nao levam o dono, e as entradas duram ate 30
 * minutos. Quem saisse e entrasse como OUTRA pessoa na mesma aba recebia a lista
 * da anterior, sem chamada nenhuma ao servidor. So o botao "Sair" da navbar
 * limpava, e ele e uma das TRES portas: o 401 (`handleSessaoExpirada`) e a tela
 * de acesso negado passavam direto.
 *
 * A limpeza mora aqui, e nao em cada porta, porque encerrar sessao e UM fato: a
 * porta que se criar amanha ja nasce limpando.
 */
export function clearAuth() {
  Object.values(AUTH_KEYS).forEach(key => localStorage.removeItem(key));
  clearCache();
}

/**
 * Clear all auth data and redirect to login.
 */
export function logout() {
  clearAuth();
  window.location.hash = '#/login';
}
