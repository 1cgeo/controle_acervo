import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { getRpnps, deleteRpnp } from '@modules/orcamento/services/orcamento-service.js';
import { getAno, onAnoChange } from '@modules/orcamento/store/year-store.js';
import { openRpnpDialog } from './rpnp-dialog.js';

// O RPNP (Restos a Pagar Não Processados) alimenta a tabela 3.3 do RPCMTec.
const COMPRIMENTO_TRUNCAR = 80;

function truncar(texto) {
  if (!texto) return '-';
  return texto.length > COMPRIMENTO_TRUNCAR ? `${texto.slice(0, COMPRIMENTO_TRUNCAR)}…` : texto;
}

/**
 * Lista de RPNP (#/rpnp). Restos a pagar não processados; alimenta a tabela 3.3.
 * Filtra pelo ano de contexto global (navbar).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderRpnpList(container, _ctx) {
  let disposed = false;

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openRpnpDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo RPNP']);

  const table = createDataTable({
    columns: [
      {
        key: 'empenho',
        label: 'Empenho',
        render: (row) => row.empenho_label || row.nota_empenho_numero || '-',
      },
      {
        key: 'finalidade',
        label: 'Finalidade',
        className: 'truncate',
        render: (row) => truncar(row.finalidade),
      },
      {
        key: 'valor_empenhado',
        label: 'Empenhado',
        sortable: true,
        render: (row) => formatCurrency(row.valor_empenhado),
      },
      {
        key: 'valor_a_liquidar',
        label: 'A liquidar',
        sortable: true,
        render: (row) => formatCurrency(row.valor_a_liquidar),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum RPNP cadastrado',
    actions: [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openRpnpDialog({ rpnpId: row.id, onSaved: load }),
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
      el('h1', { className: 'page__title', textContent: 'RPNP' }),
      el('div', { className: 'page__actions' }, [newBtn]),
    ]),
    table.element,
  ]);
  container.appendChild(page);

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getRpnps(getAno());
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar RPNP');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir RPNP',
      message: `Tem certeza que deseja excluir o RPNP ${row.empenho_label || row.nota_empenho_numero || ''}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteRpnp(row.id);
      showSuccess('RPNP excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir RPNP');
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
