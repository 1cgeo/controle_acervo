import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createWizardStepper } from '@components/wizard-stepper.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chipSituacaoPedido } from '@components/status-chip.js';
import {
  getClientes,
  getDominioSituacaoPedido,
  getDominioCanalRecebimento,
  createPedido,
  createProdutoPedido,
} from '@services/mapoteca-service.js';
import { formatDate } from '@utils/format.js';
import { showSuccess, showError, showInfo, showWarning } from '@utils/toast.js';
import {
  createPedidoFormFields,
  SITUACAO_PEDIDO_EM_ANDAMENTO,
  TIPO_CLIENTE_LAI,
} from './pedido-form.js';
import { openProdutoPedidoDialog } from './dialog-produto.js';

const STEPS = ['Básico', 'Adicional', 'Produtos', 'Confirmação'];

function infoRow(label, value) {
  return el('div', { className: 'detail-card__row' }, [
    el('span', { className: 'detail-card__label', textContent: label }),
    value instanceof Node
      ? el('span', { className: 'detail-card__value' }, [value])
      : el('span', { className: 'detail-card__value', textContent: value || '-' }),
  ]);
}

/** Static (read-only) summary table of the items to be created. */
function buildItensSummaryTable(itens) {
  if (!itens.length) {
    return el('div', {
      className: 'data-table__empty',
      textContent: 'Nenhum produto adicionado — o pedido será criado sem itens.',
    });
  }

  const header = el('thead', {}, [
    el('tr', {}, ['Produto', 'MI', 'Versão', 'Mídia', 'Qtd.'].map(h => el('th', { textContent: h }))),
  ]);
  const body = el('tbody', {}, itens.map(item => el('tr', {}, [
    el('td', { textContent: item.display.produto_nome || '-' }),
    el('td', { textContent: item.display.mi || '-' }),
    el('td', { textContent: item.display.versao || '-' }),
    el('td', { textContent: item.display.tipo_midia_nome || '-' }),
    el('td', { textContent: String(item.payload.quantidade) }),
  ])));

  return el('div', { className: 'data-table-wrapper' }, [
    el('div', { className: 'data-table-scroll' }, [
      el('table', { className: 'data-table' }, [header, body]),
    ]),
  ]);
}

