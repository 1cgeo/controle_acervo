import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { getPedidoPorLocalizador } from '@modules/mapoteca/services/mapoteca-service.js';
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
 * Consulta publica de pedido, sem sessao (RN04). Rota de PLATAFORMA, registrada
 * em src/js/index.js como '#/consultar-pedido' e '#/consultar-pedido/:localizador'.
 * Valida o formato XXXX-XXXX-XXXX, busca o pedido e mostra o cartao com a
 * situacao, as datas, o cliente, o rastreio e o motivo do cancelamento.
 * Sem localizador na URL, a tela abre so com o campo de busca.
 * @param {HTMLElement} container
 * @param {{params: {localizador?: string}}} ctx
 */
export async function renderConsultarPedido(container, { params = {} } = {}) {
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
    location.hash = `/consultar-pedido/${value}`;
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
    el('div', {
      className: 'consulta-info__label',
      textContent: localizador ? 'Consultar outro localizador:' : 'Informe o localizador do pedido:',
    }),
    otherForm,
    // Saida discreta de volta para a porta de entrada. Quem cai aqui por engano,
    // ou quem e da DGEO e chegou pelo link do comprovante, nao fica sem caminho:
    // a consulta e uma rota publica, e sem isto o unico jeito de voltar e editar
    // a URL. Fica no rodape e em peso leve de proposito, porque a acao principal
    // desta tela e consultar, nao entrar.
    el('a', {
      className: 'consulta-card__voltar',
      href: '#/login',
    }, [svgIcon(ICONS.arrowBack, 14), 'Voltar para a tela de entrada']),
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
    // A data que o cliente quer ver e a do envio, e ela e a data_atendimento:
    // o pedido fecha no dia em que o material sai (51 de 52 pedidos concluidos
    // com item datado, medido na producao em 2026-07-29). Nao existe coluna
    // "data_envio" de proposito. O rotulo aqui e o do CLIENTE ("envio/
    // entrega"), e nao o interno ("atendimento"), porque quem le esta tela nao
    // fala a lingua do nosso cadastro.
    if (pedido.data_atendimento) {
      rows.push(infoRow('Data de envio/entrega', formatDate(pedido.data_atendimento)));
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
    // Pedido SEM item cadastrado nao mostra bloco nenhum (chefe, 2026-07-29).
    // O colapsavel vazio era um convite a clicar para nao achar nada, e no
    // pre-cadastramento (situacao 1) e no pedido de LAI, que nao usa folha MI,
    // essa e a situacao NORMAL, nao um cadastro pela metade.
    if (!produtos.length) return;

    const nExemplares = produtos.reduce((soma, r) => soma + (Number(r.quantidade) || 0), 0);
    const resumoItens = `O que foi pedido — ${produtos.length} carta(s) · ${nExemplares} exemplar(es)`;

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

  if (!localizador) {
    showMessage('Digite o localizador que você recebeu ao fazer o pedido.');
    otherInput.focus();
    return;
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
