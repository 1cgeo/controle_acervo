import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createTextField, createSelectField } from '@components/form-fields/form-fields.js';
import { getDominioTipoCliente, createCliente, updateCliente } from '@services/mapoteca-service.js';
import { showSuccess, showError } from '@utils/toast.js';

/**
 * Create/edit client dialog, shared by the list and details pages.
 * @param {Object} options
 * @param {Object|null} [options.cliente] - existing client for edit mode
 * @param {Function} [options.onSaved] - called after a successful save
 */
export async function openClienteDialog({ cliente = null, onSaved }) {
  let tipos;
  try {
    tipos = await getDominioTipoCliente();
  } catch (err) {
    showError(err.message || 'Erro ao carregar os tipos de cliente');
    return;
  }

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    value: (cliente && cliente.nome) || '',
    maxLength: 255,
  });
  const tipoField = createSelectField({
    label: 'Tipo de cliente',
    required: true,
    options: tipos.map(t => ({ value: t.code, label: t.nome })),
    value: cliente ? cliente.tipo_cliente_id : undefined,
  });
  const contatoField = createTextField({
    label: 'Ponto de contato principal',
    value: (cliente && cliente.ponto_contato_principal) || '',
    maxLength: 255,
  });
  const enderecoField = createTextField({
    label: 'Endereço de entrega principal',
    value: (cliente && cliente.endereco_entrega_principal) || '',
    maxLength: 255,
  });

  nomeField.element.classList.add('form-grid__full');
  enderecoField.element.classList.add('form-grid__full');

  const content = el('div', { className: 'form-grid' }, [
    nomeField.element,
    tipoField.element,
    contatoField.element,
    enderecoField.element,
  ]);

  let submitting = false;

  openModal({
    title: cliente ? `Editar cliente — ${cliente.nome}` : 'Novo cliente',
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: cliente ? 'Salvar' : 'Criar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (submitting) return;

          nomeField.setError(null);
          tipoField.setError(null);

          let ok = true;
          if (!nomeField.getValue()) {
            nomeField.setError('Campo obrigatório');
            ok = false;
          }
          if (tipoField.getValue() === null) {
            tipoField.setError('Campo obrigatório');
            ok = false;
          }
          if (!ok) return;

          const payload = {
            nome: nomeField.getValue(),
            tipo_cliente_id: tipoField.getValue(),
            ponto_contato_principal: contatoField.getValue() || null,
            endereco_entrega_principal: enderecoField.getValue() || null,
          };

          submitting = true;
          try {
            if (cliente) {
              await updateCliente({ id: cliente.id, ...payload });
              showSuccess('Cliente atualizado com sucesso');
            } else {
              await createCliente(payload);
              showSuccess('Cliente criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            submitting = false;
            showError(err.message || 'Erro ao salvar o cliente');
          }
        },
      },
    ],
  });
}
