import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, formatDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getNotasCredito,
  deleteNotaCredito,
  getClassificacaoNc,
  downloadArquivo,
} from '@modules/orcamento/services/orcamento-service.js';
import { getAno, onAnoChange } from '@modules/orcamento/store/year-store.js';
import { openNotaCreditoDialog } from './nota-credito-dialog.js';

/**
 * Lista de Notas de Credito (#/notas-credito). Filtra pelo ano de contexto
 * global (navbar). Filtro no topo: classificacao (PDR / Extra-PDR).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderNotasCreditoList(container, _ctx) {
  let disposed = false;
  let filtroClassificacao = null;

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openNotaCreditoDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova nota de crédito']);

  // ---- Filtros ----
  const classificacaoFilter = createSelectField({
    label: 'Classificação',
    options: [],
    placeholder: 'Todas as classificações',
    onChange: (id) => {
      filtroClassificacao = id;
      load();
    },
  });

  const table = createDataTable({
    columns: [
      { key: 'numero', label: 'Número', sortable: true },
      { key: 'ano', label: 'Ano', sortable: true },
      {
        key: 'cod_nd',
        label: 'ND',
        render: (row) => (row.nd_nome ? `${row.cod_nd} - ${row.nd_nome}` : (row.cod_nd ?? '-')),
      },
      {
        key: 'classificacao_nome',
        label: 'Classificação',
        render: (row) => row.classificacao_nome || '-',
      },
      {
        key: 'valor_nc',
        label: 'Valor',
        sortable: true,
        render: (row) => formatCurrency(row.valor_nc),
      },
      {
        key: 'data_emissao',
        label: 'Emissão',
        sortable: true,
        render: (row) => formatDate(row.data_emissao),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhuma nota de crédito cadastrada',
    actions: [
      {
        icon: ICONS.download,
        title: 'Baixar anexo (PDF)',
        visible: (row) => row.arquivo_id != null,
        onClick: (row) => downloadArquivo(row.arquivo_id, row.arquivo_nome)
          .catch((err) => showError(err.message || 'Erro ao baixar anexo')),
      },
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openNotaCreditoDialog({ ncId: row.id, onSaved: load }),
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
      el('h1', { className: 'page__title', textContent: 'Notas de Crédito' }),
      el('div', { className: 'page__actions' }, [newBtn]),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [
      classificacaoFilter.element,
    ]),
    table.element,
  ]);
  container.appendChild(page);

  async function loadFilterOptions() {
    try {
      const classificacoes = await getClassificacaoNc();
      if (disposed) return;
      classificacaoFilter.setOptions((classificacoes || []).map(c => ({
        value: c.id,
        label: c.nome ?? c.descricao ?? `Classificação ${c.id}`,
      })));
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar filtros');
    }
  }

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getNotasCredito({
        ano: getAno(),
        classificacao_id: filtroClassificacao ?? undefined,
      });
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar notas de crédito');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir nota de crédito',
      message: `Tem certeza que deseja excluir a NC ${row.numero}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteNotaCredito(row.id);
      showSuccess('Nota de crédito excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir nota de crédito');
    }
  }

  const offAno = onAnoChange(() => load());

  await loadFilterOptions();
  await load();

  return () => {
    disposed = true;
    offAno();
    table._cleanup();
  };
}
