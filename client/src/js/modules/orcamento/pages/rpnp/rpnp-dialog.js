import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createSelectField,
  createTextField,
  createNumberField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getRpnp,
  createRpnp,
  updateRpnp,
  getNotasEmpenho,
} from '@modules/orcamento/services/orcamento-service.js';
import { getAno } from '@modules/orcamento/store/year-store.js';

/**
 * Abre o dialog de criar/editar RPNP (Restos a Pagar Não Processados).
 * Alimenta a tabela 3.3 do RPCMTec. A nota de empenho vinculada e opcional
 * (label = numero da NE); quando a NE nao esta no sistema, usa-se empenho_label
 * como rotulo livre do empenho.
 * @param {Object} options
 * @param {number|null} [options.rpnpId] - id do RPNP existente para editar (null cria novo)
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export async function openRpnpDialog({ rpnpId = null, onSaved = null } = {}) {
  const isEdit = rpnpId !== null && rpnpId !== undefined;

  let notasEmpenho = [];
  let rpnp = null;

  try {
    notasEmpenho = await getNotasEmpenho();
    if (isEdit) rpnp = await getRpnp(rpnpId);
  } catch (err) {
    showError(err.message || 'Erro ao carregar dados do RPNP');
    return;
  }

  const neOptions = (notasEmpenho || []).map(ne => ({
    value: ne.id,
    label: ne.numero ?? `NE ${ne.id}`,
  }));

  // ---- Campos ----
  const notaEmpenhoField = createSelectField({
    label: 'Nota de empenho',
    options: neOptions,
    value: rpnp?.nota_empenho_id ?? undefined,
  });
  const empenhoLabelField = createTextField({
    label: 'Rótulo do empenho',
    maxLength: 255,
    placeholder: 'Ex.: 2023NE000261 (PI K1...)',
    value: rpnp?.empenho_label ?? '',
    helpText: 'Use quando a NE não estiver cadastrada no sistema.',
  });
  const finalidadeField = createTextareaField({
    label: 'Finalidade',
    value: rpnp?.finalidade ?? '',
  });
  const valorEmpenhadoField = createNumberField({
    label: 'Valor empenhado',
    min: 0,
    step: 0.01,
    value: rpnp?.valor_empenhado ?? undefined,
  });
  const valorALiquidarField = createNumberField({
    label: 'Valor a liquidar',
    min: 0,
    step: 0.01,
    value: rpnp?.valor_a_liquidar ?? undefined,
  });

  const content = el('div', { className: 'form-grid' }, [
    notaEmpenhoField.element,
    el('div', { className: 'form-grid__full' }, [empenhoLabelField.element]),
    el('div', { className: 'form-grid__full' }, [finalidadeField.element]),
    valorEmpenhadoField.element,
    valorALiquidarField.element,
  ]);

  let saving = false;

  openModal({
    title: isEdit ? 'Editar RPNP' : 'Novo RPNP',
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          const body = {
            ano: isEdit ? rpnp.ano : getAno(),
            nota_empenho_id: notaEmpenhoField.getValue(),
            empenho_label: empenhoLabelField.getValue() || null,
            finalidade: finalidadeField.getValue() || null,
            valor_empenhado: valorEmpenhadoField.getValue(),
            valor_a_liquidar: valorALiquidarField.getValue(),
          };

          saving = true;
          try {
            if (isEdit) {
              await updateRpnp(rpnpId, body);
              showSuccess('RPNP atualizado com sucesso');
            } else {
              await createRpnp(body);
              showSuccess('RPNP criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar RPNP');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
