import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createStatsCard } from '@components/stats-card.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createLineChart } from '@components/charts/line-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { mostrarErroNoGrafico } from '@components/estado-erro.js';
import { criarAvisoDeErro } from '@modules/mapoteca/pages/aviso-carga.js';
import * as mapotecaService from '@modules/mapoteca/services/mapoteca-service.js';
import { mesLabel } from './utils.js';

// Sem constante de recorte: o bloco "Pedidos parados" mostra a FILA INTEIRA,
// paginada. Ver o comentario da tabela, abaixo.

/**
 * Aba "Pedidos": quantos entraram no ano, em que situacao estao e como se
 * distribuem pelos meses.
 *
 * O ano vem do filtro da PAGINA do dashboard e conta pela DATA DO
 * PEDIDO, ou seja, quando o pedido ENTROU. E um recorte diferente do Resumo
 * Anual e do Mapa, que contam por data de ENTREGA: o pedido de dezembro
 * entregue em janeiro cai em anos diferentes nos dois, e os dois estao certos.
 * Por isso o subtitulo diz qual dos dois esta na tela.
 *
 * SEM cartao "Em Andamento": ele e CONTIDO em "Pendentes", porque o servidor
 * conta como pendente todo pedido que nao fechou, e somar os dois contaria o
 * mesmo pedido duas vezes.
 *
 * A regra e por EXCLUSAO, e nao por lista fixa de situacoes: com lista fixa,
 * "Aguardando producao" e "Remetido" ficam fora de todo cartao e o pedido some
 * da tela. Vale
 * total = concluidos + pendentes, fora o pedido cancelado, que so aparece no
 * grafico de situacoes.
 *
 * @param {HTMLElement} container
 * @param {() => number} getAno - ano do filtro da pagina do dashboard
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderPedidosTab(container, getAno) {
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
  // Ordena por IDADE, e nunca por prazo. Medido na producao: so 2 dos 32
  // pedidos abertos tem prazo preenchido, e nenhum esta vencido hoje. Uma lista
  // de "atrasados" mostraria zero por campo em branco, e nao por bom
  // desempenho. O prazo aparece na linha quando existe, mas nao manda na ordem.
  //
  // A ordem vem do servidor (GET /dashboard/pending_orders), junto com a idade
  // em dias, para a tela mostrar o mesmo numero que ordenou.
  //
  // A FILA INTEIRA, paginada, e nao um top 10. O recorte de 10 linhas escondia
  // 21 dos 31 pedidos abertos, e as 10 que sobravam eram indistinguiveis entre
  // si: medido na producao em 2026-08-07, todas as 10 tinham data_pedido
  // 01/01/2026 (o carimbo da carga retroativa), os mesmos 218 dias e prazo
  // nulo. Tres das seis colunas eram constantes, e a tabela nao dizia qual
  // pedido olhar. Paginar mostra os 31 sem transformar a tela num rolo.
  //
  // As colunas ITENS e ULTIMA MOVIMENTACAO existem por causa disso. A idade
  // sozinha nao separa a fila enquanto a carga dominar; a contagem de itens
  // separa (8 valores distintos nas mesmas 10 linhas), e a data de movimentacao
  // explica a idade, ao mostrar que o pedido de "janeiro" entrou em julho.
  const paradosTable = createDataTable({
    columns: [
      {
        key: 'id',
        label: 'Pedido',
        render: (row) => el('a', { href: `#/mapoteca/pedidos/${row.id}`, textContent: `#${row.id}` }),
      },
      { key: 'cliente_nome', label: 'Cliente', sortable: true },
      { key: 'situacao_nome', label: 'Situação', sortable: true },
      {
        key: 'quantidade_produtos',
        label: 'Itens',
        sortable: true,
        render: (row) => formatNumber(row.quantidade_produtos),
      },
      {
        key: 'data_pedido',
        label: 'Data do pedido',
        sortable: true,
        render: (row) => formatDate(row.data_pedido),
      },
      {
        key: 'dias_aberto',
        label: 'Dias em aberto',
        sortable: true,
        render: (row) => formatNumber(row.dias_aberto),
      },
      {
        key: 'ultima_movimentacao',
        label: 'Última movimentação',
        sortable: true,
        // Todo pedido tem esta data, porque o servidor cai na data de criacao
        // quando o registro nunca foi alterado. O traco fica para o caso que
        // nao deveria existir, e nao para o pedido novo.
        render: (row) => (row.ultima_movimentacao ? formatDate(row.ultima_movimentacao) : '-'),
      },
      {
        key: 'prazo',
        label: 'Prazo',
        sortable: true,
        // "Sem prazo" e a MAIORIA dos pedidos, e a tela diz isso em vez de um
        // traco: o campo em branco explica por que a ordem nao usa prazo.
        render: (row) => {
          if (!row.prazo) return 'Sem prazo';
          return row.atrasado ? `${formatDate(row.prazo)} (vencido)` : formatDate(row.prazo);
        },
      },
    ],
    rows: [],
    paginated: true,
    pageSize: 10,
    loading: true,
    emptyMessage: 'Nenhum pedido em aberto',
  });

  // Qual ano, e contado por qual data. Sem esta linha, o numero de pedidos do
  // ano e o de produtos entregues no ano (Resumo Anual) pareceriam se
  // contradizer, quando na verdade respondem a perguntas diferentes.
  const escopo = el('p', { className: 'dashboard__escopo' });

  const paradosMeta = el('span', { className: 'dashboard-section__meta', textContent: '' });

  // Falha de carga NAO pode virar "Nenhum pedido em aberto": fila vazia e o
  // estado bom, e falha de carga e o oposto dele.
  const avisoParados = criarAvisoDeErro(paradosTable, load);

  container.appendChild(escopo);
  container.appendChild(el('div', { className: 'stats-grid' }, [cardTotal, cardConcluidos, cardPendentes]));
  container.appendChild(statusPie);
  container.appendChild(timelineLine);
  container.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Pedidos parados' }),
      paradosMeta,
    ]),
    // A fila e de HOJE, e nao do ano do filtro: este bloco nao muda quando o
    // ano muda. Dizer isso evita a leitura de que ele contradiz os cartoes.
    el('p', {
      className: 'dashboard__escopo',
      textContent: 'Pedidos abertos de qualquer ano, do mais antigo para o mais novo. '
        + 'A fila inteira, paginada. Clique no cabeçalho para reordenar.',
    }),
    avisoParados.element,
  ]));

  async function load() {
    ano = getAno();
    escopo.textContent = `Pedidos abertos em ${ano}, pela data do pedido, e só de `
      + 'cliente militar. A entrega do ano está no Resumo Anual e no Mapa.';

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
      mostrarErroNoGrafico(statusPie, statusRes.reason, load);
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
      // Grafico vazio le-se como "nao entrou pedido nenhum no ano", que e o
      // oposto de "nao consegui saber". O card mostra o erro e o botao de
      // tentar de novo, sem derrubar o resto da aba.
      timelineLine.update({ data: [], loading: false });
      mostrarErroNoGrafico(timelineLine, timelineRes.reason, load);
    }

    if (paradosRes.status === 'fulfilled') {
      const abertos = paradosRes.value || [];
      paradosTable.update({ rows: abertos, loading: false });
      paradosMeta.textContent = abertos.length
        ? `${formatNumber(abertos.length)} em aberto`
        : '';
      avisoParados.ok();
    } else {
      paradosTable.update({ loading: false });
      paradosMeta.textContent = '';
      avisoParados.falhou(paradosRes.reason?.message || 'Erro ao carregar os pedidos parados');
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
