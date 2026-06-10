import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chip } from '@components/status-chip.js';
import { getPlotters, deletePlotters } from '@services/mapoteca-service.js';
import { openPlotterDialog } from './plotter-dialog.js';

/**
 * Plotters list page (#/plotters).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderPlottersList(container, _ctx) {
  let disposed = false;

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openPlotterDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo plotter']);

  const table = createDataTable({
    columns: [
      {
        key: 'ativo',
        label: 'Status',
        render: (row) => chip(row.ativo ? 'Ativo' : 'Inativo', row.ativo ? 'success' : 'default'),
      },
      {
        key: 'nr_serie',
        label: 'Número de série',
        sortable: true,
        render: (row) => el('a', { href: `#/plotters/${row.id}`, textContent: row.nr_serie }),
      },
      { key: 'modelo', label: 'Modelo', sortable: true },
      {
        key: 'data_aquisicao',
        label: 'Data de aquisição',
        sortable: true,
        render: (row) => formatDate(row.data_aquisicao),
      },
      {
        key: 'vida_util',
        label: 'Vida útil',
        sortable: true,
        render: (row) => (row.vida_util === null || row.vida_util === undefined
          ? '-'
          : `${formatNumber(row.vida_util)} meses`),
      },
      {
        key: 'data_ultima_manutencao',
        label: 'Última manutenção',
        sortable: true,
        render: (row) => formatDate(row.data_ultima_manutencao),
      },
      {
        key: 'quantidade_manutencoes',
        label: 'Manutenções',
        sortable: true,
        render: (row) => formatNumber(row.quantidade_manutencoes),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum plotter cadastrado',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver detalhes',
        onClick: (row) => { location.hash = `/plotters/${row.id}`; },
      },
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openPlotterDialog({ plotter: row, onSaved: load }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      },
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Plotters' }),
      el('div', { className: 'page__actions' }, [newBtn]),
    ]),
    table.element,
  ]);
  container.appendChild(page);

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getPlotters();
      if (disposed) return;
      const rows = dados.map(r => ({
        ...r,
        quantidade_manutencoes: Number(r.quantidade_manutencoes),
      }));
      table.update({ rows, loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar os plotters');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir plotter',
      message: `Tem certeza que deseja excluir o plotter ${row.modelo} (${row.nr_serie})? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePlotters([row.id]);
      showSuccess('Plotter excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o plotter');
    }
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
