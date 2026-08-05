import { el } from '@utils/dom.js';
import { createTabs } from '@components/tabs/tabs.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import {
  invalidateDashboardCache,
  getAnosMapoteca,
} from '@modules/mapoteca/services/mapoteca-service.js';
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
 * A ordem das abas nao e cosmetica. O Resumo Anual abre a pagina, porque e o
 * numero de que a DGEO presta contas; o movimento do dia a
 * dia vem depois. O Mapa fica logo em seguida: e a leitura
 * espacial do MESMO numero do resumo, e nao um assunto novo.
 *
 * As cinco abas recortam o mesmo ANO, e ele e DESTA TELA: comeca sempre no ano
 * atual e nao guarda nada. Trocar o ano recarrega a aba
 * aberta; as demais buscam sozinhas quando forem montadas.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderDashboard(container, _ctx) {
  // UM filtro, no nivel da pagina, e nao um por aba: as cinco leem o mesmo ano,
  // e cinco filtros fariam a mesma escolha ser refeita cinco vezes.
  //
  // Sem "+ Outro ano": aqui o ano so FILTRA o que ja aconteceu, e oferecer um
  // ano sem movimento nenhum seria oferecer telas em branco.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnosMapoteca,
    permitirOutroAno: false,
    onChange: () => abas.refreshActive(),
  });

  // O ano chega a aba como FUNCAO, e nao como valor: a aba e montada uma vez e
  // recarregada depois, entao ela precisa ler o ano do momento da carga.
  const getAno = filtroAno.getAno;

  const abas = createTabs({
    ariaLabel: 'Painéis da mapoteca',
    tabs: [
      { id: 'resumo', label: 'Resumo Anual', render: (c) => renderResumoAnualTab(c, getAno) },
      { id: 'mapa', label: 'Mapa', render: (c) => renderMapaTab(c, getAno) },
      { id: 'pedidos', label: 'Pedidos', render: (c) => renderPedidosTab(c, getAno) },
      { id: 'atendimento', label: 'Atendimento', render: (c) => renderAtendimentoTab(c, getAno) },
      { id: 'materiais', label: 'Materiais', render: (c) => renderMateriaisTab(c, getAno) },
    ],
  });

  const page = el('div', { className: 'dashboard' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Dashboard da Mapoteca' }),
    ]),
    // O filtro fica ACIMA das abas, e nao dentro delas: ele vale para as cinco,
    // e trocar de aba nao pode mudar o ano na tela.
    // `.page__filters`: a mesma barra das outras telas, no lugar do layout que
    // vivia em estilo inline aqui dentro.
    el('div', { className: 'page__filters' }, [filtroAno.element]),
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

  // O `onChange` do filtro so recarrega a aba aberta, e nao derruba o cache: as
  // respostas sao guardadas POR ANO, entao voltar ao ano anterior nao paga a
  // busca de novo.

  return () => {
    clearInterval(intervalo);
    abas._cleanup();
  };
}
