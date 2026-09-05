// Tema unico da plataforma: a preferencia vale na interface inteira.
//
// ATENCAO: esta chave esta escrita em DOIS lugares. O outro e o script inline do
// `<head>` de `client/index.html`, que carimba o `data-theme` antes da folha de
// estilo para nao piscar branco em quem usa o tema escuro. Mudar o nome aqui sem
// mudar la faz o boot carimbar um tema e o modulo trocar para outro, sem erro.
const STORAGE_KEY = 'sca-theme-mode';

/**
 * Avisa que o tema TROCOU, para quem nao se repinta sozinho.
 *
 * O CSS acompanha o `data-theme` de graca. O que NAO acompanha e o que le um
 * token UMA vez, na montagem, e guarda o valor: os graficos (`components/charts/`)
 * leem `--text-secondary`, `--border-light` e `--chart-1..10` com
 * `getComputedStyle` ao desenhar, e o Chart.js pinta com o que recebeu. Sem este
 * aviso, quem trocasse para o tema escuro com um dashboard aberto ficava com o
 * rotulo do eixo em #666 sobre #1e1e1e, ilegivel, ate a proxima recarga.
 *
 * E um evento, e nao uma lista de assinantes aqui dentro: o `utils/theme.js` nao
 * conhece grafico nenhum, e quem precisa se inscreve.
 */
export const EVENTO_TEMA_MUDOU = 'sca:tema-mudou';

/**
 * Initialize theme from localStorage or OS preference.
 */
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const preferred = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(preferred);
}

/**
 * Toggle between light and dark themes.
 * @returns {string} - The new theme
 */
export function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

/**
 * Get the current theme ('light' | 'dark').
 * @returns {string}
 */
export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

function applyTheme(mode) {
  const anterior = document.documentElement.getAttribute('data-theme');

  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem(STORAGE_KEY, mode);

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', mode === 'dark' ? '#121212' : '#1976d2');
  }

  // So quando MUDOU. No boot o `initTheme` aplica o tema que o script inline do
  // `index.html` ja carimbou no `<html>`, entao `anterior === mode` e ninguem e
  // avisado de uma troca que nao houve. Vale tambem para quem chamar `applyTheme`
  // com o tema que ja esta no ar.
  if (anterior !== mode) {
    window.dispatchEvent(new CustomEvent(EVENTO_TEMA_MUDOU, { detail: { tema: mode } }));
  }
}
