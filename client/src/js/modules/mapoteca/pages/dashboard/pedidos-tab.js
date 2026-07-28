import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createStatsCard } from '@components/stats-card.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createLineChart } from '@components/charts/line-chart.js';
import * as mapotecaService from '@modules/mapoteca/services/mapoteca-service.js';
import { getAno } from '@modules/mapoteca/store/year-store.js';
import { mesLabel } from './utils.js';

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
 * era CONTIDO nele. O servidor conta pendentes como pre-cadastramento +
 * documento recebido + em andamento, entao somar os cards contava o mesmo
 * pedido duas vezes.
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

  // Qual ano, e contado por qual data. Sem esta linha, o numero de pedidos do
  // ano e o de produtos entregues no ano (Resumo Anual) pareceriam se
  // contradizer, quando na verdade respondem a perguntas diferentes.
  const escopo = el('p', { className: 'dashboard__escopo' });

  container.appendChild(escopo);
  container.appendChild(el('div', { className: 'stats-grid' }, [cardTotal, cardConcluidos, cardPendentes]));
  container.appendChild(statusPie);
  container.appendChild(timelineLine);

  async function load() {
    ano = getAno();
    escopo.textContent = `Pedidos abertos em ${ano}, pela data do pedido. `
      + 'A entrega do ano está no Resumo Anual e no Mapa.';

    const [statusRes, timelineRes] = await Promise.allSettled([
      mapotecaService.getOrderStatus(ano),
      mapotecaService.getOrdersTimeline(ano),
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
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      statusPie._cleanup();
      timelineLine._cleanup();
    },
    refresh: load,
  };
}
