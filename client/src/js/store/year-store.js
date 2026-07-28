// Contexto de ANO, por MODULO.
//
// Nasceu no orcamento, onde substituiu a ideia de "exercicio ativo": o ano
// escolhido e o contexto de todas as telas do modulo. A mapoteca pediu o mesmo
// (2026-07-28), e a fabrica existe para que os dois nao virem duas copias que
// divergem na primeira correcao.
//
// A chave do localStorage e o nome do evento sao NAMESPACED por modulo. Sem
// isso, trocar o ano no orcamento recarregaria uma tela da mapoteca (e vice
// versa) enquanto a sidebar mantem os tres modulos ao alcance de um clique.

/**
 * Cria o contexto de ano de um modulo.
 * @param {string} moduloId - 'orcamento', 'mapoteca', ...
 * @returns {{KEY:string, EVENTO:string, getAno:Function, setAno:Function, initAno:Function, onAnoChange:Function}}
 */
export function criarYearStore(moduloId) {
  const KEY = `@sca-${moduloId}-ano`;
  const EVENTO = `anochange:${moduloId}`;

  /** Ano de contexto atual (default: ano corrente). */
  function getAno() {
    const v = localStorage.getItem(KEY);
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isInteger(n) ? n : new Date().getFullYear();
  }

  /** Define o ano de contexto e notifica as paginas. */
  function setAno(ano) {
    const n = parseInt(ano, 10);
    if (!Number.isInteger(n)) return;
    localStorage.setItem(KEY, String(n));
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: { ano: n } }));
  }

  /** Define o ano default (ex.: ano de referencia da config) se ainda nao houver selecao. */
  function initAno(ano) {
    const n = parseInt(ano, 10);
    if (!localStorage.getItem(KEY) && Number.isInteger(n)) {
      localStorage.setItem(KEY, String(n));
    }
  }

  /**
   * Registra um listener de troca de ano e devolve a funcao de remocao (use no
   * cleanup da pagina). O handler recebe o evento; chame getAno() para o valor.
   */
  function onAnoChange(handler) {
    window.addEventListener(EVENTO, handler);
    return () => window.removeEventListener(EVENTO, handler);
  }

  return { KEY, EVENTO, getAno, setAno, initAno, onAnoChange };
}
