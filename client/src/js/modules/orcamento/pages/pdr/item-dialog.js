import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createSelectField,
  createTextField,
  createNumberField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { getAno } from '@modules/orcamento/store/year-store.js';
import {
  createPdrItem,
  updatePdrItem,
  getNaturezaDespesa,
  getMetas,
} from '@modules/orcamento/services/orcamento-service.js';

/**
 * Abre o dialog de criar/editar um item do PDR. O PDR e o conjunto dos itens do
 * ano: nao ha cabecalho de PDR, so o item. No create o ano e o contexto global;
 * no edit, o ano do registro. Um item: { ano, cod_nd, meta_pit_id, item_label,
 * gnd, valor_solicitado, valor_autorizado, observacao }.
 *
 * @param {Object} options
 * @param {Object|null} [options.item] - item existente para editar (null cria novo)
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export async function openPdrItemDialog({ item = null, onSaved = null } = {}) {
  const isEdit = item !== null && item !== undefined && item.id !== undefined;

  // No create o ano e o contexto global; no edit, o ano do registro.
  const anoItem = isEdit ? (item.ano ?? getAno()) : getAno();

  let naturezas = [];
  let metas = [];

  try {
    [naturezas, metas] = await Promise.all([
      getNaturezaDespesa(),
      getMetas(anoItem),
    ]);
  } catch (err) {
    showError(err.message || 'Erro ao carregar dados do item do PDR');
    return;
  }

  const ndOptions = (naturezas || []).map(nd => ({
    value: nd.code,
    label: `${nd.code} - ${nd.nome}`,
  }));

  const metaOptions = (metas || []).map(m => {
    const partes = [];
    if (m.numero_meta !== null && m.numero_meta !== undefined) partes.push(`Meta ${m.numero_meta}`);
    if (m.item) partes.push(`(${m.item})`);
    const prefixo = partes.join(' ');
    const label = m.descricao
      ? (prefixo ? `${prefixo}: ${m.descricao}` : m.descricao)
      : (prefixo || `Meta ${m.id}`);
    return { value: m.id, label };
  });

  // ---- Campos ----
  const codNdField = createSelectField({
    label: 'Natureza de despesa',
    required: true,
    options: ndOptions,
    value: item?.cod_nd ?? undefined,
  });
  const metaField = createSelectField({
    label: 'Meta do PIT',
    options: metaOptions,
    value: item?.meta_pit_id ?? undefined,
  });
  const itemLabelField = createTextField({
    label: 'Rótulo',
    maxLength: 10,
    placeholder: 'Ex.: 1D',
    value: item?.item_label ?? '',
  });
  const gndField = createSelectField({
    label: 'GND',
    options: [
      { value: 3, label: '3' },
      { value: 4, label: '4' },
    ],
    value: item?.gnd ?? undefined,
  });
  const valorSolicitadoField = createNumberField({
    label: 'Valor solicitado',
    min: 0,
    step: 0.01,
    value: item?.valor_solicitado ?? undefined,
  });
  const valorAutorizadoField = createNumberField({
    label: 'Valor autorizado',
    min: 0,
    step: 0.01,
    value: item?.valor_autorizado ?? undefined,
  });
  const observacaoField = createTextareaField({
    label: 'Observação',
    value: item?.observacao ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [
      el('p', {
        className: 'pdr-item-dialog__ano',
        textContent: `Ano do item: ${anoItem}`,
        style: { margin: '0', color: 'var(--text-secondary)' },
      }),
    ]),
    codNdField.element,
    metaField.element,
    itemLabelField.element,
    gndField.element,
    valorSolicitadoField.element,
    valorAutorizadoField.element,
    el('div', { className: 'form-grid__full' }, [observacaoField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? 'Editar item do PDR' : 'Novo item do PDR',
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          codNdField.setError(null);

          const codNd = codNdField.getValue();
          if (codNd === null || codNd === undefined) {
            codNdField.setError('Selecione a natureza de despesa');
            return;
          }

          const body = {
            ano: anoItem,
            cod_nd: codNd,
            meta_pit_id: metaField.getValue(),
            item_label: itemLabelField.getValue() || null,
            gnd: gndField.getValue(),
            valor_solicitado: valorSolicitadoField.getValue(),
            valor_autorizado: valorAutorizadoField.getValue(),
            observacao: observacaoField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updatePdrItem(item.id, body);
              showSuccess('Item do PDR atualizado com sucesso');
            } else {
              await createPdrItem(body);
              showSuccess('Item do PDR criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar item do PDR');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
