import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatDateTime, formatNumber, formatCurrency, toIsoDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import { createNumberField, createDateField, createTextareaField } from '@components/form-fields/form-fields.js';
import { chip } from '@components/status-chip.js';
import {
  getPlotter,
  createManutencao,
  updateManutencao,
  deleteManutencoes,
} from '@services/mapoteca-service.js';
import { openPlotterDialog } from './plotter-dialog.js';

function summaryCard(label, value) {
  return el('div', { className: 'summary-card' }, [
    el('div', { className: 'summary-card__value', textContent: value }),
    el('div', { className: 'summary-card__label', textContent: label }),
  ]);
}

function backButton() {
  return el('button', {
    className: 'btn btn--text',
    type: 'button',
    'aria-label': 'Voltar para plotters',
    onClick: () => { location.hash = '/plotters'; },
  }, [svgIcon(ICONS.arrowBack, 18), 'Voltar']);
}

/**
 * Open the create/edit dialog for a maintenance record.
 * @param {Object} options
 * @param {number} options.plotterId
 * @param {Object|null} [options.manutencao] - existing record to edit (null creates)
 * @param {Function} [options.onSaved]
 */
function openManutencaoDialog({ plotterId, manutencao = null, onSaved = null }) {
  const isEdit = Boolean(manutencao);

  const dataField = createDateField({
    label: 'Data da manutenção',
    required: true,
    value: manutencao ? (toIsoDate(manutencao.data_manutencao) || '') : (toIsoDate(new Date()) || ''),
  });
  const valorField = createNumberField({
    label: 'Valor (R$)',
    required: true,
    min: 0.01,
    step: 0.01,
    value: manutencao ? Number(manutencao.valor) : undefined,
  });
  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: manutencao?.descricao || '',
  });

  const content = el('div', { className: 'form-grid' }, [
    dataField.element,
    valorField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
  ]);

  let saving = false;
  openModal({
    title: isEdit ? 'Editar manutenção' : 'Adicionar manutenção',
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;
          dataField.setError(null);
          valorField.setError(null);

          const dataManutencao = dataField.getValue();
          const valor = valorField.getValue();

          let valid = true;
          if (!dataManutencao) {
            dataField.setError('Informe a data da manutenção');
            valid = false;
          }
          if (valor === null || valor <= 0) {
            valorField.setError('Informe um valor maior que zero');
            valid = false;
          }
          if (!valid) return;

          const payload = {
            plotter_id: plotterId,
            data_manutencao: dataManutencao,
            valor,
            descricao: descricaoField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateManutencao({ id: manutencao.id, ...payload });
              showSuccess('Manutenção atualizada com sucesso');
            } else {
              await createManutencao(payload);
              showSuccess('Manutenção registrada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar a manutenção');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}

/**
 * Plotter details page (#/plotters/:id).
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderPlotterDetails(container, { params }) {
  const id = Number(params.id);
  let disposed = false;
  let cleanups = [];

  function dispose() {
    for (const fn of cleanups) {
      try { fn(); } catch { /* noop */ }
    }
    cleanups = [];
  }

  async function load() {
    dispose();
    container.innerHTML = '';

    let plotter;
    try {
      plotter = await getPlotter(id);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar o plotter');
      container.appendChild(el('div', { className: 'page' }, [
        el('div', { className: 'page__header' }, [backButton()]),
        el('p', { textContent: err.message || 'Erro ao carregar o plotter' }),
      ]));
      return;
    }
    if (disposed) return;

    const stats = plotter.estatisticas || {};

    // -------------------------------------------------------------------------
    // Header
    // -------------------------------------------------------------------------
    const titleArea = el('div', {}, [
      el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
      }, [
        backButton(),
        el('h1', {
          className: 'page__title',
          textContent: `${plotter.modelo} — ${plotter.nr_serie}`,
        }),
        chip(plotter.ativo ? 'Ativo' : 'Inativo', plotter.ativo ? 'success' : 'default'),
      ]),
      el('div', {
        style: { color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: '4px' },
        textContent: `Aquisição: ${formatDate(plotter.data_aquisicao)} · Vida útil: ${
          plotter.vida_util === null || plotter.vida_util === undefined
            ? '-'
            : `${formatNumber(plotter.vida_util)} meses`
        }`,
      }),
    ]);

    const editBtn = el('button', {
      className: 'btn btn--primary',
      type: 'button',
      onClick: () => openPlotterDialog({ plotter, onSaved: load }),
    }, [svgIcon(ICONS.edit, 16), 'Editar']);

    // -------------------------------------------------------------------------
    // Statistics cards
    // -------------------------------------------------------------------------
    const tempoMedio = stats.tempo_medio_entre_manutencoes_dias;
    const summaryGrid = el('div', { className: 'summary-cards' }, [
      summaryCard('Total de manutenções', formatNumber(stats.total_manutencoes)),
      summaryCard('Última manutenção', formatDate(stats.data_ultima_manutencao)),
      summaryCard('Valor total', formatCurrency(stats.valor_total_manutencoes)),
      summaryCard('Valor médio', formatCurrency(stats.valor_medio_manutencoes)),
      summaryCard(
        'Tempo médio entre manutenções',
        tempoMedio === null || tempoMedio === undefined
          ? '-'
          : `${formatNumber(Math.round(Number(tempoMedio)))} dias`
      ),
    ]);

    // -------------------------------------------------------------------------
    // Maintenance table
    // -------------------------------------------------------------------------
    const manutencoesTable = createDataTable({
      columns: [
        {
          key: 'data_manutencao',
          label: 'Data',
          sortable: true,
          render: (row) => formatDate(row.data_manutencao),
        },
        {
          key: 'valor',
          label: 'Valor',
          sortable: true,
          render: (row) => formatCurrency(row.valor),
        },
        { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
        {
          key: 'usuario_criacao_nome',
          label: 'Registrado por',
          render: (row) => row.usuario_criacao_nome || '-',
        },
        {
          key: 'data_criacao',
          label: 'Registrado em',
          render: (row) => formatDateTime(row.data_criacao),
        },
      ],
      rows: plotter.manutencoes || [],
      pageSize: 10,
      emptyMessage: 'Nenhuma manutenção registrada',
      actions: [
        {
          icon: ICONS.edit,
          title: 'Editar manutenção',
          onClick: (row) => openManutencaoDialog({ plotterId: id, manutencao: row, onSaved: load }),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir manutenção',
          variant: 'danger',
          onClick: (row) => handleDeleteManutencao(row),
        },
      ],
    });
    cleanups.push(() => manutencoesTable._cleanup());

    async function handleDeleteManutencao(row) {
      const ok = await confirmDialog({
        title: 'Excluir manutenção',
        message: `Tem certeza que deseja excluir a manutenção de ${formatDate(row.data_manutencao)} no valor de ${formatCurrency(row.valor)}? Esta ação não pode ser desfeita.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteManutencoes([row.id]);
        showSuccess('Manutenção excluída com sucesso');
        await load();
      } catch (err) {
        showError(err.message || 'Erro ao excluir a manutenção');
      }
    }

    const addManutencaoBtn = el('button', {
      className: 'btn btn--primary btn--sm',
      type: 'button',
      onClick: () => openManutencaoDialog({ plotterId: id, onSaved: load }),
    }, [svgIcon(ICONS.add, 14), 'Adicionar manutenção']);

    // -------------------------------------------------------------------------
    // Page assembly
    // -------------------------------------------------------------------------
    container.appendChild(el('div', { className: 'page' }, [
      el('div', { className: 'page__header' }, [
        titleArea,
        el('div', { className: 'page__actions' }, [editBtn]),
      ]),
      summaryGrid,
      el('div', { className: 'dashboard-section' }, [
        el('div', { className: 'dashboard-section__header' }, [
          el('h2', { className: 'dashboard-section__title', textContent: 'Manutenções' }),
          el('div', { className: 'dashboard-section__controls' }, [addManutencaoBtn]),
        ]),
        manutencoesTable.element,
      ]),
    ]));
  }

  await load();

  return () => {
    disposed = true;
    dispose();
  };
}
