import { el } from '@utils/dom.js';
import { showSuccess } from '@utils/toast.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createDateField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import {
  createAfastamento,
  updateAfastamento,
} from '@modules/equipamento/services/equipamento-service.js';
import { periodoValido, gravarNoModal } from '@modules/equipamento/dialogo-comum.js';

/**
 * Lançamento de AFASTAMENTO (do operador).
 *
 * Afastado é o bem que está FORA da Divisão trabalhando em outra OM, e não o
 * bem quebrado: a situação derivada `Afastado` tem precedência 20, abaixo de
 * manutenção e de indisponibilidade, porque um bem afastado que quebra está
 * quebrado primeiro.
 *
 * A OM É OBRIGATÓRIA, e é o que distingue este lançamento dos outros três: sem
 * dizer para ONDE o bem foi, o registro não responde à pergunta que motivou
 * criá-lo. Os dois afastamentos reais são GPS veiculares no `3º BPE`.
 *
 * `previsao_termino` é promessa e `data_fim` é fato. As duas convivem porque a
 * primeira é o que se cobra e a segunda é o que aconteceu.
 *
 * @param {Object} opcoes
 * @param {number} opcoes.equipamentoId
 * @param {Object|null} [opcoes.registro]
 * @param {Function} [opcoes.onSaved]
 */
export function abrirAfastamentoDialog({ equipamentoId, registro = null, onSaved } = {}) {
  const edicao = Boolean(registro);

  const omField = createTextField({
    label: 'OM de destino',
    required: true,
    maxLength: 255,
    placeholder: 'Ex.: 3º BPE',
    value: registro?.om ?? '',
  });
  const inicioField = createDateField({
    label: 'Início',
    required: true,
    value: registro?.data_inicio ?? '',
  });
  const previsaoField = createDateField({
    label: 'Previsão de término',
    value: registro?.previsao_termino ?? '',
  });
  const fimField = createDateField({
    label: 'Retorno (fim)',
    value: registro?.data_fim ?? '',
    helpText: 'Em branco: o bem continua afastado.',
  });
  const motivoField = createTextareaField({
    label: 'Motivo',
    required: true,
    rows: 3,
    value: registro?.motivo ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [omField.element]),
    inicioField.element,
    previsaoField.element,
    fimField.element,
    el('div', { className: 'form-grid__full' }, [motivoField.element]),
  ]);

  openModal({
    title: edicao ? 'Editar afastamento' : 'Novo afastamento',
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: ({ close, setOcupado }) => {
          omField.setError(null);
          motivoField.setError(null);

          const om = omField.getValue();
          if (!om) {
            omField.setError('Informe a OM de destino');
            return;
          }
          if (!periodoValido(inicioField, fimField, 'A data de retorno')) return;

          const motivo = motivoField.getValue();
          if (!motivo) {
            motivoField.setError('Informe o motivo do afastamento');
            return;
          }

          const body = {
            equipamento_id: equipamentoId,
            om,
            motivo,
            data_inicio: inicioField.getValue(),
            previsao_termino: previsaoField.getValue(),
            data_fim: fimField.getValue(),
          };

          gravarNoModal({
            gravar: async () => {
              if (edicao) {
                await updateAfastamento(registro.id, body);
                showSuccess('Afastamento atualizado com sucesso');
              } else {
                await createAfastamento(body);
                showSuccess('Afastamento registrado com sucesso');
              }
            },
            close,
            setOcupado,
            aoGravar: onSaved,
            erroPadrao: 'Erro ao salvar o afastamento',
          });
        },
      },
    ],
  });
}
