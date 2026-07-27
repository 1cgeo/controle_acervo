import { el, clearChildren } from '@utils/dom.js';
import './tabs.css';

/**
 * Abas com conteudo montado sob demanda: so a aba ativa existe no DOM.
 *
 * Cada aba declara `render(content)`, que pode devolver:
 *  - nada;
 *  - uma funcao de cleanup;
 *  - um objeto { cleanup?, refresh? }. O `refresh` recarrega os dados da aba no
 *    lugar, sem remontar o DOM, e e disparado por `refreshActive()` (usado pelo
 *    auto-refresh do dashboard).
 *
 * @param {Object} options
 * @param {Array<{id:string, label:string, render:Function}>} options.tabs
 * @param {string} [options.activeId] - aba inicial (default: a primeira)
 * @param {string} [options.className] - 'tabs' (nivel 1) ou 'sub-tabs' (nivel 2)
 * @param {string} [options.ariaLabel]
 * @returns {{element:HTMLElement, ready:Promise, setActive:(id:string)=>Promise,
 *            getActive:()=>string, refreshActive:()=>Promise, _cleanup:()=>void}}
 */
export function createTabs({ tabs = [], activeId = null, className = 'tabs', ariaLabel = 'Abas' }) {
  let currentId = activeId || (tabs[0] && tabs[0].id) || null;
  let currentCleanup = null;
  let currentRefresh = null;
  // Sequencia da montagem: uma troca de aba durante o carregamento da anterior
  // invalida o resultado que estiver a caminho.
  let token = 0;

  const tabBar = el('div', { className, role: 'tablist', 'aria-label': ariaLabel });
  const content = el('div', { className: 'tabs__content', role: 'tabpanel' });

  const tabButtons = {};
  for (const tab of tabs) {
    const ativo = tab.id === currentId;
    const btn = el('button', {
      className: `${className}__item${ativo ? ` ${className}__item--active` : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': String(ativo),
      textContent: tab.label,
      onClick: () => { setActive(tab.id); },
    });
    tabButtons[tab.id] = btn;
    tabBar.appendChild(btn);
  }

  const element = el('div', { className: 'tabs-wrapper' }, [tabBar, content]);

  function descartar(resultado) {
    if (typeof resultado === 'function') resultado();
    else if (resultado && typeof resultado.cleanup === 'function') resultado.cleanup();
  }

  /**
   * Troca a aba ativa: limpa a anterior e monta a nova.
   * @param {string} id
   */
  async function setActive(id) {
    const meuToken = ++token;

    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }
    currentRefresh = null;
    currentId = id;

    for (const [tabId, btn] of Object.entries(tabButtons)) {
      const ativo = tabId === id;
      btn.classList.toggle(`${className}__item--active`, ativo);
      btn.setAttribute('aria-selected', String(ativo));
    }

    clearChildren(content);

    const tab = tabs.find(t => t.id === id);
    if (!tab || typeof tab.render !== 'function') return;

    const resultado = await tab.render(content);

    // Outra aba entrou enquanto esta carregava: joga fora o que chegou tarde.
    if (meuToken !== token) {
      descartar(resultado);
      return;
    }

    if (typeof resultado === 'function') {
      currentCleanup = resultado;
    } else if (resultado && typeof resultado === 'object') {
      currentCleanup = typeof resultado.cleanup === 'function' ? resultado.cleanup : null;
      currentRefresh = typeof resultado.refresh === 'function' ? resultado.refresh : null;
    }
  }

  /** Id da aba ativa. */
  function getActive() {
    return currentId;
  }

  /** Recarrega os dados da aba ativa, se ela expuser `refresh`. */
  async function refreshActive() {
    if (currentRefresh) await currentRefresh();
  }

  function _cleanup() {
    token++;
    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }
    currentRefresh = null;
  }

  // A montagem da primeira aba e assincrona. Quem precisa do DOM pronto (teste,
  // pagina que mede altura) espera `ready`.
  const ready = setActive(currentId);

  return { element, ready, setActive, getActive, refreshActive, _cleanup };
}
