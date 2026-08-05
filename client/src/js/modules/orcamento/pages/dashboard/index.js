import { el } from '@utils/dom.js';
import { monthName } from '@utils/format.js';
import { createTabs } from '@components/tabs/tabs.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { getAnos } from '@modules/orcamento/services/orcamento-service.js';
import { criarSecao3Store } from './secao3-store.js';
import { criarBlocoPendencias } from './pendencias.js';
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
 * MESMA consulta. Por isso a busca mora num store memoizado por (ano, mes):
 * trocar de aba nao refaz a consulta, e trocar o mes ou o ano invalida uma vez
 * so, para todas.
 *
 * O ano e DESTA TELA: comeca sempre no ano atual e nao guarda nada. O mes
 * tambem e desta tela, porque so ela le a execucao por ND de
 * forma cumulativa.
 *
 * As abas se chamavam "PDR (3.2)" e "Extra-PDR (3.7)". A numeracao era do
 * modelo antigo e ficou morta: o RPCMTec numera 4.1, 4.2 e 4.7, e a aba "PDR"
 * mostra a quebra por ND, que e a 4.1, e nao a 4.2. Numero errado engana mais
 * que numero nenhum.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderDashboard(container, _ctx) {
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnos,
    // O painel so LE o que ja aconteceu, mas as telas do orcamento oferecem o
    // ano fora da lista, e abrir um exercicio novo comeca por olhar o painel
    // dele. Sem isto o painel seria a unica tela do modulo sem esse ano.
    permitirOutroAno: true,
    onChange: trocarAno,
  });

  const store = criarSecao3Store({ getAno: filtroAno.getAno });

  const mesSelect = el('select', {
    className: 'chart-card__select',
    'aria-label': 'Selecionar mês',
    onChange: (e) => {
      store.setMes(parseInt(e.target.value, 10));
      abas.refreshActive();
      atualizarPendencias();
    },
  }, Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return el('option', { value: String(m), textContent: monthName(m) });
  }));
  mesSelect.value = String(store.getMes());

  // O recorte do painel aceita registro sem data, que entra em TODOS os meses.
  // Este bloco e o que denuncia isso, e mais cinco defeitos de dado do ano.
  // Vive sob o cabecalho, e nao dentro de uma aba, porque vale para as tres.
  const pendencias = criarBlocoPendencias();

  async function atualizarPendencias() {
    try {
      const payload = await store.carregar();
      pendencias.update(payload && payload.pendencias, filtroAno.getAno());
    } catch {
      // A falha de carga ja tem dono: o estado de erro da aba ativa. Repetir
      // aqui daria duas mensagens para um problema so.
      pendencias.esconder();
    }
  }

  // Trocar o ano da tela invalida a execucao guardada e recarrega a aba que
  // estiver aberta. As outras buscam sozinhas quando forem montadas.
  function trocarAno() {
    // Exercicio fechado abre fechado. O mes nasce com o mes de hoje, entao ir
    // para um ano anterior mostrava o ano encerrado cortado no mes corrente, e
    // o usuario lia um total menor que o real sem nada avisar.
    if (filtroAno.getAno() < new Date().getFullYear()) {
      store.setMes(12);
      mesSelect.value = '12';
    }
    store.invalidar();
    abas.refreshActive();
    atualizarPendencias();
  }

  const abas = createTabs({
    ariaLabel: 'Painéis da execução orçamentária',
    tabs: [
      { id: 'execucao', label: 'Visão Geral', render: (c) => renderExecucaoTab(c, store) },
      { id: 'pdr', label: 'PDR', render: (c) => criarNdTab('pdr')(c, store) },
      { id: 'extra', label: 'Extra-PDR', render: (c) => criarNdTab('extra')(c, store) },
    ],
  });

  const page = el('div', { className: 'dashboard' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Execução Orçamentária' }),
    ]),
    // O ano vem PRIMEIRO na barra de filtros, e o mes ao lado dele: os dois
    // recortam a mesma consulta, e separa-los faria procurar o ano em outro
    // canto da tela.
    el('div', {
      className: 'page__filters',
      style: {
        display: 'flex',
        gap: '16px',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        marginBottom: '16px',
      },
    }, [
      filtroAno.element,
      el('div', { className: 'dashboard-section__controls' }, [
        el('span', { textContent: 'Mês:' }),
        mesSelect,
      ]),
    ]),
    pendencias.element,
    abas.element,
  ]);
  container.appendChild(page);

  await abas.ready;
  atualizarPendencias();

  return () => {
    abas._cleanup();
  };
}
