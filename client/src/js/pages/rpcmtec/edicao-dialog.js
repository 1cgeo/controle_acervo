import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { showError, showSuccess } from '@utils/toast.js';
import {
  createNumberField, createSelectField, createComboBoxField, createDateField,
} from '@components/form-fields/form-fields.js';
import { criarEdicao, atualizarEdicao } from '@services/rpcmtec-service.js';

/**
 * O metadado da edicao mensal: ano, mes, quem assina e a data da assinatura.
 *
 * O ASSINANTE e o cadastro (`dgeo.usuario`), e nao um nome digitado: o bloco de
 * assinatura do PDF sai dali, e nome livre nao aponta pessoa. Ele e opcional na
 * criacao porque quem vai assinar nem sempre se sabe no dia 1o, e o FECHAMENTO
 * o cobra.
 *
 * A DATA DE ASSINATURA continua editavel com a edicao fechada, e e deliberado:
 * o documento e assinado DEPOIS de fechado, e e ai que essa informacao chega. O
 * que o fechamento congela e o que o relatorio afirma, nao quem o assinou.
 */

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function abrirDialogoEdicao({
  edicao = null, usuarios = [], onSaved = null,
} = {}) {
  const editando = Boolean(edicao);
  const hoje = new Date();

  const anoField = createNumberField({
    label: 'Ano',
    required: true,
    min: 2000,
    max: 2100,
    step: 1,
    value: edicao?.ano ?? hoje.getFullYear(),
  });

  const mesField = createSelectField({
    label: 'Mês',
    required: true,
    options: MESES.map((nome, i) => ({ value: i + 1, label: nome })),
    value: edicao?.mes ?? (hoje.getMonth() + 1),
  });

  const assinanteField = createComboBoxField({
    label: 'Assinante',
    placeholder: 'A definir',
    options: usuarios.map((u) => ({
      value: u.uuid,
      label: `${u.tipo_posto_grad || ''} ${u.nome_guerra}`.trim(),
    })),
    value: edicao?.assinante_uuid ?? undefined,
    helpText: 'Quem assina o relatório. Obrigatório para fechar a edição.',
  });

  const dataField = createDateField({
    label: 'Data da assinatura',
    value: edicao?.data_assinatura ? String(edicao.data_assinatura).slice(0, 10) : '',
    helpText: 'Preencha depois de o documento voltar assinado.',
  });

  const conteudo = el('div', { className: 'form-grid' }, [
    anoField.element,
    mesField.element,
    el('div', { className: 'form-grid__full' }, [assinanteField.element]),
    dataField.element,
  ]);

  let salvando = false;

  openModal({
    title: editando ? 'Editar edição do RPCMTec' : 'Nova edição do RPCMTec',
    content: conteudo,
    width: '620px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (salvando) return;
          anoField.setError(null);
          mesField.setError(null);

          const ano = anoField.getValue();
          const mes = mesField.getValue();
          if (!ano) return anoField.setError('Informe o ano');
          if (mes === null) return mesField.setError('Escolha o mês');

          const body = {
            ano: Number(ano),
            mes: Number(mes),
            assinante_uuid: assinanteField.getValue() || null,
            data_assinatura: dataField.getValue() || null,
          };

          salvando = true;
          try {
            if (editando) {
              await atualizarEdicao(edicao.id, body);
              showSuccess('Edição atualizada com sucesso');
            } else {
              const criada = await criarEdicao(body);
              showSuccess('Edição criada com sucesso');
              close();
              if (onSaved) onSaved(criada);
              return;
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar a edição');
          } finally {
            salvando = false;
          }
        },
      },
    ],
  });
}
