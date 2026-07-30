import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createNumberField, createTextareaField } from '@components/form-fields/form-fields.js';
import { formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { registrarImpressao } from '@modules/mapoteca/services/mapoteca-service.js';

/**
 * Id do item do pedido, venha ele de qual tela vier.
 *
 * A fila de atendimento le a rota '/pedido/:id/impressao', que chama o campo de
 * `produto_pedido_id`. O detalhe do pedido le '/pedido/:id', que traz o mesmo
 * item com o campo chamado `id`. Sem esta normalizacao, o dialogo compartilhado
 * mandaria `undefined` para o servidor numa das duas telas.
 * @param {object} item
 * @returns {number}
 */
function idDoItem(item) {
  return item.produto_pedido_id != null ? item.produto_pedido_id : item.id;
}

function nomeDoItem(item) {
  return item.produto_nome || item.mi || 'item';
}

/**
 * Dialogo de REGISTRAR IMPRESSAO, usado pela fila de atendimento e pelo detalhe
 * do pedido.
 *
 * A impressao e LIVRO-CAIXA (decisao do chefe, 2026-07-30): ninguem edita a
 * quantidade impressa, quem imprimiu ADICIONA uma sessao. E por isso que o chefe
 * consegue ver que uma pessoa imprimiu 40 e outra imprimiu 10. Nao existe rota
 * de atualizacao de impressao, so POST e DELETE.
 *
 * Dai o cuidado com o texto: o numero digitado SOMA ao que ja foi impresso, e
 * nunca substitui. Quem entender ao contrario lanca o total acumulado e dobra a
 * contagem do item, sem nenhum erro na tela.
 *
 * @param {object} item - item do pedido (aceita `produto_pedido_id` ou `id`)
 * @param {Function} [onDone] - chamado depois do registro, para recarregar a tela
 */
export function openRegistrarImpressaoDialog(item, onDone) {
  const jaImpressas = Number(item.quantidade_impressa) || 0;
  const restante = Number(item.quantidade_restante) || 0;

  // O padrao e o que FALTA: quem imprime o lote todo confirma sem digitar, e
  // quem imprimiu parte corrige o numero.
  const quantidade = createNumberField({
    label: 'Cópias que saíram AGORA',
    value: restante > 0 ? restante : 1,
    min: 1,
    required: true,
    helpText: `Pedidas ${formatNumber(item.quantidade)}, já impressas ${formatNumber(jaImpressas)}.`
      + ' Este número SOMA ao total; ele nunca substitui o que já foi lançado.',
  });
  const observacao = createTextareaField({
    label: 'Observação (opcional)',
    rows: 2,
    helpText: 'Ex.: plotter 2, papel novo, reimpressão da folha rasgada.',
  });

  // O aviso repetido em destaque, fora do texto de ajuda do campo: o erro que ele
  // evita (lancar o total acumulado) nao aparece como erro em tela nenhuma.
  const aviso = el('div', {
    className: 'detail-card__label',
    textContent: `Depois de registrar ${formatNumber(restante > 0 ? restante : 1)} cópia(s),`
      + ` o item passa a ter ${formatNumber(jaImpressas + (restante > 0 ? restante : 1))} impressa(s).`,
  });

  let enviando = false;

  // Mantem o aviso coerente enquanto a pessoa digita: o total previsto muda com
  // o numero, e um aviso congelado no padrao mentiria a partir da primeira tecla.
  quantidade.input.addEventListener('input', () => {
    const qtd = quantidade.getValue();
    aviso.textContent = qtd && qtd > 0
      ? `Depois de registrar ${formatNumber(qtd)} cópia(s), o item passa a ter `
        + `${formatNumber(jaImpressas + qtd)} impressa(s).`
      : 'Informe quantas cópias saíram agora.';
  });

  openModal({
    title: `Registrar impressão: ${nomeDoItem(item)}`,
    content: el('div', { className: 'form-grid' }, [
      quantidade.element,
      observacao.element,
      aviso,
    ]),
    width: '520px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Registrar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (enviando) return;
          quantidade.setError(null);
          const qtd = quantidade.getValue();
          if (!qtd || qtd < 1) {
            quantidade.setError('Informe quantas cópias saíram');
            return;
          }
          enviando = true;
          try {
            await registrarImpressao([{
              produto_pedido_id: idDoItem(item),
              quantidade: qtd,
              observacao: observacao.getValue() || undefined,
            }]);
            showSuccess('Impressão registrada');
            close();
            if (onDone) onDone();
          } catch (err) {
            enviando = false;
            showError(err.message || 'Erro ao registrar a impressão');
          }
        },
      },
    ],
  });
}
