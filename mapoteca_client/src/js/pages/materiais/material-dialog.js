import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createTextareaField,
  createNumberField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createTipoMaterial, updateTipoMaterial } from '@services/mapoteca-service.js';

/**
 * Open the create/edit dialog for a tipo de material.
 * @param {Object} options
 * @param {Object|null} [options.material] - existing material to edit (null creates a new one)
 * @param {Function} [options.onSaved] - called after a successful save
 */
export function openMaterialDialog({ material = null, onSaved = null } = {}) {
  const isEdit = Boolean(material);

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    maxLength: 100,
    value: material?.nome || '',
  });
  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: material?.descricao || '',
  });
  const estoqueMinimoField = createNumberField({
    label: 'Estoque mínimo',
    min: 0,
    step: 0.01,
    value: material?.estoque_minimo ?? undefined,
    helpText: 'Limiar do alerta "Abaixo do mínimo" (vazio = sem alerta)',
  });
  const metaAnualField = createNumberField({
    label: 'Meta anual',
    min: 0,
    step: 0.01,
    value: material?.meta_anual ?? undefined,
    helpText: 'Consumo anual previsto',
  });
  const ativoField = createCheckboxField({
    label: 'Ativo',
    checked: material ? Boolean(material.ativo) : true,
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    estoqueMinimoField.element,
    metaAnualField.element,
    el('div', { className: 'form-grid__full' }, [ativoField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? 'Editar tipo de material' : 'Novo tipo de material',
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          nomeField.setError(null);
          estoqueMinimoField.setError(null);
          metaAnualField.setError(null);

          const nome = nomeField.getValue();
          const estoqueMinimo = estoqueMinimoField.getValue();
          const metaAnual = metaAnualField.getValue();

          let valid = true;
          if (!nome) {
            nomeField.setError('Informe o nome do material');
            valid = false;
          }
          if (estoqueMinimo !== null && estoqueMinimo < 0) {
            estoqueMinimoField.setError('O estoque mínimo não pode ser negativo');
            valid = false;
          }
          if (metaAnual !== null && metaAnual < 0) {
            metaAnualField.setError('A meta anual não pode ser negativa');
            valid = false;
          }
          if (!valid) return;

          const payload = {
            nome,
            descricao: descricaoField.getValue() || null,
            estoque_minimo: estoqueMinimo,
            meta_anual: metaAnual,
            ativo: ativoField.getValue(),
          };

          saving = true;
          try {
            if (isEdit) {
              await updateTipoMaterial({ id: material.id, ...payload });
              showSuccess('Tipo de material atualizado com sucesso');
            } else {
              await createTipoMaterial(payload);
              showSuccess('Tipo de material criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar tipo de material');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
