import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { criarHistorico } from '@components/historico/historico.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createSelectField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createFileAttachment } from '@modules/orcamento/components/file-attachment.js';
import {
  getRecolhimento,
  createRecolhimento,
  updateRecolhimento,
  getNaturezaDespesa,
  getUg,
} from '@modules/orcamento/services/orcamento-service.js';

/**
 * Diálogo de UM documento de recolhimento de crédito.
 *
 * O recolhimento é um DOCUMENTO do SIAFI (número, ano, data, ND da anulação, UG
 * emitente e histórico), e não um número digitado na nota de crédito. Até a
 * 1.39.0 ele era o campo `valor_recolhido` da própria NC; medido em 2026-08-07
 * contra o SAG, das 17 NCs alvo do ano 5 estavam com 0,00 no SCA e nada
 * acusava, porque a fonte do número era a memória de quem digitou.
 *
 * O NÚMERO NÃO É ÚNICO SOZINHO. Uma NC de recolhimento pode abater duas NCs
 * nossas, entrando uma vez por alvo com o valor rateado (a 2026NC401316 recolhe
 * R$ 0,98 da 400224 e R$ 0,99 da 400937). Repetir o número é legítimo, desde que
 * a NC alvo seja outra; o servidor devolve 409 só quando o par se repete.
 *
 * @param {Object} options
 * @param {number} options.notaCreditoId - a NC que este documento abate
 * @param {number|null} [options.recolhimentoId] - id existente para editar
 * @param {number} [options.ano] - ano da tela que abriu o diálogo
 * @param {Function} [options.onSaved] - chamado após salvar com sucesso
 */
