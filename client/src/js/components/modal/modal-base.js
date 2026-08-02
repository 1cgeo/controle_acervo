import { el, svgIcon, ICONS } from '@utils/dom.js';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modais abertos, do mais antigo para o mais recente.
 *
 * Existe porque MODAL SOBRE MODAL e caso real: a ficha do produto do acervo abre
 * "Nova versão" e "Editar" por cima de si mesma, e o editor de geometria abre por
 * cima do formulário.
 *
 * Sem a pilha, cada modal registrava o proprio `keydown` no `document`, e um
 * unico Escape fechava TODOS de uma vez. Medido em 2026-08-01, com a ficha e o
 * diálogo de versão abertos: dois modais, um Escape, zero modais.
 *
 * O `stopPropagation` que ja estava ali nao resolve: ele barra a propagacao para
 * OUTROS elementos, e nao os demais ouvintes registrados no MESMO elemento (isso
 * seria `stopImmediatePropagation`). E nem ele bastaria, porque em captura os
 * ouvintes do `document` rodam na ordem de registro: quem responderia primeiro
 * seria o modal de BAIXO, ou seja, justamente o errado.
 *
 * Com a pilha, so o do topo reage ao Escape e ao Tab. O Tab importa tanto quanto
 * o Escape: sem isso, a armadilha de foco do modal de baixo puxava o foco para
 * fora do de cima a cada volta.
 */
const pilha = [];

/**
 * Open an accessible modal dialog (role="dialog", ESC closes, focus trap).
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {HTMLElement|string} options.content - body content (Element or text)
 * @param {Array<{label:string, variant?:'primary'|'secondary'|'danger'|'text', onClick:(ctx:{close:Function})=>void}>} [options.actions]
 *        - footer buttons; each onClick receives { close }
 * @param {string} [options.width] - CSS max-width (e.g. '720px')
 * @param {Function} [options.onClose] - called once when the modal closes
 * @param {boolean} [options.closeOnBackdrop] - default true
 * @returns {{close:Function, element:HTMLElement}}
 */
export function openModal({
  title,
  content,
  actions = [],
  width,
  onClose,
  closeOnBackdrop = true,
}) {
  const previouslyFocused = document.activeElement;
  let closed = false;

  const closeBtn = el('button', {
    className: 'modal__close',
    type: 'button',
    'aria-label': 'Fechar',
    onClick: () => close(),
  }, [svgIcon(ICONS.close, 20)]);

  const header = el('div', { className: 'modal__header' }, [
    el('h2', { className: 'modal__title', textContent: title }),
    closeBtn,
  ]);

  const body = el('div', { className: 'modal__body' });
  if (content instanceof Node) {
    body.appendChild(content);
  } else if (content !== undefined && content !== null) {
    body.appendChild(el('p', { className: 'modal__message', textContent: String(content) }));
  }

  let footer = null;
  if (actions.length) {
    footer = el('div', { className: 'modal__footer' }, actions.map(action =>
      el('button', {
        className: `btn btn--${action.variant || 'primary'}`,
        type: 'button',
        textContent: action.label,
        onClick: () => action.onClick({ close }),
      })
    ));
  }

  const dialog = el('div', {
    className: 'modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  }, [header, body, footer]);

  if (width) {
    dialog.style.maxWidth = width;
  }

  const overlay = el('div', { className: 'modal-overlay' }, [dialog]);

  if (closeOnBackdrop) {
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });
  }

  function onKeyDown(e) {
    // So o modal do TOPO responde. Ver o comentario da `pilha`.
    if (pilha[pilha.length - 1] !== dialog) return;

    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      // Focus trap
      const focusables = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter(elm => elm.offsetParent !== null || elm === document.activeElement);
      if (!focusables.length) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    // Sai por identidade, e nao por `pop()`: fechar pelo botao um modal que nao
    // e o do topo e possivel, e o `pop()` tiraria o do topo no lugar dele.
    const posicao = pilha.indexOf(dialog);
    if (posicao !== -1) pilha.splice(posicao, 1);
    overlay.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
    if (onClose) onClose();
  }

  document.addEventListener('keydown', onKeyDown, true);
  pilha.push(dialog);
  document.body.appendChild(overlay);

  // Focus the first focusable element inside the body, else the close button
  const firstFocusable = body.querySelector(FOCUSABLE_SELECTOR);
  (firstFocusable || closeBtn).focus();

  return { close, element: dialog };
}
