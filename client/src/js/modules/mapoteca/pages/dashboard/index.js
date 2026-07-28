import { el } from '@utils/dom.js';
import { createTabs } from '@components/tabs/tabs.js';
import { invalidateDashboardCache } from '@modules/mapoteca/services/mapoteca-service.js';
import { renderResumoAnualTab } from './resumo-anual-tab.js';
import { renderPedidosTab } from './pedidos-tab.js';
import { renderAtendimentoTab } from './atendimento-tab.js';
import { renderMateriaisTab } from './materiais-tab.js';

/** Intervalo do auto-refresh da aba ativa. */
const REFRESH_MS = 60 * 1000;

/**
 * Dashboard da mapoteca (#/mapoteca/dashboard): quatro abas.
 *
 * Era uma pagina unica com nove graficos, uma tabela e quatro secoes empilhadas:
 * toda visita buscava OS NOVE endpoints e rolava por metros de tela para chegar
 * no consumo de material. Agora vale o mesmo principio do dashboard do acervo,
 * que o chefe aprovou: uma aba por pergunta, so a aba ativa existe no DOM, e o
 * auto-refresh de 60 s recarrega apenas ela.
 *
 * A ordem das abas nao e cosmetica. O Resumo Anual abre a pagina (chefe,
 * 2026-07-27), porque e o numero que a DGEO presta contas; o movimento do dia a
 * dia vem depois.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderDashboard(container, _ctx) {
  const abas = createTabs({
    ariaLabel: 'Painéis da mapoteca',
    tabs: [
      { id: 'resumo', label: 'Resumo Anual', render: renderResumoAnualTab },
      { id: 'pedidos', label: 'Pedidos', render: renderPedidosTab },
      { id: 'atendimento', label: 'Atendimento', render: renderAtendimentoTab },
      { id: 'materiais', label: 'Materiais', render: renderMateriaisTab },
    ],
  });

  const page = el('div', { className: 'dashboard' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Dashboard da Mapoteca' }),
    ]),
    abas.element,
  ]);
  container.appendChild(page);

  await abas.ready;

  // O cache cai ANTES do refresh, senao a busca devolveria a mesma resposta
  // guardada e o painel ficaria parado no tempo.
  const intervalo = setInterval(() => {
    invalidateDashboardCache();
    abas.refreshActive();
  }, REFRESH_MS);

  return () => {
    clearInterval(intervalo);
    abas._cleanup();
  };
}
