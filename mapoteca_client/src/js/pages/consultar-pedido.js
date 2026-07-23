import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { getPedidoPorLocalizador } from '@services/mapoteca-service.js';
import { chipSituacaoPedido } from '@components/status-chip.js';
import { formatDate } from '@utils/format.js';
import { isValidLocalizador, normalizeLocalizador } from '@utils/localizador.js';
import { randomBackground } from '@utils/backgrounds.js';

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
    el('div', {
      className: 'login-page__background',
      style: { backgroundImage: `url(${randomBackground()})` },
    }),
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

    // Resumo + informações do pedido (sempre visíveis, incluindo a observação)
    const rows = [
      infoRow('Situação', chipSituacaoPedido(pedido.situacao_pedido_id, pedido.situacao_pedido_nome)),
      infoRow('Cliente', pedido.cliente_nome),
      infoRow('Data do pedido', formatDate(pedido.data_pedido)),
      infoRow('Prazo', formatDate(pedido.prazo)),
    ];
    if (pedido.observacao) {
      rows.push(infoRow('Observação', pedido.observacao));
    }
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

    // "O que foi pedido" (os itens) é o bloco colapsável
    showItens(pedido.produtos || []);
  }

  function itemMeta(label, value) {
    if (value == null || value === '') return null;
    return el('span', { className: 'consulta-item__meta' }, [
      el('span', { className: 'consulta-item__meta-label', textContent: `${label}: ` }),
      el('span', { className: 'consulta-item__meta-value', textContent: String(value) }),
    ]);
  }

  function showItens(produtos) {
    const nExemplares = produtos.reduce((soma, r) => soma + (Number(r.quantidade) || 0), 0);
    const resumoItens = produtos.length
      ? `O que foi pedido — ${produtos.length} carta(s) · ${nExemplares} exemplar(es)`
      : 'O que foi pedido';

    const bloco = el('details', {
      className: 'consulta-collapse',
      style: { marginTop: 'var(--space-md)' },
    }, [
      el('summary', {
        className: 'consulta-collapse__summary consulta-info__label',
        textContent: resumoItens,
        style: { cursor: 'pointer', padding: 'var(--space-sm) 0' },
      }),
    ]);
    resultArea.appendChild(bloco);

    if (!produtos.length) {
      bloco.appendChild(el('div', { className: 'consulta-card__message' }, [
        el('p', { textContent: 'Nenhum item registrado para este pedido.' }),
      ]));
      return;
    }

    const itens = produtos.map((p) => {
      const titulo = p.produto_nome || p.inom || p.mi || 'Produto';
      const meta = [
        itemMeta('Escala', p.escala),
        itemMeta('Tipo', p.tipo_produto_nome),
        itemMeta('MI', p.mi),
        itemMeta('INOM', p.inom),
        itemMeta('Versão', p.versao),
        itemMeta('Edição', p.data_edicao ? formatDate(p.data_edicao) : null),
        itemMeta('Quantidade', p.quantidade),
        itemMeta('Mídia', p.tipo_midia_nome),
        itemMeta('Entrega', p.forma_entrega_nome),
      ].filter(Boolean);

      const children = [
        el('div', { className: 'consulta-item__title' }, [
          svgIcon(ICONS.description, 18),
          el('span', { textContent: titulo }),
        ]),
        el('div', { className: 'consulta-item__metas' }, meta),
      ];

      if (p.observacao) {
        children.push(el('div', { className: 'consulta-item__obs', textContent: p.observacao }));
      }

      return el('div', { className: 'consulta-item' }, children);
    });

    bloco.appendChild(el('div', { className: 'consulta-itens' }, itens));
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
