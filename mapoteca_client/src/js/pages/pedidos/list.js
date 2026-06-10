import { el, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chipSituacaoPedido } from '@components/status-chip.js';
import { getPedidos, deletePedidos } from '@services/mapoteca-service.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';

/**
 * Pedidos list page (#/pedidos): table with search, status chips, printing
 * progress, link to details, delete with confirmation and "Novo pedido".
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderPedidosList(container, _ctx) {
  let disposed = false;

  async function load() {
    table.update({ loading: true });
    try {
      const pedidos = await getPedidos();
      if (disposed) return;
      table.update({ rows: pedidos, loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar os pedidos');
    }
  }

  async function excluirPedido(pedido) {
    const confirmado = await confirmDialog({
      title: 'Excluir pedido',
      message: `Excluir o pedido #${pedido.id} (${pedido.localizador_pedido}) e todos os seus itens? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;

    try {
      await deletePedidos([pedido.id]);
      showSuccess('Pedido excluído com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o pedido');
    }
  }

  const table = createDataTable({
    columns: [
      { key: 'id', label: 'ID', sortable: true },
      {
        key: 'data_pedido',
        label: 'Data',
        sortable: true,
        render: (row) => formatDate(row.data_pedido),
      },
      { key: 'cliente_nome', label: 'Cliente', sortable: true },
      { key: 'documento_solicitacao', label: 'Documento' },
      {
        key: 'situacao_pedido_nome',
        label: 'Situação',
        render: (row) => chipSituacaoPedido(row.situacao_pedido_id, row.situacao_pedido_nome),
      },
      { key: 'prazo', label: 'Prazo', sortable: true, render: (row) => formatDate(row.prazo) },
      {
        key: 'quantidade_produtos',
        label: 'Qtd. produtos',
        sortable: true,
        render: (row) => formatNumber(row.quantidade_produtos),
      },
      {
        key: 'itens_impressos',
        label: 'Impressão',
        render: (row) => `${row.itens_impressos ?? 0}/${row.quantidade_produtos ?? 0}`,
      },
      { key: 'localizador_pedido', label: 'Localizador' },
    ],
    rows: [],
    searchable: true,
    loading: true,
    emptyMessage: 'Nenhum pedido cadastrado',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver detalhes',
        onClick: (row) => { location.hash = `/pedidos/${row.id}`; },
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => excluirPedido(row),
      },
    ],
  });

  container.appendChild(el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Pedidos' }),
      el('div', { className: 'page__actions' }, [
        el('button', {
          className: 'btn btn--primary',
          type: 'button',
          onClick: () => { location.hash = '/pedidos/novo'; },
        }, [svgIcon(ICONS.add, 16), 'Novo pedido']),
      ]),
    ]),
    table.element,
  ]));

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
