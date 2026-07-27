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
//     ],
//     navbarExtras: () => ({ elements: [el], cleanup: () => {} }), // opcional
//   }
//
// O `id` NAO e um rotulo de tela. O nome que aparece para a pessoa vem do
// catalogo do servidor (auth-store.nomeModulo), nunca daqui.
//
// Modulo sem rota nenhuma (`rotas: []`) e um esqueleto: nao aparece no seletor
// nem registra rota, mesmo que a pessoa tenha perfil nele.

import { temAcessoModulo } from '@store/auth-store.js';

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
  return `/${mod.id}${mod.home || '/dashboard'}`;
}

/**
 * Primeiro modulo em que a pessoa tem acesso, para onde a raiz '#/' aponta.
 * @returns {Object|null}
 */
export function primeiroModuloAcessivel() {
  return modulosAcessiveis()[0] || null;
}