/**
 * Novo pedido — 4-step wizard (#/pedidos/novo): básico, adicional, produtos
 * (catalog search, RN08) and confirmação (createPedido + createProdutoPedido
 * per item, showing the generated localizador).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderPedidoWizard(container, _ctx) {
  let disposed = false;

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  root.appendChild(el('div', { className: 'page__header' }, [
    el('div', {}, [
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => { location.hash = '/pedidos'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Pedidos']),
      el('h1', { className: 'page__title', textContent: 'Novo pedido' }),
    ]),
  ]));

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------
  let clientes, situacoes, canais;
  try {
    [clientes, situacoes, canais] = await Promise.all([
      getClientes(), getDominioSituacaoPedido(), getDominioCanalRecebimento(),
    ]);
  } catch (err) {
    if (disposed) return;
    showError(err.message || 'Erro ao carregar os dados do formulário');
    root.appendChild(el('div', {
      className: 'data-table__empty',
      textContent: err.message || 'Erro ao carregar os dados do formulário',
    }));
    return () => { disposed = true; };
  }
  if (disposed) return () => {};

  const form = createPedidoFormFields({ clientes, situacoes, canais });
  const itens = []; // each: { payload, display }

  // ---------------------------------------------------------------------------
  // Step 1 — Básico (with the LAI shortcut, RN06)
  // ---------------------------------------------------------------------------
  const laiBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => {
      form.fields.situacao_pedido_id.setValue(SITUACAO_PEDIDO_EM_ANDAMENTO);
      const clienteLai = clientes.find(c => c.tipo_cliente_id === TIPO_CLIENTE_LAI);
      if (clienteLai) {
        form.fields.cliente_id.setValue(clienteLai.id);
        showInfo(`Pedido LAI: situação "Em andamento" e cliente "${clienteLai.nome}" pré-selecionados.`);
      } else {
        showWarning('Nenhum cliente do tipo LAI cadastrado. Situação pré-selecionada; selecione ou cadastre o cliente manualmente.');
      }
    },
  }, [svgIcon(ICONS.add, 14), 'Novo pedido LAI']);

  // Atalho para pedido de CIVIL (LAI/órgão/empresa/pessoa): pré-seleciona
  // "Em andamento" e lembra que o passo Produtos é opcional (civil entrega
  // imagem por área, não folha MI do acervo). Os campos civis ficam no passo
  // Adicional (canal, município, nº de imagens).
  const civilBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => {
      form.fields.situacao_pedido_id.setValue(SITUACAO_PEDIDO_EM_ANDAMENTO);
      showInfo('Pedido de civil: selecione um cliente civil (órgão, empresa, pessoa ou LAI), preencha o canal/município/nº de imagens em "Adicional". O passo Produtos é opcional.');
    },
  }, [svgIcon(ICONS.add, 14), 'Novo pedido de Civil']);

  const stepBasico = el('div', {}, [
    el('div', { className: 'flex flex-between gap-sm', style: { marginBottom: 'var(--space-md)' } }, [
      el('div', { className: 'detail-card__title', textContent: 'Dados básicos' }),
      el('div', { className: 'flex gap-sm' }, [laiBtn, civilBtn]),
    ]),
    form.basicoElement,
  ]);

  // ---------------------------------------------------------------------------
  // Step 2 — Adicional
  // ---------------------------------------------------------------------------
  const stepAdicional = el('div', { className: 'hidden' }, [
    el('div', {
      className: 'detail-card__title',
      style: { marginBottom: 'var(--space-md)' },
      textContent: 'Dados adicionais',
    }),
    form.adicionalElement,
    el('div', {
      className: 'detail-card__title',
      style: { margin: 'var(--space-md) 0' },
      textContent: 'Pedido de civil (opcional)',
    }),
    form.civilElement,
  ]);

  // ---------------------------------------------------------------------------
  // Step 3 — Produtos
  // ---------------------------------------------------------------------------
  const itensTable = createDataTable({
    columns: [
      { key: 'produto', label: 'Produto', render: (row) => row.display.produto_nome || '-' },
      { key: 'mi', label: 'MI', render: (row) => row.display.mi || '-' },
      { key: 'versao', label: 'Versão', render: (row) => row.display.versao || '-' },
      { key: 'midia', label: 'Mídia', render: (row) => row.display.tipo_midia_nome || '-' },
      { key: 'quantidade', label: 'Qtd.', render: (row) => String(row.payload.quantidade) },
    ],
    rows: [],
    pageSize: 10,
    emptyMessage: 'Nenhum produto adicionado ao pedido',
    actions: [
      {
        icon: ICONS.edit,
        title: 'Editar item',
        onClick: (row) => editarItem(row),
      },
      {
        icon: ICONS.delete,
        title: 'Remover item',
        variant: 'danger',
        onClick: (row) => removerItem(row),
      },
    ],
  });

  function refreshItens() {
    itensTable.update({ rows: [...itens], loading: false });
  }

  function adicionarItem() {
    openProdutoPedidoDialog({
      onSubmit: (novoItem) => {
        itens.push(novoItem);
        refreshItens();
        showSuccess('Produto adicionado à lista do pedido');
      },
    });
  }

  function editarItem(row) {
    const idx = itens.indexOf(row);
    if (idx === -1) return;
    openProdutoPedidoDialog({
      item: { ...row.display, ...row.payload },
      onSubmit: (novoItem) => {
        itens[idx] = novoItem;
        refreshItens();
        showSuccess('Item atualizado na lista do pedido');
      },
    });
  }

  async function removerItem(row) {
    const confirmado = await confirmDialog({
      title: 'Remover item',
      message: `Remover "${row.display.produto_nome || 'item'}" da lista do pedido?`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!confirmado) return;
    const idx = itens.indexOf(row);
    if (idx === -1) return;
    itens.splice(idx, 1);
    refreshItens();
    showSuccess('Item removido da lista do pedido');
  }

  const stepProdutos = el('div', { className: 'hidden' }, [
    el('div', { className: 'flex flex-between gap-sm', style: { marginBottom: 'var(--space-md)' } }, [
      el('div', { className: 'detail-card__title', textContent: 'Produtos do pedido' }),
      el('button', {
        className: 'btn btn--primary btn--sm',
        type: 'button',
        onClick: adicionarItem,
      }, [svgIcon(ICONS.add, 14), 'Adicionar produto']),
    ]),
    el('p', {
      className: 'form-field__help',
      textContent: 'Todos os itens referenciam uma versão do catálogo do acervo (RN08). ' +
        'Caso o produto não exista no acervo, cadastre-o primeiro pelo plugin QGIS.',
    }),
    itensTable.element,
  ]);

  // ---------------------------------------------------------------------------
  // Step 4 — Confirmação
  // ---------------------------------------------------------------------------
  const stepConfirmacao = el('div', { className: 'hidden' });

  function renderConfirmacao() {
    clearChildren(stepConfirmacao);
    const valores = form.getValues();

    const cliente = clientes.find(c => c.id === valores.cliente_id);
    const situacao = situacoes.find(s => s.code === valores.situacao_pedido_id);

    const cardBasico = el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Dados básicos' }),
      infoRow('Cliente', cliente ? cliente.nome : '-'),
      infoRow('Situação', chipSituacaoPedido(valores.situacao_pedido_id, situacao ? situacao.nome : '-')),
      infoRow('Data do pedido', formatDate(valores.data_pedido)),
      infoRow('Data de atendimento', formatDate(valores.data_atendimento)),
      infoRow('Prazo', formatDate(valores.prazo)),
      infoRow('Documento (DIEx/Ofício)', valores.documento_solicitacao),
      infoRow('NUP', valores.documento_solicitacao_nup),
    ]);

    const cardAdicional = el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Dados adicionais' }),
      infoRow('Ponto de contato', valores.ponto_contato),
      infoRow('Demandante', valores.demandante),
      infoRow('OM responsável (OMDS)', valores.omds),
      infoRow('Previsto no PIT', valores.previsto_pit ? 'Sim' : 'Não'),
      infoRow('Endereço de entrega', valores.endereco_entrega),
      infoRow('Palavras-chave', valores.palavras_chave.length ? valores.palavras_chave.join(', ') : '-'),
      infoRow('Operação', valores.operacao),
      infoRow('Localizador de envio', valores.localizador_envio),
      infoRow('Observação de envio', valores.observacao_envio),
      infoRow('Observação', valores.observacao),
      infoRow('Motivo do cancelamento', valores.motivo_cancelamento),
      infoRow('Canal (civil)', (canais.find(c => c.code === valores.canal_recebimento_id) || {}).nome),
      infoRow('Município/Área (civil)', valores.municipio),
      infoRow('Nº de imagens (civil)', valores.qtd_imagens != null ? String(valores.qtd_imagens) : '-'),
    ]);

    stepConfirmacao.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
      cardBasico,
      cardAdicional,
    ]));
    stepConfirmacao.appendChild(el('div', {
      className: 'detail-card__title',
      style: { marginBottom: 'var(--space-sm)' },
      textContent: `Produtos (${itens.length})`,
    }));
    stepConfirmacao.appendChild(buildItensSummaryTable(itens));
  }

  // ---------------------------------------------------------------------------
  // Stepper + navigation
  // ---------------------------------------------------------------------------
  const panels = [stepBasico, stepAdicional, stepProdutos, stepConfirmacao];
  let activeStep = 0;
  let submitting = false;

  const stepper = createWizardStepper({
    steps: STEPS,
    active: 0,
    onStepClick: (index) => goTo(index),
  });

  const btnVoltar = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => goTo(activeStep - 1),
  }, 'Voltar');

  const btnAvancar = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: avancar,
  }, 'Avançar');

  const btnConfirmar = el('button', {
    className: 'btn btn--primary hidden',
    type: 'button',
    onClick: confirmar,
  }, [svgIcon(ICONS.check, 16), 'Confirmar pedido']);

  const nav = el('div', { className: 'wizard__nav' }, [
    btnVoltar,
    el('div', { className: 'wizard__nav-right' }, [btnAvancar, btnConfirmar]),
  ]);

  const content = el('div', { className: 'wizard__content' }, panels);

  root.appendChild(stepper.element);
  root.appendChild(content);
  root.appendChild(nav);

  function goTo(index) {
    if (submitting) return;
    activeStep = Math.max(0, Math.min(index, STEPS.length - 1));
    panels.forEach((panel, i) => panel.classList.toggle('hidden', i !== activeStep));
    stepper.setActive(activeStep);
    btnVoltar.disabled = activeStep === 0;
    btnAvancar.classList.toggle('hidden', activeStep === STEPS.length - 1);
    btnConfirmar.classList.toggle('hidden', activeStep !== STEPS.length - 1);
    if (activeStep === STEPS.length - 1) renderConfirmacao();
  }

  function avancar() {
    if (activeStep === 0 && !form.validateBasico()) return;
    if (activeStep === 1 && !form.validateAdicional()) return;
    goTo(activeStep + 1);
  }

  function renderSucesso(criado, falhas) {
    clearChildren(content);
    nav.classList.add('hidden');

    content.appendChild(el('div', { className: 'text-center' }, [
      el('h2', {
        className: 'dashboard-section__title',
        style: { marginBottom: 'var(--space-md)' },
        textContent: 'Pedido criado com sucesso',
      }),
      el('div', { className: 'summary-card', style: { marginBottom: 'var(--space-md)' } }, [
        el('div', { className: 'summary-card__value', textContent: criado.localizador_pedido }),
        el('div', { className: 'summary-card__label', textContent: `Localizador do pedido #${criado.id}` }),
      ]),
      falhas.length
        ? el('p', {
            className: 'form-field__error',
            textContent: `${falhas.length} item(ns) não puderam ser adicionados — verifique no detalhe do pedido.`,
          })
        : null,
      el('div', { className: 'flex flex-center gap-sm' }, [
        el('button', {
          className: 'btn btn--primary',
          type: 'button',
          onClick: () => { location.hash = `/pedidos/${criado.id}`; },
        }, [svgIcon(ICONS.visibility, 16), 'Ver pedido']),
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => { location.hash = '/pedidos'; },
        }, 'Voltar para pedidos'),
      ]),
    ]));
  }

  async function confirmar() {
    if (submitting) return;
    if (!form.validateBasico()) {
      showWarning('Há erros nos dados básicos do pedido. Revise a etapa 1.');
      goTo(0);
      return;
    }
    if (!form.validateAdicional()) {
      showWarning('Há erros nos dados adicionais do pedido. Revise a etapa 2.');
      goTo(1);
      return;
    }

    submitting = true;
    btnConfirmar.disabled = true;
    btnVoltar.disabled = true;

    let criado;
    try {
      criado = await createPedido(form.getValues());
    } catch (err) {
      showError(err.message || 'Erro ao criar o pedido');
      submitting = false;
      btnConfirmar.disabled = false;
      btnVoltar.disabled = false;
      return;
    }

    const falhas = [];
    for (const item of itens) {
      try {
        await createProdutoPedido({ ...item.payload, pedido_id: criado.id });
      } catch (err) {
        falhas.push(`${item.display.produto_nome || 'Item'}: ${err.message}`);
      }
    }
    if (disposed) return;

    showSuccess(`Pedido criado com sucesso. Localizador: ${criado.localizador_pedido}`);
    falhas.forEach(falha => showError(`Erro ao adicionar item — ${falha}`));
    renderSucesso(criado, falhas);
  }

  goTo(0);

  return () => {
    disposed = true;
    itensTable._cleanup();
  };
}
