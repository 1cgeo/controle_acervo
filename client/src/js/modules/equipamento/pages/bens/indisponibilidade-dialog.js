import { el } from '@utils/dom.js';
import { showSuccess } from '@utils/toast.js';
import { openModal } from '@components/modal/modal-base.js';
import { createDateField, createTextareaField } from '@components/form-fields/form-fields.js';
import {
  createIndisponibilidade,
  updateIndisponibilidade,
} from '@modules/equipamento/services/equipamento-service.js';
import { periodoValido, gravarNoModal } from '@modules/equipamento/dialogo-comum.js';

/**
 * Lançamento de INDISPONIBILIDADE (do operador).
 *
 * É o registro que manda no painel: `equipamento.situacao_em(dia)` põe o bem em
 * `Indisponível` (precedência 40, a maior depois da baixa) enquanto houver uma
 * linha aberta, e a lista "Parados há mais tempo" conta os dias a partir da
 * `data_inicio` daqui.
 *
 * SEM DATA DE FIM SIGNIFICA "AINDA PARADO", e é o caso das 11 linhas que vieram
 * da planilha de 03/08/2026. Preencher a data de fim é o que devolve o bem.
 *
 * O BANCO RECUSA PERÍODO SOBREPOSTO para o mesmo bem (a restrição
 * `indisponibilidade_sem_sobreposicao`, um EXCLUDE com daterange). A tela não
 * repete essa conta: ela chega como mensagem do servidor, que é quem conhece as
 * outras linhas.
 *
 * @param {Object} opcoes
 * @param {number} opcoes.equipamentoId
 * @param {Object|null} [opcoes.registro]
 * @param {Function} [opcoes.onSaved]
 */
export function abrirIndisponibilidadeDialog({ equipamentoId, registro = null, onSaved } = {}) {
  const edicao = Boolean(registro);

  const inicioField = createDateField({
    label: 'Início',
    required: true,
    value: registro?.data_inicio ?? '',
  });
  const fimField = createDateField({
    label: 'Fim',
    value: registro?.data_fim ?? '',
    helpText: 'Em branco: o bem continua parado.',
  });
  const previsaoField = createDateField({
    label: 'Previsão de retorno',
    value: registro?.previsao_retorno ?? '',
  });
  const motivoField = createTextareaField({
    label: 'Motivo',
    required: true,
    rows: 3,
    value: registro?.motivo ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    inicioField.element,
    fimField.element,
    previsaoField.element,
    el('div', { className: 'form-grid__full' }, [motivoField.element]),
  ]);

  openModal({
    title: edicao ? 'Editar indisponibilidade' : 'Nova indisponibilidade',
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: ({ close, setOcupado }) => {
          motivoField.setError(null);
          if (!periodoValido(inicioField, fimField, 'A data de fim')) return;

          const motivo = motivoField.getValue();
          if (!motivo) {
            motivoField.setError('Informe o motivo da indisponibilidade');
            return;
          }

          // `equipamento_id` vai no corpo TAMBÉM na edição: os schemas do
          // servidor cobram o dono no `models.atualizar`, e o PUT sem ele volta
          // 400 sempre. Foi assim que a liquidação do orçamento quebrou.
          const body = {
            equipamento_id: equipamentoId,
            data_inicio: inicioField.getValue(),
            data_fim: fimField.getValue(),
            motivo,
            previsao_retorno: previsaoField.getValue(),
          };

          gravarNoModal({
            gravar: async () => {
              if (edicao) {
                await updateIndisponibilidade(registro.id, body);
                showSuccess('Indisponibilidade atualizada com sucesso');
              } else {
                await createIndisponibilidade(body);
                showSuccess('Indisponibilidade registrada com sucesso');
              }
            },
            close,
            setOcupado,
            aoGravar: onSaved,
            erroPadrao: 'Erro ao salvar a indisponibilidade',
          });
        },
      },
    ],
  });
}
