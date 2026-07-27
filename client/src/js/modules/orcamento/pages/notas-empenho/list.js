import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getNotasEmpenho,
  deleteNotaEmpenho,
  getNotasCredito,
} from '@modules/orcamento/services/orcamento-service.js';
import { getAno, onAnoChange } from '@modules/orcamento/store/year-store.js';
import { openNotaEmpenhoDialog } from './nota-empenho-dialog.js';

/**
 * Lista de Notas de Empenho (#/notas_empenho). Filtra pelo ano de contexto
 * global (navbar). Filtro no topo: nota de credito. A acao "Ver detalhes" navega
 * para a pagina de detalhes da NE (liquidacoes e recebimentos de material).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderNotasEmpenhoList(container, _ctx) {
  let disposed = false;
  let filtroNotaCredito = null;

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openNotaEmpenhoDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova nota de empenho']);

  // ---- Filtros ----
  const notaCreditoFilter = createSelectField({
    label: 'Nota de crédito',
    options: [],
    placeholder: 'Todas as notas de crédito',
    onChange: (id) => {
      filtroNotaCredito = id;
      load();
    },
  });

  const table = createDataTable({
    columns: [
      { key: 'numero', label: 'Número', sortable: true },
      { key: 'ano', label: 'Ano', sortable: true },
      {
        key: 'nota_credito_numero',
        label: 'NC',
        render: (row) => row.nota_credito_numero || '-',
      },
      {
        key: 'cod_nd',
        label: 'ND',
        render: (row) => (row.nd_nome ? `${row.cod_nd} - ${row.nd_nome}` : (row.cod_nd ?? '-')),
      },
      {
        key: 'valor_empenhado',
        label: 'Empenhado',
        sortable: true,
        render: (row) => formatCurrency(row.valor_empenhado),
      },
      {
        key: 'total_liquidado',
        label: 'Liquidado',
        sortable: true,
        render: (row) => (row.total_liquidado === null || row.total_liquidado === undefined
          ? '-'
          : formatCurrency(row.total_liquidado)),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhuma nota de empenho cadastrada',
    actions: [
      {
        // Abre a pagina de detalhes da NE, onde se lancam liquidacoes e
        // recebimentos. Icone de "assignment" (prancheta) deixa claro que e
        // uma area de lancamento/gestao, nao apenas visualizacao.
        icon: ICONS.assignment,
        title: 'Detalhes e lançamento de liquidações',
        onClick: (row) => { location.hash = `/orcamento/notas_empenho/${row.id}`; },
      },
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openNotaEmpenhoDialog({ neId: row.id, onSaved: load }),
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
      el('h1', { className: 'page__title', textContent: 'Notas de Empenho' }),
      el('div', { className: 'page__actions' }, [newBtn]),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [
      notaCreditoFilter.element,
    ]),
    table.element,
  ]);
  container.appendChild(page);

  async function loadFilterOptions() {
    try {
      const notasCredito = await getNotasCredito({ ano: getAno() });
      if (disposed) return;
      notaCreditoFilter.setOptions((notasCredito || []).map(nc => ({
        value: nc.id,
        label: nc.cod_nd ? `${nc.numero ?? `NC ${nc.id}`} - ${nc.cod_nd}` : (nc.numero ?? `NC ${nc.id}`),
      })));
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar filtros');
    }
  }

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getNotasEmpenho({
        ano: getAno(),
        nota_credito_id: filtroNotaCredito ?? undefined,
      });
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar notas de empenho');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir nota de empenho',
      message: `Tem certeza que deseja excluir a NE ${row.numero}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteNotaEmpenho(row.id);
      showSuccess('Nota de empenho excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir nota de empenho');
    }
  }

  const offAno = onAnoChange(async () => {
    filtroNotaCredito = null;
    notaCreditoFilter.setValue(null);
    await loadFilterOptions();
    await load();
  });

  await loadFilterOptions();
  await load();

  return () => {
    disposed = true;
    offAno();
    table._cleanup();
  };
}
