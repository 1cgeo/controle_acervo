import { el } from '@utils/dom.js';
import { createTabs } from '@components/tabs/tabs.js';
import { createExportBar } from '@components/export-bar/export-bar.js';
import { invalidarDashboard, EXPORTACOES_ACERVO } from '@modules/acervo/services/acervo-service.js';
import { renderPlanoTab } from './plano-tab.js';
import { renderOverviewTab } from './overview-tab.js';
import { renderDistributionTab } from './distribution-tab.js';
import { renderActivityTab } from './activity-tab.js';
import { renderAdvancedTab } from './advanced-tab.js';
import { renderPontoControleTab } from './ponto-controle-tab.js';

/**
 * Intervalo do auto-refresh da aba ativa.
 *
 * CINCO MINUTOS, e eram 60 segundos. O acervo muda em DIAS: na produção entram
 * algumas dezenas de folhas por mês, e o painel recarregava 60 vezes por hora
 * para redesenhar o mesmo número. O custo não era só rede: a aba ativa se
 * remonta, e quem estava lendo uma tabela paginada ou com a busca preenchida
 * perdia o lugar a cada minuto.
 */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * Dashboard do acervo (#/acervo/dashboard): cinco abas e a barra de exportacao.
 *
 * A aba ativa se recarrega sozinha a cada 60 s. O cache do dashboard cai antes,
 * senao o `refresh` devolveria a mesma resposta guardada. So o prefixo
 * 'acervo:dashboard' e invalidado: o cache dos outros modulos fica de pe.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderDashboard(container, _ctx) {
  const abas = createTabs({
    ariaLabel: 'Painéis do acervo',
    tabs: [
      // PRIMEIRA, e de propósito. As outras respondem o que o acervo TEM e o que
      // ENTROU; só esta responde o que ele DEVE, com prazo. Estoque quase não
      // muda, prazo muda todo dia.
      { id: 'plano', label: 'Plano do Ano', render: renderPlanoTab },
      { id: 'overview', label: 'Visão Geral', render: renderOverviewTab },
      { id: 'distribution', label: 'Distribuição', render: renderDistributionTab },
      { id: 'activity', label: 'Atividade', render: renderActivityTab },
      { id: 'advanced', label: 'Análises Avançadas', render: renderAdvancedTab },
      // Ponto de controle e assunto do ACERVO, e por isso e uma aba daqui, e
      // nao um dashboard proprio: quem abre o painel do acervo ve o acervo
      // inteiro, inclusive o apoio de campo que o sustenta.
      { id: 'ponto_controle', label: 'Ponto de Controle', render: renderPontoControleTab },
    ],
  });

  const page = el('div', { className: 'dashboard' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Dashboard do Acervo' }),
      createExportBar({ items: EXPORTACOES_ACERVO }),
    ]),
    abas.element,
  ]);
  container.appendChild(page);

  await abas.ready;

  const intervalo = setInterval(() => {
    invalidarDashboard();
    abas.refreshActive();
  }, REFRESH_MS);

  return () => {
    clearInterval(intervalo);
    abas._cleanup();
  };
}
