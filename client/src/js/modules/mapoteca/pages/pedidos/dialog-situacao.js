import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createSelectField, createDateField, createTextareaField } from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { toIsoDate } from '@utils/format.js';
import {
  getDominioSituacaoPedido, updateSituacaoPedido,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { SITUACAO_PEDIDO } from '@modules/mapoteca/situacao-pedido.js';

/**
 * Mudar a SITUACAO de um pedido a partir da LISTA, sem abrir o detalhe.
 *
 * POR QUE UM DIALOGO, E NAO UM SELECT SOLTO NA CELULA. Metade das mudancas de
 * situacao registradas na auditoria entre 2026-07-30 e 2026-08-24 (13 de 26)
 * cai numa situacao que EXIGE um segundo campo: Concluido exige o dia em que o
 * material saiu (RN02) e Cancelado exige o motivo (RN03). Um select que grava
 * ao trocar teria de abrir um dialogo em metade dos usos, e o outro meio ficaria
 * sem confirmacao nenhuma.
 *
 * A ROTA E `PUT /pedido/:id/situacao`, e nao o `updatePedido`. Aquele reescreve
 * a linha inteira, e a lista nao tem em maos nove dos campos do pedido. Ver o
 * comentario de `updateSituacaoPedido` no service.
 *
 * O ROTULO DE CADA SITUACAO VEM DO SERVIDOR (`getDominioSituacaoPedido`), como
 * na tabela ao lado: `situacao-pedido.js` guarda os CODIGOS, e nunca os nomes.
 *
 * @param {object} pedido - a linha da lista (id, localizador_pedido, cliente_nome,
 *   data_pedido, situacao_pedido_id, data_atendimento)
 * @param {Function} [onDone] - chamado depois de gravar, para a tela recarregar
 */
export async function openSituacaoPedidoDialog(pedido, onDone) {
  let situacoes;
  try {
    situacoes = await getDominioSituacaoPedido();
  } catch (err) {
    // Sem o dominio nao existe dialogo: o select ficaria vazio e quem abriu
    // concluiria que o pedido nao aceita mudanca nenhuma.
    showError(err.message || 'Erro ao carregar as situações de pedido');
    return;
  }

  const atual = Number(pedido.situacao_pedido_id);

  const situacao = createSelectField({
    label: 'Situação',
    required: true,
    placeholder: null,
    options: situacoes.map(s => ({ value: Number(s.code), label: s.nome })),
    value: atual,
    helpText: 'Aguardando produção espera carta que ainda não existe. Aguardando envio é o pedido já impresso, esperando o despacho.',
    onChange: () => aplicarModo(),
  });

  // O dia em que o material SAIU daqui. Nasce no que o pedido ja tem, e cai em
  // hoje quando ele nao tem nada: quem marca Concluido agora costuma estar
  // registrando o envio do dia.
  const dataAtendimento = createDateField({
    label: 'Data de atendimento',
    required: true,
    value: pedido.data_atendimento ? String(pedido.data_atendimento).slice(0, 10) : toIsoDate(new Date()),
    // O servidor recusa data anterior a do pedido, e o campo cobra antes de sair
    // daqui: a mesma regra, dita no lugar onde o erro nasce.
    min: pedido.data_pedido ? String(pedido.data_pedido).slice(0, 10) : undefined,
    helpText: 'Concluído exige a data em que o material saiu daqui.',
  });

  // NASCE VAZIO quando o chamador e a LISTA: ela nao devolve
  // `motivo_cancelamento`. Preencher com o motivo anterior exigiria uma segunda
  // ida ao servidor so para oferecer um texto que quase sempre se reescreve.
  const motivo = createTextareaField({
    label: 'Motivo do cancelamento',
    required: true,
    rows: 3,
    value: pedido.motivo_cancelamento || '',
    helpText: 'Cancelado exige o motivo, e ele fica no registro do pedido.',
  });

  /** So o campo que a situacao escolhida EXIGE fica na tela. */
  function aplicarModo() {
    const escolhida = Number(situacao.getValue());
    dataAtendimento.element.style.display =
      escolhida === SITUACAO_PEDIDO.CONCLUIDO ? '' : 'none';
    motivo.element.style.display =
      escolhida === SITUACAO_PEDIDO.CANCELADO ? '' : 'none';
  }
  aplicarModo();

  const identificacao = pedido.localizador_pedido || `#${pedido.id}`;
  let enviando = false;

  openModal({
    title: `Situação do pedido ${identificacao}`,
    content: el('div', { style: { display: 'grid', gap: 'var(--space-md)' } }, [
      // O CLIENTE na frente: a lista tem dez colunas, e quem clicou no chip
      // precisa ver em qual linha clicou antes de trocar a situacao dela.
      el('div', {
        className: 'page__meta',
        textContent: pedido.cliente_nome || '',
      }),
      situacao.element,
      dataAtendimento.element,
      motivo.element,
    ]),
    width: '520px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (enviando) return;
          dataAtendimento.setError(null);
          motivo.setError(null);

          const escolhida = Number(situacao.getValue());
          // SO O QUE A SITUACAO EXIGE vai no corpo. Chave ausente preserva o
          // valor gravado, entao mandar os dois sempre apagaria o motivo de um
          // cancelamento antigo ao marcar o pedido como Remetido.
          const corpo = { situacao_pedido_id: escolhida };

          if (escolhida === SITUACAO_PEDIDO.CONCLUIDO) {
            const data = dataAtendimento.getValue();
            if (!data) {
              dataAtendimento.setError('Informe a data de atendimento');
              return;
            }
            if (pedido.data_pedido && data < String(pedido.data_pedido).slice(0, 10)) {
              dataAtendimento.setError('A data não pode ser anterior à data do pedido');
              return;
            }
            corpo.data_atendimento = data;
          }

          if (escolhida === SITUACAO_PEDIDO.CANCELADO) {
            const texto = motivo.getValue();
            if (!texto) {
              motivo.setError('Informe o motivo do cancelamento');
              return;
            }
            corpo.motivo_cancelamento = texto;
          }

          enviando = true;
          try {
            await updateSituacaoPedido(pedido.id, corpo);
            showSuccess('Situação atualizada');
            close();
            if (onDone) onDone();
          } catch (err) {
            enviando = false;
            showError(err.message || 'Erro ao atualizar a situação');
          }
        },
      },
    ],
  });
}
