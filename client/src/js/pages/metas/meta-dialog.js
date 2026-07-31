import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createNumberField,
  createTextField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createMetaPit, updateMetaPit } from '@services/plataforma-service.js';

/**
 * Criar ou editar uma meta do PIT. Só o administrador global chega aqui: o
 * backend cobra (verifyAdmin) e a lista só oferece o botão a ele.
 *
 * O ANO vem do filtro da tela ao criar, e do próprio registro ao editar. Não há
 * seletor de ano na navbar aqui, porque esta é uma tela de plataforma.
 *
 * @param {Object} options
 * @param {Object|null} [options.meta] - meta existente para editar (null cria nova)
 * @param {number} [options.ano] - ano da meta nova
 * @param {Function} [options.onSaved] - chamado após salvar com sucesso
 */
export function openMetaDialog({ meta = null, ano = null, onSaved = null } = {}) {
  const isEdit = Boolean(meta);
  const anoAlvo = isEdit ? meta.ano : (ano || new Date().getFullYear());

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
    placeholder: 'Ex.: 4.1 (use - quando a meta não se subdivide)',
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
    title: isEdit ? `Editar meta (${anoAlvo})` : `Nova meta (${anoAlvo})`,
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
            ano: anoAlvo,
            numero_meta: numeroMeta,
            item: itemField.getValue() || null,
            descricao: descricaoField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateMetaPit(meta.id, payload);
              showSuccess('Meta atualizada com sucesso');
            } else {
              await createMetaPit(payload);
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
