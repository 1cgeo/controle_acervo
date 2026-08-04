import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { createStatsCard } from '@components/stats-card.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createLineChart } from '@components/charts/line-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import * as mapotecaService from '@modules/mapoteca/services/mapoteca-service.js';
import { mesLabel } from './utils.js';

/**
 * Aba "Atendimento": quanto tempo a mapoteca leva para entregar, e para quem.
 *
 * O tempo medio e o Top 10 de clientes andam juntos porque respondem a mesma
 * pergunta por dois lados: quanto demora, e quem puxa a fila.
 *
 * Tudo aqui e do ano do FILTRO da pagina, contado pela DATA DO PEDIDO, igual a
 * aba Pedidos: o tempo de atendimento pertence ao pedido, e o pedido entrou num
 * ano. Com isso o Top 10 deixou de ser o acumulado historico (uma lista
 * praticamente imovel) e passou a ser quem mais pediu naquele ano.
 *
 * @param {HTMLElement} container
 * @param {() => number} getAno - ano do filtro da pagina do dashboard
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderAtendimentoTab(container, getAno) {
  let disposed = false;
  let ano = getAno();

  const cardTempoMedio = createStatsCard({
    title: 'Tempo Médio de Atendimento',
    value: '-',
    icon: svgIcon(ICONS.localShipping, 24),
    color: 'info',
    loading: true,
    suffix: 'dias',
  });

  const fulfillmentLine = createLineChart({
    title: 'Tempo médio de atendimento por mês (dias)',
    data: [],
    xKey: 'mes_nome',
    series: [{ dataKey: 'media_dias', label: 'Dias', fill: true }],
    loading: true,
  });

  const fulfillmentTipoBar = createBarChart({
    title: 'Tempo médio por tipo de cliente (dias)',
    data: [],
    xKey: 'tipo_cliente',
    series: [{ dataKey: 'media_dias', label: 'Dias' }],
    loading: true,
  });

  const clientesTable = createDataTable({
    columns: [
      {
        key: 'nome',
        label: 'Cliente',
        sortable: true,
        render: (row) => el('a', { href: `#/mapoteca/clientes/${row.id}`, textContent: row.nome || '-' }),
      },
      { key: 'tipo_cliente', label: 'Tipo' },
      { key: 'total_pedidos', label: 'Pedidos', sortable: true, render: (row) => formatNumber(row.total_pedidos) },
      { key: 'pedidos_concluidos', label: 'Concluídos', render: (row) => formatNumber(row.pedidos_concluidos) },
      { key: 'total_produtos', label: 'Produtos', render: (row) => formatNumber(row.total_produtos) },
      // Folhas efetivamente impressas, que e diferente de produtos pedidos: um
      // produto pode ser impresso em varias copias, e em dias distintos.
      { key: 'total_impressoes', label: 'Impressões', sortable: true, render: (row) => formatNumber(row.total_impressoes) },
      { key: 'ultimo_pedido', label: 'Último pedido', sortable: true, render: (row) => formatDate(row.ultimo_pedido) },
    ],
    rows: [],
    // A consulta ja devolve so 10 linhas. Paginar um Top 10 em paginas de 5
    // esconde metade de uma lista que cabe inteira na tela.
    paginated: false,
    loading: true,
    emptyMessage: 'Nenhum cliente com pedidos',
  });

  const clientesTotal = el('span', { className: 'dashboard-section__meta', textContent: '' });

  const escopo = el('p', { className: 'dashboard__escopo' });
  const tituloClientes = el('h2', { className: 'dashboard-section__title' });

  container.appendChild(escopo);
  container.appendChild(el('div', { className: 'stats-grid' }, [cardTempoMedio]));
  container.appendChild(
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [fulfillmentLine, fulfillmentTipoBar])
  );
  container.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [tituloClientes, clientesTotal]),
    clientesTable.element,
  ]));

  async function load() {
    ano = getAno();
    escopo.textContent = `Pedidos abertos em ${ano}, pela data do pedido.`;
    tituloClientes.textContent = `Clientes Mais Ativos em ${ano} (Top 10)`;

    const [avgRes, clientesRes] = await Promise.allSettled([
      mapotecaService.getAvgFulfillmentTime(ano),
      mapotecaService.getClientActivity(10, ano),
    ]);
    if (disposed) return;

    if (avgRes.status === 'fulfilled') {
      const avg = avgRes.value;
      cardTempoMedio.update({
        value: avg.media_geral != null ? formatNumber(avg.media_geral) : '-',
        loading: false,
        suffix: avg.media_geral != null ? 'dias' : '',
      });
      fulfillmentLine.update({
        data: (avg.mensal || []).map(m => ({
          mes_nome: mesLabel(m.mes),
          media_dias: Number(m.media_dias),
        })),
        loading: false,
      });
      fulfillmentTipoBar.update({
        data: (avg.por_tipo_cliente || []).map(t => ({
          tipo_cliente: t.tipo_cliente,
          media_dias: Number(t.media_dias),
        })),
        loading: false,
      });
    } else {
      cardTempoMedio.update({ value: '-', loading: false, suffix: '' });
      fulfillmentLine.update({ data: [], loading: false });
      fulfillmentTipoBar.update({ data: [], loading: false });
    }

    if (clientesRes.status === 'fulfilled') {
      const clientes = clientesRes.value || [];
      clientesTable.update({ rows: clientes, loading: false });
      const totalImpressoes = clientes.reduce((soma, c) => soma + Number(c.total_impressoes || 0), 0);
      clientesTotal.textContent = clientes.length
        ? `${formatNumber(totalImpressoes)} impressões no Top 10`
        : '';
    } else {
      clientesTable.update({ rows: [], loading: false });
      clientesTotal.textContent = '';
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      fulfillmentLine._cleanup();
      fulfillmentTipoBar._cleanup();
      clientesTable._cleanup();
    },
    refresh: load,
  };
}
