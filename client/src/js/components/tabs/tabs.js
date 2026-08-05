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
let contadorDeAbas = 0;

export function createTabs({ tabs = [], activeId = null, className = 'tabs', ariaLabel = 'Abas' }) {
  let currentId = activeId || (tabs[0] && tabs[0].id) || null;
  let currentCleanup = null;
  let currentRefresh = null;
  // Sequencia da montagem: uma troca de aba durante o carregamento da anterior
  // invalida o resultado que estiver a caminho.
  let token = 0;

  // Identidade unica desta instancia. A pagina monta abas de nivel 1 e de nivel
  // 2 ao mesmo tempo, e `id` repetido faria o `aria-controls` de uma apontar
  // para o painel da outra.
  const uid = `tabs-${++contadorDeAbas}`;

  const tabBar = el('div', { className, role: 'tablist', 'aria-label': ariaLabel });
  const content = el('div', {
    className: 'tabs__content',
    role: 'tabpanel',
    id: `${uid}-painel`,
    // O painel entra na ordem de tabulacao: o conteudo da aba pode nao ter
    // controle nenhum, e sem isto o teclado pula direto para depois dele, sem
    // caminho para o texto que a aba mostrou.
    tabindex: '0',
  });

  const tabButtons = {};
  const ordemDosIds = tabs.map(t => t.id);

  for (const tab of tabs) {
    const ativo = tab.id === currentId;
    const btn = el('button', {
      className: `${className}__item${ativo ? ` ${className}__item--active` : ''}`,
      type: 'button',
      role: 'tab',
      id: `${uid}-aba-${tab.id}`,
      'aria-selected': String(ativo),
      'aria-controls': `${uid}-painel`,
      // TABULACAO ITINERANTE, que e o padrao de `tablist`: uma parada de Tab
      // para o grupo inteiro, e as SETAS andam entre as abas. Sem isto, uma
      // barra de seis abas cobrava seis Tabs para chegar ao conteudo.
      tabindex: ativo ? '0' : '-1',
      textContent: tab.label,
      onClick: () => { setActive(tab.id); },
      onKeyDown: (e) => aoTeclarNaAba(e, tab.id),
    });
    tabButtons[tab.id] = btn;
    tabBar.appendChild(btn);
  }

  // Lista de abas vazia nao tem cabecalho para apontar, e um id inventado
  // deixaria o painel rotulado por um elemento que nao existe.
  if (currentId && tabButtons[currentId]) {
    content.setAttribute('aria-labelledby', `${uid}-aba-${currentId}`);
  }

  /** Setas andam, Home e End vao aos extremos. A aba que recebe foco e ativada. */
  function aoTeclarNaAba(e, id) {
    const atual = ordemDosIds.indexOf(id);
    if (atual === -1) return;

    let alvo = null;
    if (e.key === 'ArrowRight') alvo = (atual + 1) % ordemDosIds.length;
    else if (e.key === 'ArrowLeft') alvo = (atual - 1 + ordemDosIds.length) % ordemDosIds.length;
    else if (e.key === 'Home') alvo = 0;
    else if (e.key === 'End') alvo = ordemDosIds.length - 1;
    else return;

    e.preventDefault();
    const idAlvo = ordemDosIds[alvo];
    setActive(idAlvo);
    tabButtons[idAlvo].focus();
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
      btn.tabIndex = ativo ? 0 : -1;
    }
    if (tabButtons[id]) content.setAttribute('aria-labelledby', `${uid}-aba-${id}`);

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
