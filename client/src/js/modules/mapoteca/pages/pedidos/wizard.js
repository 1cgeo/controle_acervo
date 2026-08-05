import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createWizardStepper } from '@components/wizard-stepper.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chipSituacaoPedido } from '@components/status-chip.js';
import {
  getClientes,
  getDominioSituacaoPedido,
  getDominioCanalRecebimento,
  getDominioFormaEntrega,
  createPedido,
  createProdutoPedido,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { formatBoolean, formatDate } from '@utils/format.js';
import { showSuccess, showError, showWarning } from '@utils/toast.js';
import {
  createPedidoFormFields,
  aplicarModoPedido,
  filtrarClientesPorModo,
  SITUACAO_PEDIDO_EM_ANDAMENTO,
  TIPO_CLIENTE_LAI,
} from './pedido-form.js';
import { openProdutoPedidoDialog } from './dialog-produto.js';
import { openClienteDialog } from '../clientes/dialog-cliente.js';
import { getMetasPit, rotuloMetaPit } from '@services/plataforma-service.js';

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
      textContent: 'Nenhum produto adicionado. O pedido será criado sem itens.',
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

/** Table of the items the server refused, with the error message of each one. */
function buildFalhasTable(falhas) {
  const header = el('thead', {}, [
    el('tr', {}, ['Produto', 'MI', 'Qtd.', 'Erro'].map(h => el('th', { textContent: h }))),
  ]);
  const body = el('tbody', {}, falhas.map(({ item, erro }) => el('tr', {}, [
    el('td', { textContent: item.display.produto_nome || '-' }),
    el('td', { textContent: item.display.mi || '-' }),
    el('td', { textContent: String(item.payload.quantidade) }),
    el('td', { textContent: erro }),
  ])));

  return el('div', { className: 'data-table-wrapper' }, [
    el('div', { className: 'data-table-scroll' }, [
      el('table', { className: 'data-table' }, [header, body]),
    ]),
  ]);
}

/**
 * Novo pedido, 4-step wizard (#/pedidos/novo): básico, adicional, produtos
 * (catalog search) and confirmação (createPedido, then one createProdutoPedido
 * per item, with a progress counter and a retry of the failed items only).
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
        onClick: () => { location.hash = '/mapoteca/pedidos'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Pedidos']),
      el('h1', { className: 'page__title', textContent: 'Novo pedido' }),
    ]),
  ]));

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------
  let clientes, situacoes, canais, formasEntrega, metas;
  let modoAtual = 'militar';
  try {
    // As metas sao as do ANO CORRENTE: o pedido novo nasce com data de hoje, e
    // um pedido cumpre meta do proprio exercicio. O PIT e reescrito todo ano.
    [clientes, situacoes, canais, formasEntrega, metas] = await Promise.all([
      getClientes(), getDominioSituacaoPedido(), getDominioCanalRecebimento(),
      getDominioFormaEntrega(), getMetasPit(new Date().getFullYear()),
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

  const form = createPedidoFormFields({ clientes, situacoes, canais, formasEntrega, metas });
  const itens = []; // each: { payload, display }

  // ---------------------------------------------------------------------------
  // Step 1, Básico (with the LAI shortcut, RN06)
  // ---------------------------------------------------------------------------
  // Escolha inicial: Militar ou Civil. Define os clientes ofertados e quais
  // campos aparecem (civil = LAI/órgão/empresa/pessoa, com canal/município/nº
  // imagens; militar = OM, com produtos do acervo).
  const btnMil = el('button', {
    className: 'btn btn--secondary', type: 'button', onClick: () => setModo('militar'),
  }, 'Pedido Militar');
  const btnCiv = el('button', {
    className: 'btn btn--secondary', type: 'button', onClick: () => setModo('civil'),
  }, 'Pedido de Civil');
  const modoHint = el('div', { className: 'form-field__help' });

  // Criar um cliente sem sair do fluxo do pedido (melhora a UX do civil, onde o
  // solicitante muda a cada pedido). Após salvar, recarrega a lista, reaplica o
  // filtro do modo atual e seleciona o cliente recém-criado.
  const btnNovoCliente = el('button', {
    className: 'btn btn--secondary btn--sm', type: 'button',
    onClick: () => {
      openClienteDialog({ onSaved: async () => {
        const antes = new Set(clientes.map(c => c.id));
        try { clientes = await getClientes(); } catch { return; }
        setModo(modoAtual);
        const novo = clientes.find(c => !antes.has(c.id));
        if (novo) form.fields.cliente_id.setValue(novo.id);
      } });
    },
  }, [svgIcon(ICONS.add, 14), 'Novo cliente']);

  const stepBasico = el('div', {}, [
    el('div', { className: 'detail-card__title', style: { marginBottom: 'var(--space-sm)' }, textContent: 'Tipo de pedido' }),
    el('div', { className: 'flex gap-sm', style: { marginBottom: 'var(--space-xs)' } }, [btnMil, btnCiv]),
    modoHint,
    el('div', { className: 'flex flex-between gap-sm', style: { margin: 'var(--space-md) 0' } }, [
      el('div', { className: 'detail-card__title', textContent: 'Dados básicos' }),
      btnNovoCliente,
    ]),
    form.basicoElement,
  ]);

  // ---------------------------------------------------------------------------
  // Step 2, Adicional
  // ---------------------------------------------------------------------------
  // Seção civil (canal/município/nº imagens), visível só no modo Civil.
  const civilSection = el('div', { className: 'hidden' }, [
    el('div', {
      className: 'detail-card__title',
      style: { margin: 'var(--space-md) 0' },
      textContent: 'Dados do pedido de civil',
    }),
    form.civilElement,
  ]);

  // A etapa tinha 14 campos em fila, e o operador atravessava todos em todo
  // pedido, e a maioria deles fica vazia: endereco de entrega, previsto no PIT,
  // meta do PIT, palavras-chave e localizador de envio sao a excecao, e o motivo
  // do cancelamento so existe em pedido cancelado. Os frequentes ficam a
  // vista (demandante 157, omds 123, observacao interna 106, observacao 82,
  // forma de entrega 89, ponto de contato 80).
  //
  // NENHUM campo foi removido. Os de uso raro so mudaram de lugar, para uma
  // secao recolhida. O recurso e o elemento details do HTML, o mesmo que a
  // consulta publica do pedido ja usa: sem componente novo e sem CSS novo.
  const CAMPOS_RAROS = [
    'previsto_pit', 'meta_pit_id', 'localizador_envio', 'endereco_entrega',
    'palavras_chave', 'motivo_cancelamento',
  ];

  const secaoRaros = el('details', { style: { marginTop: 'var(--space-md)' } }, [
    el('summary', {
      className: 'detail-card__title',
      style: { cursor: 'pointer', padding: 'var(--space-sm) 0' },
      textContent: 'Campos de uso raro (PIT, entrega, palavras-chave, cancelamento)',
    }),
    el('div', { className: 'form-grid' },
      CAMPOS_RAROS.map(nome => form.fields[nome].element)),
  ]);

  const stepAdicional = el('div', { className: 'hidden' }, [
    el('div', {
      className: 'detail-card__title',
      style: { marginBottom: 'var(--space-md)' },
      textContent: 'Dados adicionais',
    }),
    form.adicionalElement,
    secaoRaros,
    civilSection,
  ]);

  // A validacao da etapa 2 marca o erro na meta do PIT e no motivo do
  // cancelamento, e os dois campos moram na secao recolhida. Sem abrir a
  // secao, o usuario veria a etapa travar sem erro nenhum na tela.
  function abrirSecaoRarosNoErro() {
    secaoRaros.open = true;
  }

  // ---------------------------------------------------------------------------
  // Step 3, Produtos
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

  // O texto dizia "RN08", codigo interno do repositorio. O operador da mapoteca
  // nao conhece esse codigo, entao a regra vai em portugues claro.
  const NOTA_PRODUTOS_MILITAR = 'Cada item do pedido aponta uma versão de produto '
    + 'do catálogo do acervo. Caso o produto não exista no acervo, cadastre-o '
    + 'primeiro pelo plugin QGIS.';

  const produtosNote = el('p', {
    className: 'form-field__help',
    textContent: NOTA_PRODUTOS_MILITAR,
  });

  const stepProdutos = el('div', { className: 'hidden' }, [
    el('div', { className: 'flex flex-between gap-sm', style: { marginBottom: 'var(--space-md)' } }, [
      el('div', { className: 'detail-card__title', textContent: 'Produtos do pedido' }),
      el('button', {
        className: 'btn btn--primary btn--sm',
        type: 'button',
        onClick: adicionarItem,
      }, [svgIcon(ICONS.add, 14), 'Adicionar produto']),
    ]),
    produtosNote,
    itensTable.element,
  ]);

  // ---------------------------------------------------------------------------
  // Step 4, Confirmação
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
      infoRow('Ponto de contato do pedido', valores.ponto_contato),
      infoRow('Demandante', valores.demandante),
      infoRow('OM responsável (OMDS)', valores.omds),
      infoRow('Previsto no PIT', formatBoolean(valores.previsto_pit)),
      infoRow('Meta do PIT', rotuloMetaPit(
        (metas || []).find(m => m.id === valores.meta_pit_id)
      ) || '-'),
      infoRow('Endereço de entrega', valores.endereco_entrega),
      infoRow('Palavras-chave', valores.palavras_chave.length ? valores.palavras_chave.join(', ') : '-'),
      infoRow('Operação', valores.operacao),
      // A forma de entrega e do PEDIDO, e nao do item. Ela tem de aparecer na
      // revisao final, senao o usuario confirma sem ver
      // como o material vai sair.
      infoRow('Forma de entrega',
        (formasEntrega.find(f => f.code === valores.forma_entrega_id) || {}).nome),
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

  // Andamento da gravacao dos itens. O pedido grande chega a 132 itens, e cada
  // item e um POST em serie. So desabilitar o botao deixa a tela parada e muda.
  // Este elemento fica FORA do content e do nav, porque a tela de sucesso limpa
  // um e esconde o outro, e a repeticao dos itens que falharam precisa dele.
  const progresso = el('p', {
    className: 'form-field__help hidden',
    style: { textAlign: 'center' },
  });

  root.appendChild(stepper.element);
  root.appendChild(content);
  root.appendChild(nav);
  root.appendChild(progresso);

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
    if (activeStep === 1 && !form.validateAdicional()) {
      abrirSecaoRarosNoErro();
      return;
    }
    goTo(activeStep + 1);
  }

  /**
   * Grava os itens no pedido que JA existe, um POST por item, com contador.
   *
   * Esta funcao NUNCA chama createPedido. O pedido ja foi criado antes dela, e
   * por isso ela serve tanto a primeira gravacao quanto a repeticao dos itens
   * que falharam, sem risco de criar um segundo pedido.
   *
   * @param {Object} criado - o pedido gravado
   * @param {Array<{payload:Object, display:Object}>} lista - itens a gravar
   * @returns {Promise<{gravados:number, falhas:Array<{item:Object, erro:string}>}>}
   */
  async function gravarItens(criado, lista) {
    const falhas = [];
    let gravados = 0;
    progresso.classList.remove('hidden');
    for (let i = 0; i < lista.length; i += 1) {
      const item = lista[i];
      progresso.textContent = `Gravando o item ${i + 1} de ${lista.length}...`;
      try {
        await createProdutoPedido({ ...item.payload, pedido_id: criado.id });
        gravados += 1;
      } catch (err) {
        falhas.push({ item, erro: err.message || 'Erro ao gravar o item' });
      }
    }
    progresso.classList.add('hidden');
    progresso.textContent = '';
    return { gravados, falhas };
  }

  /**
   * Tela final do wizard, com o resultado REAL da gravacao.
   *
   * Com item recusado ela NAO se apresenta como sucesso limpo: o titulo diz
   * quantos itens ficaram de fora, a lista dos recusados continua na tela e um
   * botao repete SO esses itens.
   *
   * @param {Object} criado - o pedido gravado
   * @param {{total:number, gravados:number, falhas:Array}} resultado
   */
  function renderSucesso(criado, resultado) {
    clearChildren(content);
    nav.classList.add('hidden');

    const { total, gravados, falhas } = resultado;
    const houveFalha = falhas.length > 0;

    const btnRepetir = el('button', {
      className: 'btn btn--primary',
      type: 'button',
      onClick: async () => {
        btnRepetir.disabled = true;
        // O pedido JA existe neste ponto. A repeticao manda de novo SO os itens
        // que falharam, sempre por createProdutoPedido. Chamar createPedido
        // aqui criaria um SEGUNDO pedido, com outro localizador.
        const novo = await gravarItens(criado, falhas.map(f => f.item));
        if (disposed) return;
        if (novo.gravados) showSuccess(`${novo.gravados} item(ns) gravado(s) na repetição`);
        renderSucesso(criado, {
          total,
          gravados: total - novo.falhas.length,
          falhas: novo.falhas,
        });
      },
    }, 'Tentar de novo os itens que falharam');

    content.appendChild(el('div', { className: 'text-center' }, [
      el('h2', {
        className: 'dashboard-section__title',
        style: { marginBottom: 'var(--space-md)' },
        textContent: houveFalha
          ? `Pedido criado, mas ${falhas.length} de ${total} itens não entraram`
          : 'Pedido criado com sucesso',
      }),
      el('div', { className: 'summary-card', style: { marginBottom: 'var(--space-md)' } }, [
        el('div', { className: 'summary-card__value', textContent: criado.localizador_pedido }),
        el('div', { className: 'summary-card__label', textContent: `Localizador do pedido #${criado.id}` }),
      ]),
      total
        ? el('p', {
            className: houveFalha ? 'form-field__error' : 'form-field__help',
            textContent: `${gravados} de ${total} itens gravados no pedido.`,
          })
        : null,
      houveFalha
        ? el('p', {
            className: 'form-field__help',
            style: { marginBottom: 'var(--space-sm)' },
            textContent: 'Estes itens ficaram de fora. O pedido já existe: o botão abaixo repete só estes itens, e não cria outro pedido.',
          })
        : null,
      houveFalha ? buildFalhasTable(falhas) : null,
      el('div', { className: 'flex flex-center gap-sm', style: { marginTop: 'var(--space-md)' } }, [
        houveFalha ? btnRepetir : null,
        el('button', {
          className: houveFalha ? 'btn btn--secondary' : 'btn btn--primary',
          type: 'button',
          onClick: () => { location.hash = `/mapoteca/pedidos/${criado.id}`; },
        }, [svgIcon(ICONS.visibility, 16), 'Ver pedido']),
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => { location.hash = '/mapoteca/pedidos'; },
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
      abrirSecaoRarosNoErro();
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

    // O pedido esta gravado. Os itens vao a seguir, um POST por item.
    const total = itens.length;
    const { falhas } = await gravarItens(criado, itens);
    if (disposed) return;
    const gravados = total - falhas.length;

    // Um toast por item falho inundaria a tela: o pedido maior tem 132 itens.
    // A lista dos recusados fica na tela de resultado, que nao some sozinha.
    if (falhas.length) {
      showError(`Pedido criado, mas só ${gravados} de ${total} itens entraram.`);
    } else {
      showSuccess(`Pedido criado com sucesso. Localizador: ${criado.localizador_pedido}`);
    }
    renderSucesso(criado, { total, gravados, falhas });
  }

  // Aplica o modo (Militar/Civil): filtra clientes, mostra/esconde campos.
  function setModo(modo) {
    modoAtual = modo;
    const civil = modo === 'civil';
    btnMil.className = `btn ${civil ? 'btn--secondary' : 'btn--primary'}`;
    btnCiv.className = `btn ${civil ? 'btn--primary' : 'btn--secondary'}`;
    modoHint.textContent = civil
      ? 'Cliente civil (LAI/órgão/empresa/pessoa). NUP ou ofício opcionais; produtos do acervo opcionais (civil entrega imagem por área).'
      : 'Cliente OM, com DIEx e produtos do catálogo do acervo.';
    const opts = filtrarClientesPorModo(clientes, modo).map(c => ({ value: c.id, label: c.nome }));
    form.fields.cliente_id.setOptions(opts);
    form.fields.cliente_id.setValue(null);
    // Quais campos aparecem em cada modo é regra compartilhada com a edição do
    // pedido (details.js). Uma regra em dois lugares diverge, então ela mora só
    // no pedido-form.js.
    aplicarModoPedido({ fields: form.fields, modo, civilElement: civilSection });
    if (civil) form.fields.situacao_pedido_id.setValue(SITUACAO_PEDIDO_EM_ANDAMENTO);
    produtosNote.textContent = civil
      ? 'Pedidos de civil geralmente NÃO têm produtos do acervo (entregam imagem por área). Deixe vazio se for o caso.'
      : NOTA_PRODUTOS_MILITAR;
  }

  setModo('militar');
  goTo(0);

  return () => {
    disposed = true;
    itensTable._cleanup();
  };
}
