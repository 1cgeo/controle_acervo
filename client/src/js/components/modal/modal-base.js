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
 * Sem a pilha, cada modal registra o proprio `keydown` no `document`, e um unico
 * Escape fecha TODOS de uma vez.
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
 * OCUPADO: o modal que esta GRAVANDO nao se fecha.
 *
 * Escape e o clique no fundo fechavam o dialogo com a requisicao em voo, e o
 * erro do servidor chegava a uma tela sem formulario: quem perdeu o que digitou
 * nao tinha onde ler o motivo nem o que corrigir. E o botao clicado nao mudava
 * de aparencia, entao nada na tela dizia que a gravacao comecou.
 *
 * `setOcupado(true)` desabilita o rodape inteiro e o X, marca `aria-busy` no
 * dialogo, poe o botao clicado em `.btn--ocupado` e barra Escape e fundo.
 * `setOcupado(false)` desfaz tudo. E OPT-IN: quem nao chama continua como antes.
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {HTMLElement|string} options.content - body content (Element or text)
 * @param {Array<{label:string, variant?:'primary'|'secondary'|'danger'|'text', onClick:(ctx:{close:Function, setOcupado:Function, botao:HTMLElement})=>void}>} [options.actions]
 *        - footer buttons; each onClick receives { close, setOcupado, botao }
 * @param {string} [options.width] - CSS max-width (e.g. '720px')
 * @param {Function} [options.onClose] - called once when the modal closes
 * @param {boolean} [options.closeOnBackdrop] - default true
 * @returns {{close:Function, element:HTMLElement, setOcupado:Function}}
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
  // Gravacao em voo. Enquanto for verdadeiro, o modal nao se fecha por Escape,
  // por clique no fundo nem pelo X.
  let ocupado = false;
  // O botao do rodape que disparou a acao em curso, e o unico que recebe a marca
  // visual. Os demais so ficam desabilitados.
  let botaoEmAcao = null;

  const closeBtn = el('button', {
    className: 'modal__close',
    type: 'button',
    'aria-label': 'Fechar',
    onClick: () => {
      if (ocupado) return;
      close();
    },
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

  const botoes = [];

  let footer = null;
  if (actions.length) {
    footer = el('div', { className: 'modal__footer' }, actions.map(action => {
      const botao = el('button', {
        className: `btn btn--${action.variant || 'primary'}`,
        type: 'button',
        textContent: action.label,
        onClick: () => {
          // Clique no botao desabilitado nao chega aqui, mas a guarda vale para
          // quem dispare o `click()` por codigo (teste, atalho de teclado).
          if (ocupado) return;
          botaoEmAcao = botao;
          action.onClick({ close, setOcupado, botao });
        },
      });
      botoes.push(botao);
      return botao;
    }));
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
      if (ocupado) return;
      if (e.target === overlay) close();
    });
  }

  /**
   * Liga e desliga o estado de GRAVACAO EM VOO.
   *
   * @param {boolean} valor
   */
  function setOcupado(valor) {
    ocupado = Boolean(valor);

    if (ocupado) dialog.setAttribute('aria-busy', 'true');
    else dialog.removeAttribute('aria-busy');

    closeBtn.disabled = ocupado;
    for (const b of botoes) b.disabled = ocupado;

    // A marca visual fica so no botao clicado: e ele que representa a acao em
    // curso. Os outros ficam desabilitados, que ja diz "agora nao".
    for (const b of botoes) b.classList.remove('btn--ocupado');
    if (ocupado && botaoEmAcao) {
      botaoEmAcao.classList.add('btn--ocupado');
      botaoEmAcao.setAttribute('aria-busy', 'true');
    } else if (botaoEmAcao) {
      botaoEmAcao.removeAttribute('aria-busy');
      botaoEmAcao = null;
    }
  }

  function onKeyDown(e) {
    // So o modal do TOPO responde. Ver o comentario da `pilha`.
    if (pilha[pilha.length - 1] !== dialog) return;

    if (e.key === 'Escape') {
      e.stopPropagation();
      // Gravando: o Escape morre aqui. Fechar agora jogaria fora o formulario
      // com a requisicao em voo, e o erro do servidor nao teria onde chegar.
      if (ocupado) return;
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

  return { close, element: dialog, setOcupado };
}
