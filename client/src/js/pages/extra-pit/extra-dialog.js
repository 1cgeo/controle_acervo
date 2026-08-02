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
import { createExtraPit, updateExtraPit } from '@services/plataforma-service.js';

// dominio.situacao_extra_pit. Os códigos são os mesmos do SAP, de propósito:
// quando os dois sistemas se fundirem, a linha migrada não precisa de tradução.
const SITUACOES = [
  { value: 1, label: 'Previsto' },
  { value: 2, label: 'Em produção' },
  { value: 3, label: 'Enviado' },
  { value: 4, label: 'Concluído' },
  { value: 5, label: 'Cancelado' },
];

/**
 * Criar ou editar uma demanda Extra-PIT. Só o administrador global chega aqui.
 *
 * @param {Object} options
 * @param {Object|null} [options.demanda] - demanda existente (null cria nova)
 * @param {number} [options.ano] - ano da demanda nova
 * @param {Function} [options.onSaved]
 */
export function openExtraPitDialog({ demanda = null, ano = null, onSaved = null } = {}) {
  const isEdit = Boolean(demanda);
  const anoAlvo = isEdit ? demanda.ano : (ano || new Date().getFullYear());

  const demandanteField = createTextField({
    label: 'Demandante',
    required: true,
    maxLength: 255,
    placeholder: 'Ex.: CMS, COTER',
    value: demanda?.demandante ?? '',
  });
  // TEXTO LIVRE, e não a lista de tipos de produto do acervo: a demanda
  // Extra-PIT é justamente a que não cabe no catálogo (super-resolução de
  // imagem, carta especial de uma vez só).
  const tipoProdutoField = createTextField({
    label: 'Tipo de produto',
    required: true,
    maxLength: 255,
    value: demanda?.tipo_produto ?? '',
    helpText: 'Texto livre: a demanda Extra-PIT costuma ser o que não está no catálogo.',
  });
  const quantidadeField = createNumberField({
    label: 'Quantidade',
    required: true,
    min: 1,
    step: 1,
    value: demanda?.quantidade ?? undefined,
  });
  const situacaoField = createSelectField({
    label: 'Situação',
    required: true,
    options: SITUACOES,
    value: demanda?.situacao_id ?? 1,
  });
  // OBRIGATÓRIO, e é o que separa o Extra-PIT de trabalho fora do plano: o
  // RPCMTec chama de Extra-PIT a exceção AUTORIZADA, e o modelo tem uma coluna
  // para o documento.
  const documentoField = createTextField({
    label: 'Documento de autorização',
    required: true,
    maxLength: 255,
    placeholder: 'Ex.: Of 123-S/1 CGEO',
    value: demanda?.documento_autorizacao ?? '',
    helpText: 'É o que distingue a exceção autorizada de trabalho fora do plano.',
  });
  const dataEntregaField = createDateField({
    label: 'Data de entrega',
    value: demanda?.data_entrega ?? '',
  });
  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: demanda?.descricao ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    demandanteField.element,
    tipoProdutoField.element,
    quantidadeField.element,
    situacaoField.element,
    documentoField.element,
    dataEntregaField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? `Editar demanda Extra-PIT (${anoAlvo})` : `Nova demanda Extra-PIT (${anoAlvo})`,
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          demandanteField.setError(null);
          tipoProdutoField.setError(null);
          quantidadeField.setError(null);
          situacaoField.setError(null);
          documentoField.setError(null);

          const demandante = demandanteField.getValue();
          const tipoProduto = tipoProdutoField.getValue();
          const quantidade = quantidadeField.getValue();
          const situacaoId = situacaoField.getValue();
          const documento = documentoField.getValue();

          if (!demandante) return demandanteField.setError('Informe o demandante');
          if (!tipoProduto) return tipoProdutoField.setError('Informe o tipo de produto');
          if (quantidade === null || quantidade < 1) {
            return quantidadeField.setError('Informe a quantidade');
          }
          if (situacaoId === null) return situacaoField.setError('Escolha a situação');
          if (!documento) {
            return documentoField.setError('Informe o documento de autorização');
          }

          const payload = {
            ano: anoAlvo,
            demandante,
            tipo_produto: tipoProduto,
            quantidade,
            situacao_id: Number(situacaoId),
            documento_autorizacao: documento,
            data_entrega: dataEntregaField.getValue(),
            descricao: descricaoField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateExtraPit(demanda.id, payload);
              showSuccess('Demanda Extra-PIT atualizada com sucesso');
            } else {
              await createExtraPit(payload);
              showSuccess('Demanda Extra-PIT criada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar a demanda Extra-PIT');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
