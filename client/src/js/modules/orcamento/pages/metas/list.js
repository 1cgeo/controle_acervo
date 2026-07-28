import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { getMetas, deleteMeta } from '@modules/orcamento/services/orcamento-service.js';
import { getAno, onAnoChange } from '@modules/orcamento/store/year-store.js';
import { permissoes } from '@store/auth-store.js';
import { openMetaDialog } from './meta-dialog.js';

/**
 * Lista de metas do PIT (#/metas). Filtra pelo ano de contexto global (navbar).
 *
 * Corte padrao do orcamento: criar e editar sao OPERADOR, excluir e GERENTE.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderMetasList(container, _ctx) {
  let disposed = false;
  const pode = permissoes('orcamento');

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openMetaDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova meta']);

  const table = createDataTable({
    columns: [
      { key: 'ano', label: 'Ano', sortable: true },
      { key: 'numero_meta', label: 'Número', sortable: true },
      { key: 'item', label: 'Item', render: (row) => row.item || '-' },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhuma meta cadastrada',
    actions: [
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openMetaDialog({ meta: row, onSaved: load }),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Metas do PIT' }),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    table.element,
  ]);
  container.appendChild(page);

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getMetas(getAno());
      if (disposed) return;
      table.update({ rows: dados, loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar metas');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir meta',
      message: `Tem certeza que deseja excluir a meta ${row.numero_meta} (${row.ano})? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMeta(row.id);
      showSuccess('Meta excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir meta');
    }
  }

  const offAno = onAnoChange(() => load());

  await load();

  return () => {
    disposed = true;
    offAno();
    table._cleanup();
  };
}
