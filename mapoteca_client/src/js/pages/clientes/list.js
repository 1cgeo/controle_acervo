import { el, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { getClientes, deleteClientes } from '@services/mapoteca-service.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { openClienteDialog } from './dialog-cliente.js';

/**
 * Clientes list page (#/clientes): table with search, edit/delete row actions,
 * multi-selection for bulk delete and the "Novo cliente" dialog.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderClientesList(container, _ctx) {
  let disposed = false;

  async function load() {
    table.update({ loading: true });
    try {
      const clientes = await getClientes();
      if (disposed) return;
      table.update({ rows: clientes, loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar os clientes');
    }
  }

  function abrirDialog(cliente) {
    openClienteDialog({ cliente, onSaved: load });
  }

  async function excluirCliente(cliente) {
    const confirmado = await confirmDialog({
      title: 'Excluir cliente',
      message: `Excluir o cliente "${cliente.nome}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;

    try {
      await deleteClientes([cliente.id]);
      showSuccess('Cliente excluído com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o cliente');
    }
  }

  async function excluirSelecionados() {
    const selecionados = table.getSelected();
    if (!selecionados.length) return;

    const confirmado = await confirmDialog({
      title: 'Excluir clientes',
      message: `Excluir ${selecionados.length} cliente(s) selecionado(s)? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;

    try {
      await deleteClientes(selecionados.map(c => c.id));
      showSuccess(`${selecionados.length} cliente(s) excluído(s) com sucesso`);
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir os clientes');
    }
  }

  const deleteSelectedBtn = el('button', {
    className: 'btn btn--danger hidden',
    type: 'button',
    onClick: excluirSelecionados,
  }, [svgIcon(ICONS.delete, 16), 'Excluir selecionados']);

  const novoBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirDialog(null),
  }, [svgIcon(ICONS.add, 16), 'Novo cliente']);

  const table = createDataTable({
    columns: [
      { key: 'id', label: 'ID', sortable: true },
      { key: 'nome', label: 'Nome', sortable: true },
      { key: 'tipo_cliente_nome', label: 'Tipo', sortable: true },
      { key: 'ponto_contato_principal', label: 'Contato' },
      {
        key: 'total_pedidos',
        label: 'Pedidos',
        sortable: true,
        render: (row) => formatNumber(row.total_pedidos),
      },
      {
        key: 'data_ultimo_pedido',
        label: 'Último pedido',
        sortable: true,
        render: (row) => formatDate(row.data_ultimo_pedido),
      },
      {
        key: 'pedidos_em_andamento',
        label: 'Em andamento',
        sortable: true,
        render: (row) => formatNumber(row.pedidos_em_andamento),
      },
    ],
    rows: [],
    searchable: true,
    selectable: true,
    loading: true,
    emptyMessage: 'Nenhum cliente cadastrado',
    onSelectionChange: (selecionados) => {
      deleteSelectedBtn.classList.toggle('hidden', selecionados.length === 0);
      deleteSelectedBtn.textContent = '';
      deleteSelectedBtn.appendChild(svgIcon(ICONS.delete, 16));
      deleteSelectedBtn.appendChild(
        document.createTextNode(`Excluir selecionados (${selecionados.length})`)
      );
    },
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver detalhes',
        onClick: (row) => { location.hash = `/clientes/${row.id}`; },
      },
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => abrirDialog(row),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => excluirCliente(row),
      },
    ],
  });

  container.appendChild(el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Clientes' }),
      el('div', { className: 'page__actions' }, [deleteSelectedBtn, novoBtn]),
    ]),
    table.element,
  ]));

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
