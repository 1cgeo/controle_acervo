import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createPlotter, updatePlotter } from '@services/mapoteca-service.js';
import { toIsoDate } from '@utils/format.js';

/**
 * Open the create/edit dialog for a plotter.
 * @param {Object} options
 * @param {Object|null} [options.plotter] - existing plotter to edit (null creates a new one)
 * @param {Function} [options.onSaved] - called after a successful save
 */
export function openPlotterDialog({ plotter = null, onSaved = null } = {}) {
  const isEdit = Boolean(plotter);

  const ativoField = createCheckboxField({
    label: 'Ativo',
    checked: plotter ? Boolean(plotter.ativo) : true,
  });
  const nrSerieField = createTextField({
    label: 'Número de série',
    required: true,
    maxLength: 255,
    value: plotter?.nr_serie || '',
  });
  const modeloField = createTextField({
    label: 'Modelo',
    required: true,
    maxLength: 255,
    value: plotter?.modelo || '',
  });
  const dataAquisicaoField = createDateField({
    label: 'Data de aquisição',
    value: plotter?.data_aquisicao ? (toIsoDate(plotter.data_aquisicao) || '') : '',
  });
  const vidaUtilField = createNumberField({
    label: 'Vida útil (meses)',
    min: 0,
    step: 1,
    value: plotter?.vida_util ?? undefined,
  });

  const content = el('div', { className: 'form-grid' }, [
    nrSerieField.element,
    modeloField.element,
    dataAquisicaoField.element,
    vidaUtilField.element,
    el('div', { className: 'form-grid__full' }, [ativoField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? 'Editar plotter' : 'Novo plotter',
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          nrSerieField.setError(null);
          modeloField.setError(null);
          vidaUtilField.setError(null);

          const nrSerie = nrSerieField.getValue();
          const modelo = modeloField.getValue();
          const vidaUtil = vidaUtilField.getValue();

          let valid = true;
          if (!nrSerie) {
            nrSerieField.setError('Informe o número de série');
            valid = false;
          }
          if (!modelo) {
            modeloField.setError('Informe o modelo');
            valid = false;
          }
          if (vidaUtil !== null && (!Number.isInteger(vidaUtil) || vidaUtil < 0)) {
            vidaUtilField.setError('Informe um número inteiro de meses');
            valid = false;
          }
          if (!valid) return;

          const payload = {
            ativo: ativoField.getValue(),
            nr_serie: nrSerie,
            modelo,
            data_aquisicao: dataAquisicaoField.getValue(),
            vida_util: vidaUtil,
          };

          saving = true;
          try {
            if (isEdit) {
              await updatePlotter({ id: plotter.id, ...payload });
              showSuccess('Plotter atualizado com sucesso');
            } else {
              await createPlotter(payload);
              showSuccess('Plotter criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar o plotter');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
