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

  // O TEXTO sai do fluxo de acessibilidade, e nao o toast inteiro: a mesma frase
  // ja e anunciada pela regiao viva, e deixa-la aqui tambem seria le-la duas
  // vezes. O botao de fechar FICA anunciavel, senao ele estaria na ordem de
  // tabulacao sem nome nenhum -- um foco que nao diz onde esta.
  const texto = document.createElement('span');
  texto.className = 'toast__texto';
  texto.textContent = message;
  texto.setAttribute('aria-hidden', 'true');

  const fechar = document.createElement('button');
  fechar.type = 'button';
  fechar.className = 'toast__fechar';
  fechar.setAttribute('aria-label', 'Fechar aviso');
  fechar.textContent = '×';
  fechar.addEventListener('click', () => {
    clearTimeout(temporizador);
    toast.remove();
  });

  toast.append(texto, fechar);
  container.appendChild(toast);

  anunciar(message, type);

  /**
   * O PRAZO PAUSA COM O PONTEIRO DENTRO.
   *
   * As mensagens do toast sao as do SERVIDOR, verbatim, e algumas sao longas
   * ("Usuario necessita do perfil gerente no modulo mapoteca", as do Joi com o
   * nome do campo). Seis segundos para ler, entender e decidir, com a atencao
   * ainda no formulario que acabou de recusar: quem desviou o olhar perdia o
   * unico lugar onde o motivo apareceu, e nao tinha como recupera-lo. Nas
   * falhas de gravacao isso e caro, porque a alternativa e tentar de novo as
   * cegas.
   *
   * O que sobra do prazo e guardado, e nao reiniciado: passar o mouse por cima
   * sem parar nao renova o toast indefinidamente.
   */
  let restante = durationMs;
  let comecou = Date.now();
  let temporizador = null;

  function sumir() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(16px)';
    toast.style.transition = 'opacity 250ms, transform 250ms';
    setTimeout(() => toast.remove(), 250);
  }

  function agendar() {
    comecou = Date.now();
    temporizador = setTimeout(sumir, restante);
  }

  function pausar() {
    if (temporizador === null) return;
    clearTimeout(temporizador);
    temporizador = null;
    restante -= Date.now() - comecou;
    if (restante < 0) restante = 0;
  }

  function retomar() {
    if (temporizador !== null || !toast.isConnected) return;
    agendar();
  }

  toast.addEventListener('mouseenter', pausar);
  toast.addEventListener('mouseleave', retomar);
  toast.addEventListener('focusin', pausar);
  toast.addEventListener('focusout', retomar);

  agendar();
}

/** Show a success toast. */
export function showSuccess(message) { showToast(message, 'success'); }

/** Show an error toast (longer duration; server messages shown verbatim). */
export function showError(message) { showToast(message, 'error', 6000); }

/** Show a warning toast. */
export function showWarning(message) { showToast(message, 'warning'); }

/** Show an info toast. */
export function showInfo(message) { showToast(message, 'info'); }
