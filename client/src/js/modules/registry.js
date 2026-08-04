// Registro dos modulos da interface unica do SCA.
//
// CONTRATO DE UM MODULO
// ---------------------
// Cada modulo mora em src/js/modules/<id>/ e exporta um manifesto default:
//
//   export default {
//     id: 'orcamento',        // OBRIGATORIO. Casa com dominio.modulo.nome_abrev
//                             // do servidor. E o prefixo da rota (#/orcamento/...)
//                             // e a chave do mapa `perfis` do POST /api/login.
//     home: '/dashboard',     // rota inicial DENTRO do modulo (sem o prefixo)
//     menu: [...],            // itens da sidebar (ver formato em sidebar.js)
//     rotas: [                // paginas do modulo
//       { path: '/dfd', render: renderDfdList, perfil: 'consulta' },
//       { path: '/notas_empenho/:id', render: renderDetails, perfil: 'consulta' },
//       { path: '/configuracao', render: renderConfig, admin: true },
//       // LISTA de perfis, em vez de nivel minimo: a tela vale SO para quem tem
//       // um desses perfis. Na mapoteca o operador tem telas proprias e nao ve as
//       // de leitura, embora seja um nivel acima de consulta (chefe, 2026-07-30).
//       { path: '/atendimento', render: renderFila, perfis: ['operador', 'gerente'] },
//     ],
//   }
//
// O `id` NAO e um rotulo de tela. O nome que aparece para a pessoa vem do
// catalogo do servidor (auth-store.nomeModulo), nunca daqui.
//
// Modulo sem rota nenhuma (`rotas: []`) e um esqueleto: nao aparece no seletor
// nem registra rota, mesmo que a pessoa tenha perfil nele.

import { temAcessoModulo, temPerfil, ehDeAlgumPerfil, isAdmin } from '@store/auth-store.js';

import acervo from './acervo/index.js';
import mapoteca from './mapoteca/index.js';
import orcamento from './orcamento/index.js';

// A ordem desta lista e a ordem do seletor e a ordem de desempate da rota raiz.
export const MODULOS = [acervo, mapoteca, orcamento];

/**
 * Manifesto de um modulo pelo id.
 * @param {string} id
 * @returns {Object|null}
 */
export function getModulo(id) {
  return MODULOS.find(m => m.id === id) || null;
}

/** Modulos ja portados (com ao menos uma rota registrada). */
export function modulosPortados() {
  return MODULOS.filter(m => Array.isArray(m.rotas) && m.rotas.length > 0);
}

/**
 * Modulos que a pessoa logada ve no seletor: portados E com acesso.
 * Administrador global ve todos os portados, mesmo sem linha de perfil.
 * @returns {Array<Object>}
 */
export function modulosAcessiveis() {
  return modulosPortados().filter(m => temAcessoModulo(m.id));
}

/**
 * A rota declarada no manifesto, pelo caminho INTERNO ao modulo ('/dfd').
 * @param {string} moduloId
 * @param {string} path
 * @returns {Object|null}
 */
export function getRota(moduloId, path) {
  const mod = getModulo(moduloId);
  if (!mod) return null;
  const semQuery = String(path || '').split('?')[0];
  return (mod.rotas || []).find(r => r.path === semQuery) || null;
}

/**
 * A pessoa consegue ABRIR esta rota? Responde exatamente o que o guarda de
 * index.js decidiria, lendo o MESMO campo do manifesto (`admin` ou `perfil`).
 *
 * Existe para o menu nunca oferecer uma tela que o guarda vai recusar. Antes
 * cada item de menu repetia a restricao da rota na mao, e o item "Configuração"
 * do orcamento ficou sem o `admin: true` que a rota dele tinha: aparecia para
 * todo mundo e o clique caia no 403. Derivando da rota, esse desencontro deixa
 * de ser possivel.
 *
 * Caminho que nao e rota registrada (link externo, por exemplo) devolve `true`:
 * quem decide continua sendo o guarda.
 *
 * @param {string} moduloId
 * @param {string} path - caminho interno ao modulo ('/configuracao')
 * @returns {boolean}
 */
export function podeAbrirRota(moduloId, path) {
  const rota = getRota(moduloId, path);
  if (!rota) return true;
  if (rota.admin) return isAdmin();
  // `perfis` (LISTA) tem precedencia sobre `perfil` (nivel MINIMO). A lista existe
  // porque na mapoteca o operador tem telas PROPRIAS e nao ve as de leitura, mesmo
  // sendo um nivel acima de consulta (chefe, 2026-07-30). Onde o minimo descreve a
  // realidade (acervo, orcamento), a rota segue declarando `perfil`.
  if (Array.isArray(rota.perfis)) return ehDeAlgumPerfil(rota.perfis, moduloId);
  return temPerfil(rota.perfil || 'consulta', moduloId);
}

/**
 * Id do modulo a partir de uma rota completa ('/orcamento/dfd' -> 'orcamento').
 * @param {string} path
 * @returns {string|null}
 */
export function moduloDaRota(path) {
  const primeiro = String(path || '').split('?')[0].split('/').filter(Boolean)[0];
  if (!primeiro) return null;
  return getModulo(primeiro) ? primeiro : null;
}

/**
 * Rota completa da home de um modulo ('orcamento' -> '/orcamento/dashboard').
 * @param {string|Object} modulo - id ou manifesto
 * @returns {string}
 */
export function rotaInicial(modulo) {
  const mod = typeof modulo === 'string' ? getModulo(modulo) : modulo;
  if (!mod) return '/404';

  const home = mod.home || '/dashboard';
  // A home do modulo pode nao ser da pessoa. O operador da mapoteca nao ve o
  // dashboard (chefe, 2026-07-30), e entrar no modulo o jogava em /unauthorized:
  // o guarda estava certo e a porta estava errada. Sem perfil nenhum a lista sai
  // vazia e a home volta como estava, que e o que os testes de rota esperam.
  if (podeAbrirRota(mod.id, home)) return `/${mod.id}${home}`;

  const primeira = (mod.rotas || [])
    // Rota com parametro nao serve de porta de entrada: '/pedidos/:id' sem id.
    .filter(r => !r.path.includes(':'))
    .find(r => podeAbrirRota(mod.id, r.path));

  return primeira ? `/${mod.id}${primeira.path}` : `/${mod.id}${home}`;
}

/**
 * Primeiro modulo em que a pessoa tem acesso, para onde a raiz '#/' aponta.
 * @returns {Object|null}
 */
export function primeiroModuloAcessivel() {
  return modulosAcessiveis()[0] || null;
}
