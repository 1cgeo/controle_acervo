import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createSelectField, createCheckboxField } from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  criarVolumeTipoProduto,
  atualizarVolumeTipoProduto,
} from '@modules/acervo/services/admin-service.js';

/**
 * Formulario da associacao volume x tipo de produto.
 *
 * `primario` E O QUE DECIDE O DESTINO DO UPLOAD WEB. Quando alguem envia um
 * produto pela interface, o servidor escolhe o volume pelo PRIMARIO do tipo de
 * produto -- quem envia nao aponta volume nenhum. Trocar o primario aqui muda,
 * na hora e sem outro aviso, onde os proximos arquivos daquele tipo vao parar.
 * O banco tem indice unico parcial (um primario por tipo) e o servidor o espelha
 * com 409; o texto de ajuda existe para a marca nao ser uma caixinha muda.
 *
 * @param {Object} options
 * @param {Object|null} [options.assoc] - associacao existente (null cria uma nova)
 * @param {Array<{code:number, nome:string}>} options.tiposProduto
 * @param {Array<{id:number, nome:string, volume:string}>} options.volumes
 * @param {Function} [options.onSaved]
 */
export function openVolumeTipoProdutoDialog({
  assoc = null,
  tiposProduto = [],
  volumes = [],
  onSaved = null,
} = {}) {
  const isEdit = Boolean(assoc);

  const tipoField = createSelectField({
    label: 'Tipo de produto',
    required: true,
    options: tiposProduto.map(t => ({ value: t.code, label: t.nome })),
    value: assoc?.tipo_produto_id,
  });

  // O rotulo traz nome E caminho: dois volumes de nomes parecidos apontando
  // para lugares diferentes e exatamente o caso em que a escolha erra.
  const volumeField = createSelectField({
    label: 'Volume de armazenamento',
    required: true,
    options: volumes.map(v => ({ value: v.id, label: `${v.nome} (${v.volume})` })),
    value: assoc?.volume_armazenamento_id,
  });

  const primarioField = createCheckboxField({
    label: 'Volume primário deste tipo de produto',
    checked: assoc ? Boolean(assoc.primario) : false,
    helpText: 'O primário é para onde o upload pela web grava os arquivos deste '
      + 'tipo. Existe no máximo um por tipo de produto.',
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [tipoField.element]),
    el('div', { className: 'form-grid__full' }, [volumeField.element]),
    el('div', { className: 'form-grid__full' }, [primarioField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? 'Editar associação' : 'Nova associação',
    content,
    width: '600px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          tipoField.setError(null);
          volumeField.setError(null);

          const tipoProdutoId = tipoField.getValue();
          const volumeId = volumeField.getValue();

          let valid = true;
          if (tipoProdutoId === null) {
            tipoField.setError('Escolha o tipo de produto');
            valid = false;
          }
          if (volumeId === null) {
            volumeField.setError('Escolha o volume de armazenamento');
            valid = false;
          }
          if (!valid) return;

          const payload = {
            tipo_produto_id: tipoProdutoId,
            volume_armazenamento_id: volumeId,
            primario: primarioField.getValue(),
          };

          saving = true;
          try {
            if (isEdit) {
              await atualizarVolumeTipoProduto({ id: assoc.id, ...payload });
              showSuccess('Associação atualizada com sucesso');
            } else {
              await criarVolumeTipoProduto(payload);
              showSuccess('Associação criada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            // O 409 do servidor nomeia o tipo que ja tem primario. Vale mais que
            // qualquer frase generica daqui.
            showError(err.message || 'Erro ao salvar a associação');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
