import { el } from '@utils/dom.js';

/**
 * Render the 403 page.
 * @param {HTMLElement} container
 */
export async function renderUnauthorized(container) {
  const page = el('div', { className: 'error-page' }, [
    el('div', { className: 'error-page__code', textContent: '403' }),
    el('h1', { className: 'error-page__title', textContent: 'Acesso negado' }),
    el('p', {
      className: 'error-page__message',
      textContent: 'Você não tem permissão para acessar esta página. Apenas administradores podem gerenciar a Mapoteca.',
    }),
    el('a', { className: 'error-page__link', href: '#/dashboard', textContent: 'Voltar ao Dashboard' }),
  ]);

  container.appendChild(page);
}
