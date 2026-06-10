import { el } from '@utils/dom.js';

export async function renderNotFound(container) {
  const page = el('div', { className: 'error-page' }, [
    el('div', { className: 'error-page__code', textContent: '404' }),
    el('h1', { className: 'error-page__title', textContent: 'Página Não Encontrada' }),
    el('p', { className: 'error-page__message', textContent: 'A página que você está procurando não existe ou foi movida.' }),
    el('a', { className: 'error-page__link', href: '#/dashboard', textContent: 'Voltar ao Dashboard' }),
  ]);

  container.appendChild(page);
}
