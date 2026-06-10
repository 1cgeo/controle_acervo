import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatDateTime, formatNumber, monthName, toIsoDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import { createNumberField, createSelectField, createDateField } from '@components/form-fields/form-fields.js';
import { createLineChart } from '@components/charts/line-chart.js';
import {
  getConsumoMaterial,
  getConsumoMensal,
  createConsumoMaterial,
  updateConsumoMaterial,
  deleteConsumoMaterial,
  getTiposMaterial,
} from '@services/mapoteca-service.js';

/**
 * Consumo de material page (#/consumo).
 * Trigger errors (e.g. "Estoque insuficiente na Seção...") are shown verbatim
 * in the error toast — they guide the operator to transfer stock first.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderConsumoList(container, _ctx) {
  let disposed = false;
  let materialOptions = [];
  let selectedYear = new Date().getFullYear();

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------
  const dataInicioField = createDateField({ label: 'Data de início' });
  const dataFimField = createDateField({ label: 'Data de fim' });
  const materialFilterField = createSelectField({
    label: 'Tipo de material',
    options: [],
    placeholder: 'Todos',
  });

  const filterBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => loadList(),
  }, [svgIcon(ICONS.search, 16), 'Filtrar']);

  const fieldWrap = (field) => {
    const wrap = el('div', { style: { flex: '1 1 180px', minWidth: '180px' } }, [field.element]);
    return wrap;
  };

  const filtersBar = el('div', {
    className: 'detail-card',
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 'var(--space-md)',
      flexWrap: 'wrap',
      marginBottom: 'var(--space-lg)',
    },
  }, [
    fieldWrap(dataInicioField),
    fieldWrap(dataFimField),
    fieldWrap(materialFilterField),
    el('div', { style: { paddingBottom: '2px' } }, [filterBtn]),
  ]);

  // -------------------------------------------------------------------------
  // Table
  // -------------------------------------------------------------------------
  const table = createDataTable({
    columns: [
      { key: 'tipo_material_nome', label: 'Material', sortable: true },
      {
        key: 'quantidade',
        label: 'Quantidade',
        sortable: true,
        render: (row) => formatNumber(row.quantidade),
      },
      {
        key: 'data_consumo',
        label: 'Data do consumo',
        sortable: true,
        render: (row) => formatDate(row.data_consumo),
      },
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
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum registro de consumo',
    actions: [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openConsumoDialog(row),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      },
    ],
  });

  // -------------------------------------------------------------------------
  // Monthly consumption line chart (total per month, with year selector)
  // -------------------------------------------------------------------------
  const consumoChart = createLineChart({
    title: 'Consumo mensal total',
    data: [],
    xKey: 'mes_nome',
    series: [{ dataKey: 'quantidade', label: 'Quantidade consumida' }],
    loading: true,
  });

  const currentYear = new Date().getFullYear();
  const yearSelect = el('select', {
    className: 'chart-card__select',
    'aria-label': 'Selecionar ano',
    onChange: (e) => {
      selectedYear = parseInt(e.target.value, 10);
      loadChart();
    },
  }, Array.from({ length: 6 }, (_, i) => {
    const year = currentYear - i;
    return el('option', { value: String(year), textContent: String(year) });
  }));
  yearSelect.value = String(currentYear);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  function currentFilters() {
    const filtros = {};
    const dataInicio = dataInicioField.getValue();
    const dataFim = dataFimField.getValue();
    const tipoMaterialId = materialFilterField.getValue();
    if (dataInicio) filtros.data_inicio = dataInicio;
    if (dataFim) filtros.data_fim = dataFim;
    if (tipoMaterialId !== null) filtros.tipo_material_id = tipoMaterialId;
    return filtros;
  }

  async function loadList() {
    table.update({ loading: true });
    try {
      const dados = await getConsumoMaterial(currentFilters());
      if (disposed) return;
      const rows = dados.map(r => ({ ...r, quantidade: Number(r.quantidade) }));
      table.update({ rows, loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar os registros de consumo');
    }
  }

  async function loadChart() {
    const ano = selectedYear;
    consumoChart.update({ loading: true });
    try {
      const dados = await getConsumoMensal(ano);
      if (disposed || ano !== selectedYear) return;

      const porMes = new Map();
      for (const r of dados) {
        const mes = Number(r.mes);
        porMes.set(mes, (porMes.get(mes) || 0) + Number(r.quantidade));
      }
      const data = Array.from({ length: 12 }, (_, i) => ({
        mes_nome: monthName(i + 1),
        quantidade: porMes.get(i + 1) || 0,
      }));
      consumoChart.update({
        data: data.some(d => d.quantidade > 0) ? data : [],
        loading: false,
      });
    } catch (err) {
      if (disposed || ano !== selectedYear) return;
      consumoChart.update({ data: [], loading: false });
      showError(err.message || 'Erro ao carregar o consumo mensal');
    }
  }

  async function loadMaterialOptions() {
    try {
      const materiais = await getTiposMaterial();
      if (disposed) return;
      materialOptions = materiais.map(m => ({ value: m.id, label: m.nome }));
      materialFilterField.setOptions(materialOptions);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar os tipos de material');
    }
  }

  // -------------------------------------------------------------------------
  // Create/edit dialog
  // -------------------------------------------------------------------------
  function openConsumoDialog(consumo = null) {
    const isEdit = Boolean(consumo);

    const materialField = createSelectField({
      label: 'Tipo de material',
      required: true,
      options: materialOptions,
      value: consumo ? consumo.tipo_material_id : undefined,
    });
    const quantidadeField = createNumberField({
      label: 'Quantidade',
      required: true,
      min: 0.01,
      step: 0.01,
      value: consumo ? Number(consumo.quantidade) : undefined,
    });
    const dataConsumoField = createDateField({
      label: 'Data do consumo',
      required: true,
      value: consumo ? (toIsoDate(consumo.data_consumo) || '') : (toIsoDate(new Date()) || ''),
    });

    const content = el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-grid__full' }, [materialField.element]),
      quantidadeField.element,
      dataConsumoField.element,
      el('div', {
        className: 'form-grid__full form-field__help',
        textContent: 'O consumo é sempre debitado do estoque da Seção. Transfira o material para a Seção antes de registrar o consumo.',
      }),
    ]);

    let saving = false;
    openModal({
      title: isEdit ? 'Editar consumo' : 'Registrar consumo',
      content,
      width: '560px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: isEdit ? 'Salvar' : 'Registrar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (saving) return;
            materialField.setError(null);
            quantidadeField.setError(null);
            dataConsumoField.setError(null);

            const tipoMaterialId = materialField.getValue();
            const quantidade = quantidadeField.getValue();
            const dataConsumo = dataConsumoField.getValue();

            let valid = true;
            if (tipoMaterialId === null) {
              materialField.setError('Selecione o tipo de material');
              valid = false;
            }
            if (quantidade === null || quantidade <= 0) {
              quantidadeField.setError('Informe uma quantidade maior que zero');
              valid = false;
            }
            if (!dataConsumo) {
              dataConsumoField.setError('Informe a data do consumo');
              valid = false;
            }
            if (!valid) return;

            const payload = {
              tipo_material_id: tipoMaterialId,
              quantidade,
              data_consumo: dataConsumo,
            };

            saving = true;
            try {
              if (isEdit) {
                await updateConsumoMaterial({ id: consumo.id, ...payload });
                showSuccess('Consumo atualizado com sucesso');
              } else {
                await createConsumoMaterial(payload);
                showSuccess('Consumo registrado com sucesso');
              }
              close();
              await Promise.all([loadList(), loadChart()]);
            } catch (err) {
              // Trigger messages (e.g. insufficient stock in Seção) shown verbatim
              showError(err.message || 'Erro ao salvar o consumo');
            } finally {
              saving = false;
            }
          },
        },
      ],
    });
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir registro de consumo',
      message: `Tem certeza que deseja excluir o consumo de ${formatNumber(row.quantidade)} de ${row.tipo_material_nome} em ${formatDate(row.data_consumo)}? A quantidade será devolvida ao estoque da Seção.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteConsumoMaterial([row.id]);
      showSuccess('Registro de consumo excluído com sucesso');
      await Promise.all([loadList(), loadChart()]);
    } catch (err) {
      showError(err.message || 'Erro ao excluir o registro de consumo');
    }
  }

  // -------------------------------------------------------------------------
  // Page assembly
  // -------------------------------------------------------------------------
  const registerBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openConsumoDialog(),
  }, [svgIcon(ICONS.add, 16), 'Registrar consumo']);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Consumo de Material' }),
      el('div', { className: 'page__actions' }, [registerBtn]),
    ]),
    filtersBar,
    table.element,
    el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Tendência anual' }),
        el('div', { className: 'dashboard-section__controls' }, [
          el('span', { textContent: 'Ano:' }),
          yearSelect,
        ]),
      ]),
      consumoChart,
    ]),
  ]);
  container.appendChild(page);

  await Promise.all([loadMaterialOptions(), loadList(), loadChart()]);

  return () => {
    disposed = true;
    table._cleanup();
    consumoChart._cleanup();
  };
}
