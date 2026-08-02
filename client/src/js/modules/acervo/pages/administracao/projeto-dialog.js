import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createTextareaField,
  createDateField,
  createSelectField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { criarProjeto, atualizarProjeto } from '@modules/acervo/services/admin-service.js';

/**
 * Formulario de projeto do acervo.
 *
 * AS DATAS SAO DIA DE CALENDARIO, e o campo manda 'AAAA-MM-DD' cru. O servidor
 * usa `Joi.date().raw()` justamente para a string chegar inteira ao Postgres:
 * sem o `.raw()`, o Joi a converteria em meia-noite UTC e a coluna DATE
 * guardaria o dia ANTERIOR em UTC-3 -- reenviar o que o GET devolveu recuava a
 * data um dia por vez. E o mesmo cuidado de `acervo.versao.data_edicao`.
 *
 * @param {Object} options
 * @param {Object|null} [options.projeto] - projeto existente (null cria um novo)
 * @param {Array<{code:number, nome:string}>} options.statusExecucao
 * @param {Function} [options.onSaved]
 */
export function openProjetoDialog({ projeto = null, statusExecucao = [], onSaved = null } = {}) {
  const isEdit = Boolean(projeto);

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    value: projeto?.nome || '',
  });

  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: projeto?.descricao || '',
  });

  const dataInicioField = createDateField({
    label: 'Data de início',
    required: true,
    value: projeto?.data_inicio || '',
  });

  const dataFimField = createDateField({
    label: 'Data de fim',
    value: projeto?.data_fim || '',
    helpText: 'Vazio enquanto o projeto não terminou',
  });

  const statusField = createSelectField({
    label: 'Status de execução',
    required: true,
    options: statusExecucao.map(s => ({ value: s.code, label: s.nome })),
    value: projeto?.status_execucao_id,
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    dataInicioField.element,
    dataFimField.element,
    el('div', { className: 'form-grid__full' }, [statusField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? 'Editar projeto' : 'Novo projeto',
    content,
    width: '620px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          nomeField.setError(null);
          dataInicioField.setError(null);
          dataFimField.setError(null);
          statusField.setError(null);

          const nome = nomeField.getValue();
          const dataInicio = dataInicioField.getValue();
          const dataFim = dataFimField.getValue();
          const statusId = statusField.getValue();

          let valid = true;
          if (!nome) {
            nomeField.setError('Informe o nome do projeto');
            valid = false;
          }
          if (!dataInicio) {
            dataInicioField.setError('Informe a data de início');
            valid = false;
          }
          if (statusId === null) {
            statusField.setError('Escolha o status de execução');
            valid = false;
          }
          // Espelha o CHECK data_fim >= data_inicio do banco. Comparar as duas
          // strings 'AAAA-MM-DD' basta e nao cria Date nenhum, que e o que
          // arrastaria fuso para dentro de uma comparacao de dia.
          if (dataInicio && dataFim && dataFim < dataInicio) {
            dataFimField.setError('A data de fim não pode ser anterior à de início');
            valid = false;
          }
          if (!valid) return;

          // `descricao` e `Joi.string().allow('').required()`: null seria 400.
          const payload = {
            nome,
            descricao: descricaoField.getValue() || '',
            data_inicio: dataInicio,
            data_fim: dataFim,
            status_execucao_id: statusId,
          };

          saving = true;
          try {
            if (isEdit) {
              await atualizarProjeto({ id: projeto.id, ...payload });
              showSuccess('Projeto atualizado com sucesso');
            } else {
              await criarProjeto(payload);
              showSuccess('Projeto criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar o projeto');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