export async function openRecolhimentoDialog({
  notaCreditoId,
  recolhimentoId = null,
  ano = new Date().getFullYear(),
  onSaved = null,
} = {}) {
  const isEdit = recolhimentoId !== null && recolhimentoId !== undefined;

  let naturezas = [];
  let ugs = [];
  let recolhimento = null;

  try {
    [naturezas, ugs] = await Promise.all([getNaturezaDespesa(), getUg()]);
    if (isEdit) recolhimento = await getRecolhimento(recolhimentoId);
  } catch (err) {
    showError(err.message || 'Erro ao carregar dados do recolhimento');
    return;
  }

  const ndOptions = (naturezas || []).map(nd => ({
    value: nd.code ?? nd.codigo ?? nd.cod_nd ?? nd.id,
    label: `${nd.code ?? nd.codigo ?? nd.cod_nd ?? nd.id} - ${nd.nome ?? ''}`,
  }));
  const ugOptions = (ugs || []).map(ug => ({
    value: ug.code ?? ug.codigo ?? ug.id,
    label: ug.nome
      ? `${ug.code ?? ug.codigo ?? ug.id} - ${ug.nome}`
      : String(ug.code ?? ug.codigo ?? ug.id),
  }));

  // ---- Campos ----
  // Os maxLength copiam o VARCHAR do banco (er/orcamento.sql). Campo que aceita
  // mais do que a coluna guarda só reprova depois de salvar, com erro cru.
  const numeroField = createTextField({
    label: 'Número do documento',
    required: true,
    maxLength: 20,
    placeholder: 'Ex.: 2026NC401316',
    value: recolhimento?.numero ?? '',
    helpText: 'O mesmo documento pode abater mais de uma NC: nesse caso, lance-o '
      + 'uma vez por NC, com o valor rateado.',
  });
  const dataEmissaoField = createDateField({
    label: 'Data de emissão',
    value: recolhimento?.data_emissao ?? '',
  });
  const codNdField = createSelectField({
    label: 'ND da anulação',
    options: ndOptions,
    value: recolhimento?.cod_nd ?? undefined,
    helpText: 'A ND do documento de recolhimento (339000, 449000), que não é a da '
      + 'NC abatida. É por ela que o documento se acha no SIAFI.',
  });
  const ugEmitenteField = createSelectField({
    label: 'UG emitente',
    options: ugOptions,
    value: recolhimento?.ug_emitente ?? undefined,
  });
  const valorField = createNumberField({
    label: 'Valor recolhido',
    required: true,
    min: 0,
    step: 0.01,
    value: recolhimento?.valor ?? undefined,
    helpText: 'Quanto este documento devolve DESTA nota de crédito.',
  });
  const finalidadeField = createTextareaField({
    label: 'Finalidade / histórico',
    value: recolhimento?.finalidade_historico ?? '',
    helpText: 'O texto do SIAFI costuma dizer qual NC o documento abate e, quando '
      + 'há rateio, quanto cabe a cada uma.',
  });
  const observacaoField = createTextareaField({
    label: 'Observação',
    value: recolhimento?.observacao ?? '',
  });

  // Anexos: VÁRIOS, como no PDR e no RPNP. O extrato do SIAFI e o DIEx que pede a
  // devolução são dois documentos, e limitar a um obrigaria a escolher qual
  // guardar. Ao criar, o arquivo escolhido fica retido e sobe depois que o
  // recolhimento ganha id.
  const anexo = createFileAttachment({
    mode: 'multi',
    vinculo: isEdit ? { recolhimento_id: recolhimentoId } : null,
    accept: '.pdf',
    label: 'Anexos (extrato do SIAFI, DIEx)',
    buttonLabel: 'Selecionar PDF',
  });

  const historico = isEdit
    ? criarHistorico({
      modulo: 'orcamento',
      entidade: 'nota_credito',
      id: notaCreditoId,
      titulo: 'Histórico da nota de crédito',
      subtitulo: 'Inclui os recolhimentos desta NC',
      recolhido: true,
    })
    : null;

  const content = el('div', { className: 'form-grid' }, [
    numeroField.element,
    dataEmissaoField.element,
    codNdField.element,
    ugEmitenteField.element,
    valorField.element,
    el('div', { className: 'form-grid__full' }, [finalidadeField.element]),
    el('div', { className: 'form-grid__full' }, [observacaoField.element]),
    el('div', { className: 'form-grid__full' }, [anexo.element]),
    historico ? el('div', { className: 'form-grid__full' }, [historico.element]) : null,
  ].filter(Boolean));

  let saving = false;

  openModal({
    title: isEdit ? 'Editar recolhimento' : 'Novo recolhimento',
    content,
    width: '680px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          numeroField.setError(null);
          valorField.setError(null);

          const numero = numeroField.getValue();
          const valor = valorField.getValue();

          let valid = true;
          if (!numero) {
            numeroField.setError('Informe o número do documento');
            valid = false;
          }
          // O banco cobra `CHECK (valor > 0)`: recolhimento de zero não é
          // documento nenhum. Aqui o usuário vê o erro no campo, antes de enviar.
          if (valor === null || valor <= 0) {
            valorField.setError('Informe um valor maior que zero');
            valid = false;
          }
          if (!valid) return;

          const body = {
            nota_credito_id: Number(notaCreditoId),
            numero,
            ano: isEdit ? recolhimento.ano : ano,
            data_emissao: dataEmissaoField.getValue(),
            cod_nd: codNdField.getValue() || null,
            ug_emitente: ugEmitenteField.getValue() || null,
            valor,
            finalidade_historico: finalidadeField.getValue() || null,
            observacao: observacaoField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateRecolhimento(recolhimentoId, body);
              showSuccess('Recolhimento atualizado com sucesso');
            } else {
              const criado = await createRecolhimento(body);
              // O SUCESSO SÓ SAI SE O ANEXO SUBIU, pelo mesmo motivo da NC: a
              // mensagem de falha vinha primeiro e o "criado com sucesso" por
              // cima dela, então o último aviso dizia sucesso e o PDF escolhido
              // ia junto com o diálogo fechado.
              let anexoFalhou = null;
              if (anexo.hasPending() && criado && criado.id != null) {
                try {
                  await anexo.flush({ recolhimento_id: criado.id });
                } catch (errAnexo) {
                  anexoFalhou = errAnexo.message || 'erro desconhecido';
                }
              }
              if (anexoFalhou) {
                showError(
                  `O recolhimento ${numero} foi criado, mas o anexo NÃO subiu: ${
                    anexoFalhou}. Abra-o em Editar e anexe o arquivo de novo.`
                );
              } else {
                showSuccess('Recolhimento criado com sucesso');
              }
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar recolhimento');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
