import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createStatsCard } from '@components/stats-card.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createLineChart } from '@components/charts/line-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import * as mapotecaService from '@modules/mapoteca/services/mapoteca-service.js';
import { getAno } from '@modules/mapoteca/store/year-store.js';
import { mesLabel } from './utils.js';

// Quantas linhas o bloco "Pedidos parados" mostra. E um RECORTE, e a tela diz
// isso: a fila inteira fica na pagina de pedidos.
const LIMITE_PARADOS = 10;

/**
 * Aba "Pedidos": quantos entraram no ano, em que situacao estao e como se
 * distribuem pelos meses.
 *
 * O ano vem do contexto do modulo (seletor da navbar) e conta pela DATA DO
 * PEDIDO, ou seja, quando o pedido ENTROU. E um recorte diferente do Resumo
 * Anual e do Mapa, que contam por data de ENTREGA: o pedido de dezembro
 * entregue em janeiro cai em anos diferentes nos dois, e os dois estao certos.
 * Por isso o subtitulo diz qual dos dois esta na tela.
 *
 * "Em Andamento" saiu em 2026-07-27. Ele nao era so redundante com "Pendentes":
 * era CONTIDO nele. O servidor conta como pendente todo pedido que nao fechou,
 * ou seja, tudo que nao e concluido nem cancelado, entao somar os cards
 * contava o mesmo pedido duas vezes. A regra por exclusao entrou em
 * 2026-08-04: a lista fixa anterior (pre-cadastramento, documento recebido, em
 * andamento) deixava "Aguardando producao" e "Remetido" fora de todo cartao, e
 * 6 dos 129 pedidos de 2026 nao apareciam em lugar nenhum. Hoje vale
 * total = concluidos + pendentes, fora o pedido cancelado, que so aparece no
 * grafico de situacoes.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderPedidosTab(container) {
  let disposed = false;
  let ano = getAno();

  const cardTotal = createStatsCard({
    title: 'Total de Pedidos', value: '-', icon: svgIcon(ICONS.assignment, 24), color: 'primary', loading: true,
  });
  const cardConcluidos = createStatsCard({
    title: 'Concluídos', value: '-', icon: svgIcon(ICONS.checkCircle, 24), color: 'success', loading: true,
  });
  const cardPendentes = createStatsCard({
    title: 'Pendentes', value: '-', icon: svgIcon(ICONS.warning, 24), color: 'warning', loading: true,
  });

  const statusPie = createPieChart({ title: 'Pedidos por Situação', data: [], loading: true });

  const timelineLine = createLineChart({
    title: 'Pedidos por mês',
    data: [],
    xKey: 'mes_nome',
    series: [
      { dataKey: 'total_pedidos', label: 'Pedidos' },
      { dataKey: 'total_produtos', label: 'Produtos' },
    ],
    loading: true,
  });

  // Bloco "Pedidos parados": a fila aberta, do mais ANTIGO para o mais novo.
  //
  // Ordena por IDADE, e nunca por prazo. Medido na producao: so 33 dos 164
  // pedidos tem prazo preenchido, e nenhum pedido aberto esta vencido hoje.
  // Uma lista de "atrasados" mostraria zero por campo em branco, e nao por bom
  // desempenho. O prazo aparece na linha quando existe, mas nao manda na ordem.
  //
  // A ordem vem do servidor (GET /dashboard/pending_orders), junto com a idade
  // em dias, para a tela mostrar o mesmo numero que ordenou.
  const paradosTable = createDataTable({
    columns: [
      {
        key: 'id',
        label: 'Pedido',
        render: (row) => el('a', { href: `#/mapoteca/pedidos/${row.id}`, textContent: `#${row.id}` }),
      },
      { key: 'cliente_nome', label: 'Cliente' },
      { key: 'situacao_nome', label: 'Situação' },
      { key: 'data_pedido', label: 'Data do pedido', render: (row) => formatDate(row.data_pedido) },
      { key: 'dias_aberto', label: 'Dias em aberto', render: (row) => formatNumber(row.dias_aberto) },
      {
        key: 'prazo',
        label: 'Prazo',
        // "Sem prazo" e a MAIORIA dos pedidos, e a tela diz isso em vez de um
        // traco: o campo em branco explica por que a ordem nao usa prazo.
        render: (row) => {
          if (!row.prazo) return 'Sem prazo';
          return row.atrasado ? `${formatDate(row.prazo)} (vencido)` : formatDate(row.prazo);
        },
      },
    ],
    rows: [],
    // A tela ja corta em LIMITE_PARADOS linhas. Paginar o recorte esconderia
    // metade de uma lista que cabe inteira.
    paginated: false,
    loading: true,
    emptyMessage: 'Nenhum pedido em aberto',
  });

  // Qual ano, e contado por qual data. Sem esta linha, o numero de pedidos do
  // ano e o de produtos entregues no ano (Resumo Anual) pareceriam se
  // contradizer, quando na verdade respondem a perguntas diferentes.
  const escopo = el('p', { className: 'dashboard__escopo' });

  const paradosMeta = el('span', { className: 'dashboard-section__meta', textContent: '' });

  container.appendChild(escopo);
  container.appendChild(el('div', { className: 'stats-grid' }, [cardTotal, cardConcluidos, cardPendentes]));
  container.appendChild(statusPie);
  container.appendChild(timelineLine);
  container.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Pedidos parados' }),
      paradosMeta,
    ]),
    // A fila e de HOJE, e nao do ano do seletor: este bloco nao muda quando o
    // ano muda. Dizer isso evita a leitura de que ele contradiz os cartoes.
    el('p', {
      className: 'dashboard__escopo',
      textContent: `Pedidos abertos de qualquer ano, do mais antigo para o mais novo. `
        + `A tabela mostra até ${LIMITE_PARADOS} linhas.`,
    }),
    paradosTable.element,
  ]));

  async function load() {
    ano = getAno();
    escopo.textContent = `Pedidos abertos em ${ano}, pela data do pedido. `
      + 'A entrega do ano está no Resumo Anual e no Mapa.';

    paradosTable.update({ loading: true });

    // getPendingOrders NAO recebe ano de proposito: a rota devolve a fila de
    // hoje, e nao um recorte anual.
    const [statusRes, timelineRes, paradosRes] = await Promise.allSettled([
      mapotecaService.getOrderStatus(ano),
      mapotecaService.getOrdersTimeline(ano),
      mapotecaService.getPendingOrders(),
    ]);
    if (disposed) return;

    if (statusRes.status === 'fulfilled') {
      const status = statusRes.value;
      cardTotal.update({ value: formatNumber(status.total), loading: false });
      cardConcluidos.update({ value: formatNumber(status.concluidos), loading: false });
      cardPendentes.update({ value: formatNumber(status.pendentes), loading: false });

      statusPie.update({
        data: (status.distribuicao || []).map(d => ({ label: d.nome, value: Number(d.quantidade) })),
        loading: false,
      });
    } else {
      cardTotal.update({ value: 'Erro', loading: false });
      cardConcluidos.update({ value: 'Erro', loading: false });
      cardPendentes.update({ value: 'Erro', loading: false });
      statusPie.update({ data: [], loading: false });
      showError(statusRes.reason?.message || 'Erro ao carregar situação dos pedidos');
    }

    if (timelineRes.status === 'fulfilled') {
      timelineLine.update({
        data: timelineRes.value.map(t => ({
          mes_nome: mesLabel(t.mes),
          total_pedidos: Number(t.total_pedidos),
          total_produtos: Number(t.total_produtos),
        })),
        loading: false,
      });
    } else {
      timelineLine.update({ data: [], loading: false });
    }

    if (paradosRes.status === 'fulfilled') {
      const abertos = paradosRes.value || [];
      const recorte = abertos.slice(0, LIMITE_PARADOS);
      paradosTable.update({ rows: recorte, loading: false });
      paradosMeta.textContent = abertos.length
        ? `${formatNumber(recorte.length)} mais antigos de ${formatNumber(abertos.length)} em aberto`
        : '';
    } else {
      paradosTable.update({ rows: [], loading: false });
      paradosMeta.textContent = '';
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      statusPie._cleanup();
      timelineLine._cleanup();
      paradosTable._cleanup();
    },
    refresh: load,
  };
}
