import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createNumberField,
  createTextField,
  createTextareaField,
  createSelectField,
  createDateField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createCapacitacao, updateCapacitacao } from '@services/plataforma-service.js';

// dominio.tipo_capacitacao e dominio.situacao_capacitacao. Códigos iguais aos do
// SAP, de propósito: na fusão a linha migrada não precisa de tradução.
export const MINISTRADA = 1;
export const RECEBIDA = 2;

const SITUACOES = [
  { value: 1, label: 'Prevista' },
  { value: 2, label: 'Em execução' },
  { value: 3, label: 'Concluída' },
  { value: 4, label: 'Cancelada' },
];

/**
 * Criar ou editar uma capacitação.
 *
 * O TIPO vem da TELA, e não de um campo (chefe, 2026-08-02). Ministrada e
 * recebida viraram duas telas, em dois lugares do menu, e quem abre este
 * formulário já decidiu qual das duas está cadastrando. Com o tipo como campo, a
 * pessoa escolhia de que lado estava antes de saber o que ia digitar, e trocá-lo
 * no meio limparia três campos já preenchidos.
 *
 * O tipo decide QUAIS campos existem: ministrada pergunta quantos de fora nós
 * treinamos, recebida pergunta quem foi e sob que Plano/Código.
 *
 * @param {Object} options
 * @param {Object|null} [options.capacitacao]
 * @param {number} [options.ano]
 * @param {number} options.tipoId - MINISTRADA ou RECEBIDA, fixo pela tela
 * @param {Function} [options.onSaved]
 */
export function openCapacitacaoDialog({
  capacitacao = null, ano = null, tipoId = MINISTRADA, onSaved = null,
} = {}) {
  const isEdit = Boolean(capacitacao);
  const anoAlvo = isEdit ? capacitacao.ano : (ano || new Date().getFullYear());
  const tipo = capacitacao?.tipo_id ?? tipoId;
  const ministrada = Number(tipo) === MINISTRADA;

  const nomeField = createTextField({
    label: 'Capacitação',
    required: true,
    maxLength: 255,
    value: capacitacao?.nome ?? '',
  });
  const situacaoField = createSelectField({
    label: 'Situação',
    required: true,
    options: SITUACOES,
    value: capacitacao?.situacao_id ?? 1,
  });
  const instituicoesField = createTextField({
    label: 'Instituições',
    value: capacitacao?.instituicoes ?? '',
  });
  const localField = createTextField({
    label: 'Local',
    maxLength: 255,
    value: capacitacao?.local_realizacao ?? '',
  });
  const inicioField = createDateField({
    label: 'Início',
    value: capacitacao?.data_inicio ?? '',
  });
  const fimField = createDateField({
    label: 'Término',
    value: capacitacao?.data_fim ?? '',
  });
  const documentoField = createTextField({
    label: 'Documento',
    maxLength: 255,
    value: capacitacao?.documento ?? '',
  });

  // Só da MINISTRADA.
  const efetivoField = createNumberField({
    label: 'Efetivo capacitado',
    min: 0,
    step: 1,
    value: capacitacao?.efetivo_capacitado ?? undefined,
    helpText: 'Quantas pessoas DE FORA foram treinadas.',
  });

  // Só da RECEBIDA.
  const planoField = createTextField({
    label: 'Plano / Código',
    maxLength: 255,
    placeholder: 'Ex.: C25/DCT003 PCE-EECN',
    value: capacitacao?.plano_codigo ?? '',
  });
  const militaresField = createTextareaField({
    label: 'Militares',
    value: capacitacao?.militares ?? '',
    helpText: 'Quem da Divisão está em capacitação.',
  });

  // Só os campos do tipo desta tela entram no formulário. Os do outro nem são
  // montados: escondê-los por CSS deixaria valor pendurado num campo invisível.
  const especificos = ministrada
    ? [el('div', { className: 'form-grid__full' }, [efetivoField.element])]
    : [
      planoField.element,
      el('div', { className: 'form-grid__full' }, [militaresField.element]),
    ];

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    situacaoField.element,
    documentoField.element,
    inicioField.element,
    fimField.element,
    instituicoesField.element,
    localField.element,
    ...especificos,
  ]);

  let saving = false;

  const nomeTipo = ministrada ? 'ministrada' : 'recebida';

  openModal({
    title: isEdit
      ? `Editar capacitação ${nomeTipo} (${anoAlvo})`
      : `Nova capacitação ${nomeTipo} (${anoAlvo})`,
    content,
    width: '680px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          nomeField.setError(null);
          situacaoField.setError(null);
          fimField.setError(null);

          const nome = nomeField.getValue();
          const situacao = situacaoField.getValue();
          const inicio = inicioField.getValue();
          const fim = fimField.getValue();

          if (!nome) return nomeField.setError('Informe o nome da capacitação');
          if (situacao === null) return situacaoField.setError('Escolha a situação');
          // O banco tem o mesmo CHECK. Cobrar aqui evita o 500 cru da restrição.
          if (inicio && fim && fim < inicio) {
            return fimField.setError('O término não pode ser antes do início');
          }

          const payload = {
            ano: anoAlvo,
            nome,
            tipo_id: Number(tipo),
            situacao_id: Number(situacao),
            instituicoes: instituicoesField.getValue() || null,
            local_realizacao: localField.getValue() || null,
            data_inicio: inicio,
            data_fim: fim,
            // O campo do OUTRO tipo vai NULO, e não é só cosmético: ele sai numa
            // subseção diferente do relatório, e um valor esquecido apareceria lá.
            efetivo_capacitado: ministrada ? efetivoField.getValue() : null,
            plano_codigo: ministrada ? null : (planoField.getValue() || null),
            militares: ministrada ? null : (militaresField.getValue() || null),
            documento: documentoField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateCapacitacao(capacitacao.id, payload);
              showSuccess('Capacitação atualizada com sucesso');
            } else {
              await createCapacitacao(payload);
              showSuccess('Capacitação criada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar a capacitação');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
