import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  createTextField, createTextareaField, createDateField,
} from '@components/form-fields/form-fields.js';
import { criarHistorico } from '@components/historico/historico.js';
import { criarRevisao, atualizarRevisao } from '@services/plataforma-service.js';

/**
 * O METADADO de uma revisao do PIT: codigo, documento, assinatura e observacao.
 *
 * O QUE NAO ESTA AQUI e a VIGENCIA, e e a decisao central do modelo: rascunho e
 * a revisao sem `data_vigencia`, e preenche-la e PUBLICAR -- um ato proprio, com
 * dialogo proprio. Se ela fosse um campo deste formulario, alguem publicaria
 * uma revisao sem perceber, ao corrigir o nome do assinante.
 *
 * O CODIGO e livre ('R0', 'R1', '2a revisao'): quem o define e o DIEx da DSG, e
 * inventar uma sequencia nossa criaria um segundo nome para a mesma coisa.
 *
 * A REVISAO PUBLICADA continua editavel AQUI, e so aqui. Corrigir o nome de
 * quem assinou e transcricao, nao mudanca de plano; o que ela DECLARA (as
 * metas) e que nao se toca depois de publicada.
 */
export function abrirDialogoRevisao({
  revisao = null, ano = null, onSaved = null,
} = {}) {
  const editando = Boolean(revisao);
  const anoAlvo = editando ? revisao.ano : ano;

  const codigoField = createTextField({
    label: 'Código',
    required: true,
    maxLength: 50,
    placeholder: 'Ex.: R0, R1',
    value: revisao?.codigo ?? '',
    helpText: 'Como o DIEx da DSG a chama. Nós não numeramos por conta.',
  });

  const documentoField = createDateField({
    label: 'Data do documento',
    value: revisao?.data_documento ? String(revisao.data_documento).slice(0, 10) : '',
  });

  const assinaturaField = createDateField({
    label: 'Data da assinatura',
    value: revisao?.data_assinatura ? String(revisao.data_assinatura).slice(0, 10) : '',
  });

  const assinanteField = createTextField({
    label: 'Assinante',
    maxLength: 255,
    placeholder: 'Ex.: Gen Div Fulano de Tal',
    value: revisao?.assinante ?? '',
    helpText: 'Quem assinou o documento na DSG, como ele se identifica.',
  });

  const observacaoField = createTextareaField({
    label: 'Observação',
    value: revisao?.observacao ?? '',
  });

  // O historico cai no agregado do EXERCICIO, que reune a revisao, o anexo e o
  // proprio exercicio: a pergunta e "o que mudou no PIT de 2026".
  const historico = editando
    ? criarHistorico({
      modulo: 'plataforma',
      entidade: 'exercicio',
      id: revisao.ano,
      titulo: 'Histórico do exercício',
      subtitulo: 'Revisões do ano, publicação e anexos do documento assinado',
      recolhido: true,
    })
    : null;

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [codigoField.element]),
    documentoField.element,
    assinaturaField.element,
    el('div', { className: 'form-grid__full' }, [assinanteField.element]),
    el('div', { className: 'form-grid__full' }, [observacaoField.element]),
    historico
      ? el('div', { className: 'form-grid__full' }, [historico.element])
      : null,
  ].filter(Boolean));

  let salvando = false;

  openModal({
    title: editando
      ? `Editar revisão ${revisao.codigo} (${anoAlvo})`
      : `Nova revisão do PIT (${anoAlvo})`,
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (salvando) return;
          codigoField.setError(null);

          const codigo = codigoField.getValue();
          if (!codigo) return codigoField.setError('Informe o código da revisão');

          const body = {
            ano: Number(anoAlvo),
            codigo,
            data_documento: documentoField.getValue() || null,
            data_assinatura: assinaturaField.getValue() || null,
            assinante: assinanteField.getValue() || null,
            observacao: observacaoField.getValue() || null,
          };

          salvando = true;
          try {
            if (editando) {
              await atualizarRevisao(revisao.id, body);
              showSuccess('Revisão atualizada com sucesso');
            } else {
              await criarRevisao(body);
              showSuccess('Revisão criada como RASCUNHO');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar a revisão');
          } finally {
            salvando = false;
          }
        },
      },
    ],
  });
}
