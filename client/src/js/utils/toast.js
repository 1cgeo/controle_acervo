let containerEl = null;

/**
 * A PILHA VISIVEL e uma so, no canto. Ela nao e regiao viva: duas caixas
 * `position: fixed` no mesmo canto se sobrepoem, e o aviso mais novo cobriria o
 * anterior.
 */
function getContainer() {
  // `isConnected`, e nao so o nulo: a referencia fica no modulo e SOBREVIVE ao
  // no sair da arvore. Quem tirasse o container do `document.body` deixava esta
  // variavel apontando para um no solto, e todo toast passava a ser anexado
  // FORA da pagina. Nada quebrava, nada aparecia, e nao havia erro para ler.
  if (!containerEl || !containerEl.isConnected) {
    containerEl = document.createElement('div');
    containerEl.className = 'toast-container';
    document.body.appendChild(containerEl);
  }
  return containerEl;
}

/**
 * AS REGIOES VIVAS, invisiveis, uma por urgencia.
 *
 * A urgencia e do LEITOR DE TELA, e se declara na REGIAO, nunca na mensagem que
 * entra nela. Com um `aria-live="polite"` so, o aviso de FALHA esperava a
 * leitura em curso terminar, e o toast de erro some em 6 segundos: a pessoa
 * perdia o unico sinal de que a gravacao nao aconteceu.
 *
 * Elas ficam FORA da pilha visivel, em `sr-only`, e por isso nao disputam
 * espaco com nada. O toast na tela sai do fluxo de acessibilidade
 * (`aria-hidden`), senao a mesma frase seria anunciada duas vezes.
 */
const regioes = { polite: null, assertive: null };

const URGENCIA = { error: 'assertive', warning: 'assertive', success: 'polite', info: 'polite' };

function anunciar(message, type) {
  const urgencia = URGENCIA[type] || 'polite';
  // Mesmo cuidado do container: regiao viva solta da arvore nao anuncia nada.
  if (!regioes[urgencia] || !regioes[urgencia].isConnected) {
    const nova = document.createElement('div');
    nova.className = 'sr-only';
    nova.setAttribute('role', urgencia === 'assertive' ? 'alert' : 'status');
    nova.setAttribute('aria-live', urgencia);
    document.body.appendChild(nova);
    regioes[urgencia] = nova;
  }
  // Esvaziar antes faz a regiao anunciar DE NOVO quando a mensagem se repete
  // (duas falhas iguais em seguida). Sem isso o texto nao muda e nada e lido.
  regioes[urgencia].textContent = '';
  regioes[urgencia].textContent = message;
}

/**
 * Show a toast notification (never use alert()).
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} [type]
 * @param {number} [durationMs]
 */
export function showToast(message, type = 'info', durationMs = 4000) {
  const container = getContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  toast.setAttribute('aria-hidden', 'true');
  container.appendChild(toast);

  anunciar(message, type);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(16px)';
    toast.style.transition = 'opacity 250ms, transform 250ms';
    setTimeout(() => toast.remove(), 250);
  }, durationMs);
}

/** Show a success toast. */
export function showSuccess(message) { showToast(message, 'success'); }

/** Show an error toast (longer duration; server messages shown verbatim). */
export function showError(message) { showToast(message, 'error', 6000); }

/** Show a warning toast. */
export function showWarning(message) { showToast(message, 'warning'); }

/** Show an info toast. */
export function showInfo(message) { showToast(message, 'info'); }
