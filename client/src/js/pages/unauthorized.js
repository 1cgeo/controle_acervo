import { el } from '@utils/dom.js';
import { rotaRaiz } from '../router.js';

/**
 * Pagina 403. Cai aqui quem tenta entrar por URL num modulo em que nao tem
 * perfil, ou numa rota de administrador sem ser administrador.
 * @param {HTMLElement} container
 */
export async function renderUnauthorized(container) {
  const page = el('div', { className: 'error-page' }, [
    el('div', { className: 'error-page__code', textContent: '403' }),
    el('h1', { className: 'error-page__title', textContent: 'Acesso negado' }),
    el('p', {
      className: 'error-page__message',
      textContent: 'Você não tem perfil neste módulo. Peça acesso ao administrador do sistema.',
    }),
    el('a', { className: 'error-page__link', href: `#${rotaRaiz()}`, textContent: 'Voltar ao início' }),
  ]);

  container.appendChild(page);
}
