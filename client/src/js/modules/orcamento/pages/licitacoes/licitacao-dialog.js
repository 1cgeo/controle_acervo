import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createSelectField,
  createNumberField,
  createTextField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getLicitacao,
  createLicitacao,
  updateLicitacao,
  getTipoLicitacao,
} from '@modules/orcamento/services/orcamento-service.js';
import { getAno } from '@modules/orcamento/store/year-store.js';

// Codigo do tipo Participante: so nesse tipo a OM gestora pode ser outra OM.
const TIPO_PARTICIPANTE = 3;

/**
 * Abre o dialog de criar/editar Licitacao.
 * O tipo da licitacao decide a tabela do RPCMTec: tipo 1 (GCALC DSG) alimenta a
 * tabela 3.4 e tipo 2 (Própria) alimenta a tabela 3.5. Uma licitacao pode cobrir
 * varios DFDs, entao nao ha vinculo direto a um DFD. Em GCALC DSG e Própria a OM
 * gestora e a propria OM; so em Participante a OM gestora pode ser outra.
 * @param {Object} options
 * @param {number|null} [options.licId] - id da licitacao existente para editar (null cria nova)
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export async function openLicitacaoDialog({ licId = null, onSaved = null } = {}) {
  const isEdit = licId !== null && licId !== undefined;

  let tipos = [];
  let lic = null;

  try {
    tipos = await getTipoLicitacao();
    if (isEdit) lic = await getLicitacao(licId);
  } catch (err) {
    showError(err.message || 'Erro ao carregar dados da licitação');
    return;
  }

  const tipoOptions = (tipos || []).map(t => ({ value: t.code, label: t.nome }));

  // ---- Campos ----
  const tipoField = createSelectField({
    label: 'Tipo',
    required: true,
    options: tipoOptions,
    value: lic?.tipo_id ?? undefined,
    helpText: '1 = GCALC DSG (tabela 3.4); 2 = Própria (tabela 3.5); 3 = Participante.',
    onChange: (v) => updateOmVisibility(v),
  });
  const objetoField = createTextareaField({
    label: 'Objeto',
    required: true,
    value: lic?.objeto ?? '',
  });
  const faseAtualField = createTextareaField({
    label: 'Fase atual',
    value: lic?.fase_atual ?? '',
  });
  const valorEstimadoField = createNumberField({
    label: 'Valor total estimado',
    min: 0,
    step: 0.01,
    value: lic?.valor_total_estimado ?? undefined,
  });
  const valorHomologadoField = createNumberField({
    label: 'Valor final homologado',
    min: 0,
    step: 0.01,
    value: lic?.valor_final_homologado ?? undefined,
  });
  const omGestoraField = createTextField({
    label: 'OM gestora',
    maxLength: 100,
    value: lic?.om_gestora ?? '',
    helpText: 'Só em Participante (a OM que conduz a licitação). Em GCALC DSG e Própria é a própria OM.',
  });

  // A OM gestora so aparece quando o tipo e Participante; em GCALC DSG/Própria a
  // gestora e a propria OM (campo oculto e gravado como null).
  const omWrapper = el('div', {}, [omGestoraField.element]);
  function updateOmVisibility(tipoId) {
    if (Number(tipoId) === TIPO_PARTICIPANTE) {
      omWrapper.classList.remove('hidden');
    } else {
      omWrapper.classList.add('hidden');
      omGestoraField.setValue('');
    }
  }
  updateOmVisibility(lic?.tipo_id);

  const content = el('div', { className: 'form-grid' }, [
    tipoField.element,
    el('div', { className: 'form-grid__full' }, [objetoField.element]),
    el('div', { className: 'form-grid__full' }, [faseAtualField.element]),
    valorEstimadoField.element,
    valorHomologadoField.element,
    omWrapper,
  ]);

  let saving = false;

  openModal({
    title: isEdit ? `Editar licitação (${lic.ano})` : `Nova licitação (${getAno()})`,
    content,
    width: '760px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          tipoField.setError(null);
          objetoField.setError(null);

          const tipoId = tipoField.getValue();
          const objeto = objetoField.getValue();

          let valid = true;
          if (tipoId === null || tipoId === undefined) {
            tipoField.setError('Selecione o tipo');
            valid = false;
          }
          if (!objeto) {
            objetoField.setError('Informe o objeto da licitação');
            valid = false;
          }
          if (!valid) return;

          const body = {
            ano: isEdit ? lic.ano : getAno(),
            tipo_id: tipoId,
            objeto,
            fase_atual: faseAtualField.getValue() || null,
            valor_total_estimado: valorEstimadoField.getValue(),
            valor_final_homologado: valorHomologadoField.getValue(),
            // OM gestora so vale para Participante; nos demais e a propria OM (null).
            om_gestora: Number(tipoId) === TIPO_PARTICIPANTE ? (omGestoraField.getValue() || null) : null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateLicitacao(licId, body);
              showSuccess('Licitação atualizada com sucesso');
            } else {
              await createLicitacao(body);
              showSuccess('Licitação criada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar licitação');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
