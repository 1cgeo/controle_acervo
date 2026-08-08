import { el } from '@utils/dom.js';
import { temAlgumAcesso } from '@store/auth-store.js';
import { rotaRaiz } from '../router.js';

/**
 * Pagina 403. Cai aqui quem tenta entrar por URL num modulo em que nao tem
 * perfil, ou numa rota de administrador sem ser administrador.
 *
 * QUEM NAO TEM PERFIL EM MODULO NENHUM tambem para aqui ao digitar uma URL de
 * modulo, e para essa pessoa a saida NAO e sair da sessao: e '#/perfil', que e a
 * tela dela enquanto o acesso nao chega. A conta existe, a senha funciona, e o
 * que falta e a concessao -- expulsar da sessao quem acabou de entrar dizia o
 * contrario.
 *
 * O caso "sem destino" desapareceu junto: `rotaRaiz()` devolve '/perfil' no
 * lugar de '/unauthorized', entao o link de volta sempre leva a algum lugar.
 * @param {HTMLElement} container
 */
export async function renderUnauthorized(container) {
  const semAcesso = !temAlgumAcesso();

  const page = el('div', { className: 'error-page' }, [
    el('div', { className: 'error-page__code', textContent: '403' }),
    el('h1', { className: 'error-page__title', textContent: 'Acesso negado' }),
    el('p', {
      className: 'error-page__message',
      // "ADMINISTRADOR": é ele quem concede perfil (`/api/usuarios` é
      // `verifyAdmin`). Mandar pedir a quem não pode dar só adiaria o pedido.
      textContent: semAcesso
        ? 'Você ainda não tem acesso a nenhum módulo do sistema. Peça ao administrador do sistema o acesso ao módulo de interesse.'
        : 'Você não tem perfil neste módulo. Peça ao administrador do sistema o acesso ao módulo de interesse.',
    }),
    el('a', {
      className: 'error-page__link',
      href: `#${rotaRaiz()}`,
      textContent: semAcesso ? 'Ir para o meu perfil' : 'Voltar ao início',
    }),
  ]);

  container.appendChild(page);
}
