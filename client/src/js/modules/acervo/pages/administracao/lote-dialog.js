import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createTextareaField,
  createDateField,
  createSelectField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { criarLote, atualizarLote } from '@modules/acervo/services/admin-service.js';
import { criarHistorico } from '@components/historico/historico.js';

/**
 * Formulario de lote.
 *
 * O lote PERTENCE a um projeto, e essa e a diferenca dele para o projeto: o
 * `projeto_id` e obrigatorio no servidor, entao sem projeto cadastrado nao ha
 * lote possivel. A aba avisa disso em vez de abrir um formulario que so falharia
 * no botao de salvar.
 *
 * Datas: dia de calendario, como no projeto. Ver o comentario de projeto-dialog.
 *
 * @param {Object} options
 * @param {Object|null} [options.lote] - lote existente (null cria um novo)
 * @param {Array<{id:number, nome:string}>} options.projetos
 * @param {Array<{code:number, nome:string}>} options.statusExecucao
 * @param {Function} [options.onSaved]
 */
export function openLoteDialog({
  lote = null,
  projetos = [],
  statusExecucao = [],
  onSaved = null,
} = {}) {
  const isEdit = Boolean(lote);

  const projetoField = createSelectField({
    label: 'Projeto',
    required: true,
    options: projetos.map(p => ({ value: p.id, label: p.nome })),
    value: lote?.projeto_id,
  });

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    value: lote?.nome || '',
  });

  const pitField = createTextField({
    label: 'PIT',
    required: true,
    value: lote?.pit || '',
    helpText: 'Identificação do lote no Plano Interno de Trabalho',
  });

  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: lote?.descricao || '',
  });

  const dataInicioField = createDateField({
    label: 'Data de início',
    required: true,
    value: lote?.data_inicio || '',
  });

  const dataFimField = createDateField({
    label: 'Data de fim',
    value: lote?.data_fim || '',
    helpText: 'Vazio enquanto o lote não terminou',
  });

  const statusField = createSelectField({
    label: 'Status de execução',
    required: true,
    options: statusExecucao.map(s => ({ value: s.code, label: s.nome })),
    value: lote?.status_execucao_id,
  });

  const historico = isEdit
    ? criarHistorico({
      modulo: 'acervo',
      entidade: 'projeto',
      id: lote.projeto_id,
      titulo: 'Histórico do projeto',
      subtitulo: 'O agregado é o projeto: o histórico traz ele e todos os lotes dele',
      recolhido: true,
    })
    : null;

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [projetoField.element]),
    nomeField.element,
    pitField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    dataInicioField.element,
    dataFimField.element,
    el('div', { className: 'form-grid__full' }, [statusField.element]),
    historico
      ? el('div', { className: 'form-grid__full' }, [historico.element])
      : null,
  ].filter(Boolean));

  let saving = false;

  openModal({
    title: isEdit ? 'Editar lote' : 'Novo lote',
    content,
    width: '620px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          projetoField.setError(null);
          nomeField.setError(null);
          pitField.setError(null);
          dataInicioField.setError(null);
          dataFimField.setError(null);
          statusField.setError(null);

          const projetoId = projetoField.getValue();
          const nome = nomeField.getValue();
          const pit = pitField.getValue();
          const dataInicio = dataInicioField.getValue();
          const dataFim = dataFimField.getValue();
          const statusId = statusField.getValue();

          let valid = true;
          if (projetoId === null) {
            projetoField.setError('Escolha o projeto do lote');
            valid = false;
          }
          if (!nome) {
            nomeField.setError('Informe o nome do lote');
            valid = false;
          }
          if (!pit) {
            pitField.setError('Informe o PIT do lote');
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
          if (dataInicio && dataFim && dataFim < dataInicio) {
            dataFimField.setError('A data de fim não pode ser anterior à de início');
            valid = false;
          }
          if (!valid) return;

          const payload = {
            projeto_id: projetoId,
            pit,
            nome,
            descricao: descricaoField.getValue() || '',
            data_inicio: dataInicio,
            data_fim: dataFim,
            status_execucao_id: statusId,
          };

          saving = true;
          try {
            if (isEdit) {
              await atualizarLote({ id: lote.id, ...payload });
              showSuccess('Lote atualizado com sucesso');
            } else {
              await criarLote(payload);
              showSuccess('Lote criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar o lote');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
