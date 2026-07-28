import { el } from '@utils/dom.js';
import { logout } from '@store/auth-store.js';
import { rotaRaiz } from '../router.js';

/**
 * Pagina 403. Cai aqui quem tenta entrar por URL num modulo em que nao tem
 * perfil, ou numa rota de administrador sem ser administrador.
 *
 * Quem nao tem perfil em modulo NENHUM tambem para aqui, e para essa pessoa o
 * "Voltar ao início" apontava para esta mesma tela: o link nao fazia nada, ja
 * que rotaRaiz() devolve '/unauthorized' justamente quando nao ha para onde ir.
 * Nesse caso a saida honesta e sair da sessao.
 * @param {HTMLElement} container
 */
export async function renderUnauthorized(container) {
  const raiz = rotaRaiz();
  const semDestino = raiz === '/unauthorized';

  const saida = semDestino
    ? el('button', {
      className: 'error-page__link',
      type: 'button',
      textContent: 'Sair',
      onClick: () => logout(),
    })
    : el('a', { className: 'error-page__link', href: `#${raiz}`, textContent: 'Voltar ao início' });

  const page = el('div', { className: 'error-page' }, [
    el('div', { className: 'error-page__code', textContent: '403' }),
    el('h1', { className: 'error-page__title', textContent: 'Acesso negado' }),
    el('p', {
      className: 'error-page__message',
      textContent: semDestino
        ? 'Você não tem perfil em nenhum módulo. Peça acesso ao administrador do sistema.'
        : 'Você não tem perfil neste módulo. Peça acesso ao administrador do sistema.',
    }),
    saida,
  ]);

  container.appendChild(page);
}
