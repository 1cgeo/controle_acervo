import { el } from '@utils/dom.js';
import { createTabs } from '@components/tabs/tabs.js';
import { invalidateDashboardCache } from '@modules/mapoteca/services/mapoteca-service.js';
import { onAnoChange } from '@modules/mapoteca/store/year-store.js';
import { renderResumoAnualTab } from './resumo-anual-tab.js';
import { renderMapaTab } from './mapa-tab.js';
import { renderPedidosTab } from './pedidos-tab.js';
import { renderAtendimentoTab } from './atendimento-tab.js';
import { renderMateriaisTab } from './materiais-tab.js';

/** Intervalo do auto-refresh da aba ativa. */
const REFRESH_MS = 60 * 1000;

/**
 * Dashboard da mapoteca (#/mapoteca/dashboard): cinco abas.
 *
 * Era uma pagina unica com nove graficos, uma tabela e quatro secoes empilhadas:
 * toda visita buscava OS NOVE endpoints e rolava por metros de tela para chegar
 * no consumo de material. Agora vale o mesmo principio do dashboard do acervo,
 * que o chefe aprovou: uma aba por pergunta, so a aba ativa existe no DOM, e o
 * auto-refresh de 60 s recarrega apenas ela.
 *
 * A ordem das abas nao e cosmetica. O Resumo Anual abre a pagina (chefe,
 * 2026-07-27), porque e o numero que a DGEO presta contas; o movimento do dia a
 * dia vem depois. O Mapa (2026-07-28) fica logo em seguida: e a leitura
 * espacial do MESMO numero do resumo, e nao um assunto novo.
 *
 * Resumo e Mapa sao por ANO, e o ano vem do contexto do modulo (seletor da
 * navbar). Trocar o ano recarrega a aba aberta; as demais buscam sozinhas
 * quando forem montadas.
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
      { id: 'mapa', label: 'Mapa', render: renderMapaTab },
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

  // Trocar o ano de contexto recarrega a aba aberta. Sem derrubar o cache: as
  // respostas sao guardadas POR ANO, entao voltar ao ano anterior nao paga a
  // busca de novo.
  const offAno = onAnoChange(() => abas.refreshActive());

  return () => {
    clearInterval(intervalo);
    offAno();
    abas._cleanup();
  };
}
