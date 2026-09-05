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
 * Fecha TODA a pilha. E do router, na troca de rota.
 *
 * O overlay mora em `document.body`, e nao em `#app`: nem a limpeza da pagina
 * (`#currentCleanup`) nem o `clearLayout()` o alcancavam. Um modal aberto
 * sobrevivia a navegacao e ficava por cima da tela seguinte, com a armadilha de
 * foco ativa. O pior caminho e a sessao vencendo com o modal aberto: o 401 leva
 * ao `#/login`, o modal continua na frente e o Tab nao sai de dentro dele, entao
 * nao ha como digitar o usuario nem clicar em "Sair". Sobrava o F5.
 *
 * NAO passa pela guarda de descarte (`podeFechar`), de proposito: a navegacao ja
 * aconteceu, e perguntar "descartar?" aqui travaria a fila do router esperando
 * uma resposta sobre uma tela que ja nao esta mais no ar.
 */
export function fecharTodosOsModais() {
  // Copia: `close()` tira o dialogo da pilha durante a iteracao.
  for (const dialog of [...pilha]) {
    if (typeof dialog.__fechar === 'function') dialog.__fechar();
  }
}

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
 * DESCARTE: `podeFechar` e a guarda do trabalho nao salvo.
 *
 * O formulario com alteracao pendente perdia tudo por um Escape, um clique no
 * fundo ou um X. `podeFechar` e uma funcao (pode devolver Promise) chamada
 * ANTES de fechar por esses tres caminhos; devolvendo falso, o modal fica.
 *
 * O `close` que as ACOES recebem NAO passa por ela, de proposito: quem acabou de
 * gravar chama `close()`, e uma pergunta ali cobraria confirmacao do que ja foi
 * salvo. O botao "Cancelar" que quiser a guarda chama `fecharComGuarda`.
 *
 * E OPT-IN: sem `podeFechar`, nada muda.
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {HTMLElement|string} options.content - body content (Element or text)
 * @param {Array<{label:string, variant?:'primary'|'secondary'|'danger'|'text', onClick:(ctx:{close:Function, setOcupado:Function, botao:HTMLElement})=>void}>} [options.actions]
 *        - footer buttons; each onClick receives { close, setOcupado, botao }
 * @param {string} [options.width] - CSS max-width (e.g. '720px')
 * @param {Function} [options.onClose] - called once when the modal closes
 * @param {boolean} [options.closeOnBackdrop] - default true
 * @param {Function} [options.podeFechar] - guarda de DESCARTE; ver abaixo
 * @returns {{close:Function, fecharComGuarda:Function, element:HTMLElement, setOcupado:Function}}
 */
export function openModal({
  title,
  content,
  actions = [],
  width,
  onClose,
  closeOnBackdrop = true,
  podeFechar = null,
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
      fecharComGuarda();
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
      if (e.target === overlay) fecharComGuarda();
    });
  }

  /**
   * Fecha CONSULTANDO a guarda de descarte, quando ela existe.
   *
   * `perguntando` barra a reentrada: com a pergunta na tela, um segundo Escape
   * abriria uma segunda pergunta por cima da primeira.
   */
  let perguntando = false;
  async function fecharComGuarda() {
    if (closed || perguntando) return;
    if (!podeFechar) {
      close();
      return;
    }
    perguntando = true;
    try {
      if (await podeFechar()) close();
    } finally {
      perguntando = false;
    }
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
      fecharComGuarda();
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
  // Porta de saida para o `fecharTodosOsModais`, que so conhece a pilha.
  dialog.__fechar = close;
  pilha.push(dialog);
  document.body.appendChild(overlay);

  // Focus the first focusable element inside the body, else the close button
  const firstFocusable = body.querySelector(FOCUSABLE_SELECTOR);
  (firstFocusable || closeBtn).focus();

  return { close, fecharComGuarda, element: dialog, setOcupado };
}
