import { el } from '@utils/dom.js';
import { formatDate, paraId } from '@utils/format.js';
import { showSuccess } from '@utils/toast.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createSelectField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import {
  createManutencao,
  updateManutencao,
} from '@modules/equipamento/services/equipamento-service.js';
import { periodoValido, gravarNoModal } from '@modules/equipamento/dialogo-comum.js';

/**
 * Lançamento de MANUTENÇÃO (do operador).
 *
 * AS TRÊS COLUNAS DE DINHEIRO SÃO TRÊS FATOS DIFERENTES, e por isso são três
 * campos e não um:
 *
 *   valor        o que a manutenção CUSTOU. É este, e só este, que o cartão
 *                "Manutenção no ano" do painel soma.
 *   valor_orcado o orçamento prévio, antes de contratar.
 *   valor_pdr    o valor PREVISTO no PDR daquele ano. É valor, e não ano: a
 *                única linha real preenchida traz "Previsto em PDR R$600,00".
 *
 * O VÍNCULO COM A INDISPONIBILIDADE é opcional e importa: ele é o que liga "o
 * bem está parado" a "estamos consertando". As opções vêm da ficha, que já
 * carregou as indisponibilidades daquele bem.
 *
 * @param {Object} opcoes
 * @param {number} opcoes.equipamentoId
 * @param {Object|null} [opcoes.registro]
 * @param {Array<Object>} [opcoes.indisponibilidades] - as do próprio bem
 * @param {Function} [opcoes.onSaved]
 */
export function abrirManutencaoDialog({
  equipamentoId,
  registro = null,
  indisponibilidades = [],
  onSaved,
} = {}) {
  const edicao = Boolean(registro);

  const indisponibilidadeField = createSelectField({
    label: 'Indisponibilidade relacionada',
    placeholder: 'Nenhuma',
    options: (indisponibilidades || []).map(i => ({
      value: i.id,
      label: `${formatDate(i.data_inicio)}${i.data_fim ? ` a ${formatDate(i.data_fim)}` : ' (em aberto)'}`
        + (i.motivo ? ` - ${i.motivo}` : ''),
    })),
    value: registro?.indisponibilidade_id ?? undefined,
    helpText: 'Liga o conserto ao período em que o bem ficou parado.',
  });

  const inicioField = createDateField({
    label: 'Início',
    required: true,
    value: registro?.data_inicio ?? '',
  });
  const fimField = createDateField({
    label: 'Fim',
    value: registro?.data_fim ?? '',
    helpText: 'Em branco: manutenção em curso.',
  });

  const valorField = createNumberField({
    label: 'Valor pago (R$)',
    min: 0,
    step: 0.01,
    value: registro?.valor ?? undefined,
    helpText: 'É este valor que entra no custo de manutenção do ano.',
  });
  const valorOrcadoField = createNumberField({
    label: 'Valor orçado (R$)',
    min: 0,
    step: 0.01,
    value: registro?.valor_orcado ?? undefined,
  });
  const valorPdrField = createNumberField({
    label: 'Valor previsto no PDR (R$)',
    min: 0,
    step: 0.01,
    value: registro?.valor_pdr ?? undefined,
  });
  const certameField = createTextField({
    label: 'Certame',
    maxLength: 255,
    placeholder: 'Ex.: Contrata+Brasil',
    value: registro?.certame ?? '',
  });
  const descricaoField = createTextareaField({
    label: 'Descrição',
    rows: 3,
    value: registro?.descricao ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [indisponibilidadeField.element]),
    inicioField.element,
    fimField.element,
    valorField.element,
    valorOrcadoField.element,
    valorPdrField.element,
    certameField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
  ]);

  /**
   * As três colunas de dinheiro têm `CHECK (valor > 0)` no banco: zero é
   * recusado, e "não informado" é NULO. O campo em branco já devolve null; o
   * zero digitado tem de ser barrado aqui, senão a recusa chega como erro de
   * restrição do PostgreSQL, que ninguém lê.
   */
  function valorValido(campo, rotulo) {
    campo.setError(null);
    const v = campo.getValue();
    if (v === null) return true;
    if (v <= 0) {
      campo.setError(`${rotulo} deve ser maior que zero, ou ficar em branco`);
      return false;
    }
    return true;
  }

  openModal({
    title: edicao ? 'Editar manutenção' : 'Nova manutenção',
    content,
    width: '720px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: ({ close, setOcupado }) => {
          if (!periodoValido(inicioField, fimField, 'A data de fim')) return;
          if (!valorValido(valorField, 'O valor pago')) return;
          if (!valorValido(valorOrcadoField, 'O valor orçado')) return;
          if (!valorValido(valorPdrField, 'O valor previsto no PDR')) return;

          const body = {
            equipamento_id: equipamentoId,
            indisponibilidade_id: paraId(indisponibilidadeField.getValue()),
            data_inicio: inicioField.getValue(),
            data_fim: fimField.getValue(),
            descricao: descricaoField.getValue() || null,
            valor: valorField.getValue(),
            valor_orcado: valorOrcadoField.getValue(),
            valor_pdr: valorPdrField.getValue(),
            certame: certameField.getValue() || null,
          };

          gravarNoModal({
            gravar: async () => {
              if (edicao) {
                await updateManutencao(registro.id, body);
                showSuccess('Manutenção atualizada com sucesso');
              } else {
                await createManutencao(body);
                showSuccess('Manutenção registrada com sucesso');
              }
            },
            close,
            setOcupado,
            aoGravar: onSaved,
            erroPadrao: 'Erro ao salvar a manutenção',
          });
        },
      },
    ],
  });
}
