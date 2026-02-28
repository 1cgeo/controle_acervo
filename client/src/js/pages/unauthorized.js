import { el } from '@utils/dom.js';

export async function renderUnauthorized(container) {
  const page = el('div', { className: 'error-page' }, [
    el('div', { className: 'error-page__code', textContent: '403' }),
    el('h1', { className: 'error-page__title', textContent: 'Acesso Negado' }),
    el('p', { className: 'error-page__message', textContent: 'Voce nao tem permissao para acessar esta pagina. Apenas administradores podem visualizar o dashboard.' }),
    el('a', { className: 'error-page__link', href: '#/dashboard', textContent: 'Voltar ao Dashboard' }),
  ]);

  container.appendChild(page);
}
