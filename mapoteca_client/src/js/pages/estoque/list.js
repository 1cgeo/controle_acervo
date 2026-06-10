import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber, formatDateTime } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import { createNumberField, createSelectField } from '@components/form-fields/form-fields.js';
import { createStatsCard } from '@components/stats-card.js';
import {
  getEstoqueMaterial,
  getEstoquePorLocalizacao,
  createEstoqueMaterial,
  updateEstoqueMaterial,
  deleteEstoqueMaterial,
  transferirEstoque,
  getTiposMaterial,
  getDominioTipoLocalizacao,
} from '@services/mapoteca-service.js';

async function getSelectOptions() {
  const [materiais, localizacoes] = await Promise.all([
    getTiposMaterial(),
    getDominioTipoLocalizacao(),
  ]);
  return {
    materialOptions: materiais.map(m => ({ value: m.id, label: m.nome })),
    localizacaoOptions: localizacoes.map(l => ({ value: l.code, label: l.nome })),
  };
}

/**
 * Estoque de material page (#/estoque).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderEstoqueList(container, _ctx) {
  let disposed = false;

  // -------------------------------------------------------------------------
  // Location cards
  // -------------------------------------------------------------------------
  const cardsGrid = el('div', { className: 'stats-grid' });

  function renderCards(localizacoes) {
    clearChildren(cardsGrid);
    for (const loc of localizacoes) {
      const tipos = Number(loc.tipos_materiais_diferentes);
      cardsGrid.appendChild(createStatsCard({
        title: `${loc.localizacao_nome} · ${formatNumber(tipos)} ${tipos === 1 ? 'tipo de material' : 'tipos de material'}`,
        value: formatNumber(loc.quantidade_total),
        icon: svgIcon(ICONS.storage, 24),
        color: 'primary',
      }));
    }
  }

  // -------------------------------------------------------------------------
  // Table
  // -------------------------------------------------------------------------
  const table = createDataTable({
    columns: [
      { key: 'tipo_material_nome', label: 'Material', sortable: true },
      { key: 'localizacao_nome', label: 'Localização', sortable: true },
      {
        key: 'quantidade',
        label: 'Quantidade',
        sortable: true,
        render: (row) => formatNumber(row.quantidade),
      },
      {
        key: 'data_atualizacao',
        label: 'Atualizado em',
        render: (row) => formatDateTime(row.data_atualizacao || row.data_criacao),
      },
      {
        key: 'usuario_atualizacao_nome',
        label: 'Atualizado por',
        render: (row) => row.usuario_atualizacao_nome || row.usuario_criacao_nome || '-',
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum registro de estoque',
    actions: [
      {
        icon: ICONS.edit,
        title: 'Editar quantidade',
        onClick: (row) => openEditDialog(row),
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
  // Data loading
  // -------------------------------------------------------------------------
  async function load() {
    table.update({ loading: true });
    const [estoqueRes, localizacoesRes] = await Promise.allSettled([
      getEstoqueMaterial(),
      getEstoquePorLocalizacao(),
    ]);
    if (disposed) return;

    if (estoqueRes.status === 'fulfilled') {
      const rows = estoqueRes.value.map(r => ({ ...r, quantidade: Number(r.quantidade) }));
      table.update({ rows, loading: false });
    } else {
      table.update({ rows: [], loading: false });
      showError(estoqueRes.reason?.message || 'Erro ao carregar o estoque');
    }

    if (localizacoesRes.status === 'fulfilled') {
      renderCards(localizacoesRes.value);
    }
  }

  // -------------------------------------------------------------------------
  // Dialogs
  // -------------------------------------------------------------------------
  function openEditDialog(row) {
    const quantidadeField = createNumberField({
      label: 'Quantidade',
      required: true,
      min: 0.01,
      step: 0.01,
      value: Number(row.quantidade),
    });

    let saving = false;
    openModal({
      title: `Editar estoque — ${row.tipo_material_nome} (${row.localizacao_nome})`,
      content: el('div', {}, [quantidadeField.element]),
      width: '420px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (saving) return;
            quantidadeField.setError(null);
            const quantidade = quantidadeField.getValue();
            if (quantidade === null || quantidade <= 0) {
              quantidadeField.setError('Informe uma quantidade maior que zero');
              return;
            }
            saving = true;
            try {
              await updateEstoqueMaterial({
                id: row.id,
                tipo_material_id: row.tipo_material_id,
                localizacao_id: row.localizacao_id,
                quantidade,
              });
              showSuccess('Estoque atualizado com sucesso');
              close();
              await load();
            } catch (err) {
              showError(err.message || 'Erro ao atualizar o estoque');
            } finally {
              saving = false;
            }
          },
        },
      ],
    });
  }

  async function openAddDialog() {
    let options;
    try {
      options = await getSelectOptions();
    } catch (err) {
      showError(err.message || 'Erro ao carregar opções do formulário');
      return;
    }

    const materialField = createSelectField({
      label: 'Tipo de material',
      required: true,
      options: options.materialOptions,
    });
    const localizacaoField = createSelectField({
      label: 'Localização',
      required: true,
      options: options.localizacaoOptions,
    });
    const quantidadeField = createNumberField({
      label: 'Quantidade',
      required: true,
      min: 0.01,
      step: 0.01,
    });

    const content = el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-grid__full' }, [materialField.element]),
      localizacaoField.element,
      quantidadeField.element,
      el('div', {
        className: 'form-grid__full form-field__help',
        textContent: 'Atenção: esta operação define o nível do estoque do material na localização (substitui a quantidade atual).',
      }),
    ]);

    let saving = false;
    openModal({
      title: 'Adicionar estoque',
      content,
      width: '560px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (saving) return;
            materialField.setError(null);
            localizacaoField.setError(null);
            quantidadeField.setError(null);

            const tipoMaterialId = materialField.getValue();
            const localizacaoId = localizacaoField.getValue();
            const quantidade = quantidadeField.getValue();

            let valid = true;
            if (tipoMaterialId === null) {
              materialField.setError('Selecione o tipo de material');
              valid = false;
            }
            if (localizacaoId === null) {
              localizacaoField.setError('Selecione a localização');
              valid = false;
            }
            if (quantidade === null || quantidade <= 0) {
              quantidadeField.setError('Informe uma quantidade maior que zero');
              valid = false;
            }
            if (!valid) return;

            saving = true;
            try {
              await createEstoqueMaterial({
                tipo_material_id: tipoMaterialId,
                localizacao_id: localizacaoId,
                quantidade,
              });
              showSuccess('Estoque registrado com sucesso');
              close();
              await load();
            } catch (err) {
              showError(err.message || 'Erro ao registrar o estoque');
            } finally {
              saving = false;
            }
          },
        },
      ],
    });
  }

  async function openTransferDialog() {
    let options;
    try {
      options = await getSelectOptions();
    } catch (err) {
      showError(err.message || 'Erro ao carregar opções do formulário');
      return;
    }

    const materialField = createSelectField({
      label: 'Tipo de material',
      required: true,
      options: options.materialOptions,
    });
    const origemField = createSelectField({
      label: 'Origem',
      required: true,
      options: options.localizacaoOptions,
    });
    const destinoField = createSelectField({
      label: 'Destino',
      required: true,
      options: options.localizacaoOptions,
    });
    const quantidadeField = createNumberField({
      label: 'Quantidade',
      required: true,
      min: 0.01,
      step: 0.01,
    });

    const content = el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-grid__full' }, [materialField.element]),
      origemField.element,
      destinoField.element,
      el('div', { className: 'form-grid__full' }, [quantidadeField.element]),
    ]);

    let saving = false;
    openModal({
      title: 'Transferir estoque',
      content,
      width: '560px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Transferir',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (saving) return;
            materialField.setError(null);
            origemField.setError(null);
            destinoField.setError(null);
            quantidadeField.setError(null);

            const tipoMaterialId = materialField.getValue();
            const origemId = origemField.getValue();
            const destinoId = destinoField.getValue();
            const quantidade = quantidadeField.getValue();

            let valid = true;
            if (tipoMaterialId === null) {
              materialField.setError('Selecione o tipo de material');
              valid = false;
            }
            if (origemId === null) {
              origemField.setError('Selecione a localização de origem');
              valid = false;
            }
            if (destinoId === null) {
              destinoField.setError('Selecione a localização de destino');
              valid = false;
            }
            if (origemId !== null && destinoId !== null && origemId === destinoId) {
              destinoField.setError('O destino deve ser diferente da origem');
              valid = false;
            }
            if (quantidade === null || quantidade <= 0) {
              quantidadeField.setError('Informe uma quantidade maior que zero');
              valid = false;
            }
            if (!valid) return;

            saving = true;
            try {
              await transferirEstoque({
                tipo_material_id: tipoMaterialId,
                origem_id: origemId,
                destino_id: destinoId,
                quantidade,
              });
              showSuccess('Transferência realizada com sucesso');
              close();
              await load();
            } catch (err) {
              showError(err.message || 'Erro ao transferir o estoque');
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
      title: 'Excluir registro de estoque',
      message: `Tem certeza que deseja excluir o estoque de ${row.tipo_material_nome} em ${row.localizacao_nome}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteEstoqueMaterial([row.id]);
      showSuccess('Registro de estoque excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o registro de estoque');
    }
  }

  // -------------------------------------------------------------------------
  // Page assembly
  // -------------------------------------------------------------------------
  const transferBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => openTransferDialog(),
  }, [svgIcon(ICONS.swapHoriz, 16), 'Transferir']);

  const addBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openAddDialog(),
  }, [svgIcon(ICONS.add, 16), 'Adicionar estoque']);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Estoque de Material' }),
      el('div', { className: 'page__actions' }, [transferBtn, addBtn]),
    ]),
    cardsGrid,
    table.element,
  ]);
  container.appendChild(page);

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
