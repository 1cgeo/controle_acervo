// Contexto de ANO do modulo ORCAMENTO. Substitui a ideia de "exercicio ativo":
// o ano selecionado e o contexto de todas as telas do modulo, persistido em
// localStorage. A troca dispara o evento 'anochange' para as paginas recarregarem.
// A chave e namespaced por modulo: e estado DE MODULO, nao de plataforma.

const KEY = '@sca-orcamento-ano';

/** Ano de contexto atual (default: ano corrente). */
export function getAno() {
  const v = localStorage.getItem(KEY);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) ? n : new Date().getFullYear();
}

/** Define o ano de contexto e notifica as paginas (evento 'anochange'). */
export function setAno(ano) {
  const n = parseInt(ano, 10);
  if (!Number.isInteger(n)) return;
  localStorage.setItem(KEY, String(n));
  window.dispatchEvent(new CustomEvent('anochange', { detail: { ano: n } }));
}

/** Define o ano default (ex.: ano de referencia da config) se ainda nao houver selecao. */
export function initAno(ano) {
  const n = parseInt(ano, 10);
  if (!localStorage.getItem(KEY) && Number.isInteger(n)) {
    localStorage.setItem(KEY, String(n));
  }
}

/**
 * Registra um listener de troca de ano e devolve a funcao de remocao (use no
 * cleanup da pagina). O handler recebe o evento; chame getAno() para o valor.
 */
export function onAnoChange(handler) {
  window.addEventListener('anochange', handler);
  return () => window.removeEventListener('anochange', handler);
}
