import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createNumberField,
  createTextField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createMeta, updateMeta } from '@modules/orcamento/services/orcamento-service.js';
import { getAno } from '@modules/orcamento/store/year-store.js';

/**
 * Abre o dialog de criar/editar meta do PIT.
 * O ano vem do contexto global (navbar): no create grava o ano de contexto; no
 * edit mantem o ano do registro.
 * @param {Object} options
 * @param {Object|null} [options.meta] - meta existente para editar (null cria nova)
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export function openMetaDialog({ meta = null, onSaved = null } = {}) {
  const isEdit = Boolean(meta);

  const numeroMetaField = createNumberField({
    label: 'Número da meta',
    required: true,
    min: 1,
    step: 1,
    value: meta?.numero_meta ?? undefined,
  });
  const itemField = createTextField({
    label: 'Item',
    maxLength: 20,
    placeholder: 'Ex.: 1.1',
    value: meta?.item ?? '',
  });
  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: meta?.descricao ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    numeroMetaField.element,
    itemField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? `Editar meta (${meta.ano})` : `Nova meta (${getAno()})`,
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          numeroMetaField.setError(null);

          const numeroMeta = numeroMetaField.getValue();

          if (numeroMeta === null || numeroMeta <= 0) {
            numeroMetaField.setError('Informe o número da meta');
            return;
          }

          const payload = {
            ano: isEdit ? meta.ano : getAno(),
            numero_meta: numeroMeta,
            item: itemField.getValue() || null,
            descricao: descricaoField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateMeta(meta.id, payload);
              showSuccess('Meta atualizada com sucesso');
            } else {
              await createMeta(payload);
              showSuccess('Meta criada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar meta');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
