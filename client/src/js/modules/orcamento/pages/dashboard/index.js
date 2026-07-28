import { el } from '@utils/dom.js';
import { monthName } from '@utils/format.js';
import { createTabs } from '@components/tabs/tabs.js';
import { onAnoChange } from '@modules/orcamento/store/year-store.js';
import { criarSecao3Store } from './secao3-store.js';
import { renderExecucaoTab } from './execucao-tab.js';
import { criarNdTab } from './nd-tab.js';

/**
 * Dashboard da execucao orcamentaria (#/orcamento/dashboard): tres abas.
 *
 * Mesmo principio do dashboard do acervo, que o chefe aprovou: uma aba por
 * pergunta, e so a aba ativa no DOM. Antes eram os dez cards, o grafico e as
 * DUAS tabelas largas empilhados numa tela so, onde a segunda tabela vivia
 * abaixo da dobra.
 *
 * A diferenca para os outros dois dashboards e que aqui as tres abas saem da
 * MESMA consulta (a secao 3). Por isso a busca mora num store memoizado por
 * (ano, mes): trocar de aba nao refaz a consulta, e trocar o mes ou o ano
 * invalida uma vez so, para todas.
 *
 * O ano vem do contexto global (seletor da navbar); o mes e desta tela, porque
 * so ela le a secao 3 de forma cumulativa.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderDashboard(container, _ctx) {
  const store = criarSecao3Store();

  const mesSelect = el('select', {
    className: 'chart-card__select',
    'aria-label': 'Selecionar mês',
    onChange: (e) => {
      store.setMes(parseInt(e.target.value, 10));
      abas.refreshActive();
    },
  }, Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return el('option', { value: String(m), textContent: monthName(m) });
  }));
  mesSelect.value = String(store.getMes());

  const abas = createTabs({
    ariaLabel: 'Painéis da execução orçamentária',
    tabs: [
      { id: 'execucao', label: 'Visão Geral', render: (c) => renderExecucaoTab(c, store) },
      { id: 'pdr', label: 'PDR (3.2)', render: (c) => criarNdTab('pdr')(c, store) },
      { id: 'extra', label: 'Extra-PDR (3.7)', render: (c) => criarNdTab('extra')(c, store) },
    ],
  });

  const page = el('div', { className: 'dashboard' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Execução Orçamentária' }),
      el('div', { className: 'dashboard-section__controls' }, [
        el('span', { textContent: 'Mês:' }),
        mesSelect,
      ]),
    ]),
    abas.element,
  ]);
  container.appendChild(page);

  await abas.ready;

  // Trocar o ano de contexto invalida a secao 3 guardada e recarrega a aba que
  // estiver aberta. As outras buscam sozinhas quando forem montadas.
  const offAno = onAnoChange(() => {
    store.invalidar();
    abas.refreshActive();
  });

  return () => {
    offAno();
    abas._cleanup();
  };
}
