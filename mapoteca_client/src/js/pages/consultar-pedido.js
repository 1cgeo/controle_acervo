import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { getPedidoPorLocalizador } from '@services/mapoteca-service.js';
import { chipSituacaoPedido } from '@components/status-chip.js';
import { formatDate } from '@utils/format.js';
import { isValidLocalizador, normalizeLocalizador } from '@utils/localizador.js';

function infoRow(label, value) {
  return el('div', { className: 'consulta-info__row' }, [
    el('span', { className: 'consulta-info__label', textContent: label }),
    value instanceof Node
      ? el('span', { className: 'consulta-info__value' }, [value])
      : el('span', { className: 'consulta-info__value', textContent: value ?? '-' }),
  ]);
}

/**
 * Public order tracking page (#/consultar/:localizador, no auth — RN04).
 * Validates the XXXX-XXXX-XXXX format, fetches the order and shows a card
 * with status chip, dates, client, tracking and cancellation reason.
 * @param {HTMLElement} container
 * @param {{params: {localizador: string}}} ctx
 */
export async function renderConsultarPedido(container, { params }) {
  const localizador = normalizeLocalizador(params.localizador);

  const resultArea = el('div');

  // Lookup another localizador
  const otherInput = el('input', {
    className: 'form-field__input',
    type: 'text',
    placeholder: 'XXXX-XXXX-XXXX',
    maxLength: '14',
    'aria-label': 'Localizador do pedido',
  });

  const otherForm = el('form', { className: 'consulta-card__form' }, [
    otherInput,
    el('button', { className: 'btn btn--primary', type: 'submit', textContent: 'Consultar' }),
  ]);

  otherForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = normalizeLocalizador(otherInput.value);
    if (!isValidLocalizador(value)) {
      showMessage('Formato inválido. Use o padrão XXXX-XXXX-XXXX (letras e números).', 'warning');
      return;
    }
    location.hash = `/consultar/${value}`;
  });

  const card = el('div', { className: 'consulta-card' }, [
    el('div', { className: 'consulta-card__header' }, [
      el('div', {}, [
        el('div', { className: 'consulta-card__title', textContent: 'Acompanhamento de Pedido' }),
        el('div', { className: 'consulta-card__localizador', textContent: localizador }),
      ]),
      svgIcon(ICONS.localShipping, 32),
    ]),
    resultArea,
    el('div', { className: 'consulta-info__label', textContent: 'Consultar outro localizador:' }),
    otherForm,
  ]);

  const page = el('div', { className: 'consulta-page' }, [
    el('div', { className: 'login-page__background' }),
    card,
  ]);
  container.appendChild(page);

  function showMessage(text, type = 'info') {
    clearChildren(resultArea);
    resultArea.appendChild(el('div', { className: 'consulta-card__message' }, [
      svgIcon(type === 'warning' ? ICONS.warning : ICONS.info, 20),
      el('p', { textContent: text, style: { marginTop: '8px' } }),
    ]));
  }

  function showPedido(pedido) {
    clearChildren(resultArea);

    const rows = [
      infoRow('Situação', chipSituacaoPedido(pedido.situacao_pedido_id, pedido.situacao_pedido_nome)),
      infoRow('Data do pedido', formatDate(pedido.data_pedido)),
      infoRow('Cliente', pedido.cliente_nome),
      infoRow('Prazo', formatDate(pedido.prazo)),
    ];

    if (pedido.localizador_envio) {
      rows.push(infoRow('Rastreio do envio', pedido.localizador_envio));
    }
    if (pedido.observacao_envio) {
      rows.push(infoRow('Observação de envio', pedido.observacao_envio));
    }
    if (pedido.motivo_cancelamento) {
      rows.push(infoRow('Motivo do cancelamento', pedido.motivo_cancelamento));
    }

    resultArea.appendChild(el('div', { className: 'consulta-info' }, rows));
  }

  if (!isValidLocalizador(localizador)) {
    showMessage('Localizador em formato inválido. Use o padrão XXXX-XXXX-XXXX (letras e números).', 'warning');
    return;
  }

  showMessage('Consultando pedido...');

  try {
    const pedido = await getPedidoPorLocalizador(localizador);
    showPedido(pedido);
  } catch (err) {
    showMessage(err.message || 'Pedido não encontrado.', 'warning');
  }
}
