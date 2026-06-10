import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createSelectField,
  createTextareaField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { buscarProdutos, getProdutoDetalhado, getTiposProduto, getTiposEscala } from '@services/acervo-service.js';
import { getDominioTipoMidia, getDominioFormaEntrega } from '@services/mapoteca-service.js';
import { formatDate } from '@utils/format.js';
import { showError, showWarning } from '@utils/toast.js';

/**
 * Shared dialog for adding/editing an order item: catalog search in the
 * acervo (RN08 — every item references acervo.versao), version picker and
 * the produto_pedido fields. Used by the wizard (step 3) and by the order
 * details page (add/edit item).
 */

const RN08_MESSAGE =
  'Produto não encontrado no acervo. Cadastre o produto no acervo (plugin QGIS) ' +
  'antes de criar o pedido — a mapoteca só entrega produtos do catálogo.';

const PAGE_LIMIT = 5;

/**
 * Open the item dialog.
 * @param {Object} options
 * @param {Object|null} [options.item] - existing item for edit mode (flat object
 *   with uuid_versao, produto_id, produto_nome, mi, inom, escala, versao and
 *   the produto_pedido fields)
 * @param {string} [options.title]
 * @param {string} [options.submitLabel]
 * @param {(result:{payload:Object, display:Object})=>Promise<void>|void} options.onSubmit
 *   - called on submit; when it throws, the dialog stays open and the error
 *     message is shown verbatim in a toast
 */
export async function openProdutoPedidoDialog({ item = null, title, submitLabel, onSubmit }) {
  let tiposMidia, formasEntrega, tiposProduto, tiposEscala;
  try {
    [tiposMidia, formasEntrega, tiposProduto, tiposEscala] = await Promise.all([
      getDominioTipoMidia(),
      getDominioFormaEntrega(),
      getTiposProduto(),
      getTiposEscala(),
    ]);
  } catch (err) {
    showError(err.message || 'Erro ao carregar os domínios');
    return;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let produtoSelecionado = null; // { id, nome, mi, inom, escala, versoes }
  let currentPage = 1;

  // ---------------------------------------------------------------------------
  // Catalog search section
  // ---------------------------------------------------------------------------
  const termoField = createTextField({
    label: 'Termo de busca',
    placeholder: 'Nome, MI ou INOM',
  });
  const tipoProdutoField = createSelectField({
    label: 'Tipo de produto',
    options: tiposProduto.map(t => ({ value: t.code, label: t.nome })),
    placeholder: 'Todos',
  });
  const tipoEscalaField = createSelectField({
    label: 'Escala',
    options: tiposEscala.map(t => ({ value: t.code, label: t.nome })),
    placeholder: 'Todas',
  });

  const buscarBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => search(1),
  }, [svgIcon(ICONS.search, 16), 'Buscar no catálogo']);

  termoField.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      search(1);
    }
  });

  const resultsArea = el('div');

  termoField.element.classList.add('form-grid__full');
  const searchSection = el('div', {}, [
    el('div', { className: 'form-grid' }, [
      termoField.element,
      tipoProdutoField.element,
      tipoEscalaField.element,
    ]),
    el('div', { className: 'flex gap-sm', style: { marginBottom: 'var(--space-md)' } }, [buscarBtn]),
    resultsArea,
  ]);

  // ---------------------------------------------------------------------------
  // Selected product section (summary + version select)
  // ---------------------------------------------------------------------------
  const versaoField = createSelectField({
    label: 'Versão',
    required: true,
    options: [],
    placeholder: 'Selecione a versão...',
  });

  const selectedInfo = el('div', {
    className: 'detail-card',
    style: { marginBottom: 'var(--space-md)' },
  });
  const selectedSection = el('div', { className: 'hidden' }, [selectedInfo, versaoField.element]);

  function showSearch() {
    produtoSelecionado = null;
    versaoField.setOptions([]);
    versaoField.setError(null);
    selectedSection.classList.add('hidden');
    searchSection.classList.remove('hidden');
  }

  function showSelected() {
    searchSection.classList.add('hidden');
    selectedSection.classList.remove('hidden');
  }

  function infoRow(label, value) {
    return el('div', { className: 'detail-card__row' }, [
      el('span', { className: 'detail-card__label', textContent: label }),
      el('span', { className: 'detail-card__value', textContent: value ?? '-' }),
    ]);
  }

  function renderSelectedInfo() {
    clearChildren(selectedInfo);
    selectedInfo.appendChild(el('div', { className: 'detail-card__title', textContent: 'Produto selecionado' }));
    selectedInfo.appendChild(infoRow('Nome', produtoSelecionado.nome));
    selectedInfo.appendChild(infoRow('MI', produtoSelecionado.mi));
    selectedInfo.appendChild(infoRow('INOM', produtoSelecionado.inom));
    selectedInfo.appendChild(infoRow('Escala', produtoSelecionado.escala));
    selectedInfo.appendChild(el('button', {
      className: 'btn btn--text btn--sm',
      type: 'button',
      onClick: showSearch,
    }, [svgIcon(ICONS.search, 14), 'Trocar produto']));
  }

  function fillVersoes(versoes) {
    versaoField.setOptions(versoes.map(v => ({
      value: v.uuid_versao,
      label: `${v.versao}${v.nome_versao ? ` — ${v.nome_versao}` : ''} (edição: ${formatDate(v.versao_data_edicao)})`,
    })));
  }

  async function selectProduto(produto) {
    let detalhado;
    try {
      detalhado = await getProdutoDetalhado(produto.id);
    } catch (err) {
      showError(err.message || 'Erro ao carregar o produto');
      return;
    }
    const versoes = detalhado.versoes || [];
    if (!versoes.length) {
      showWarning('Este produto não possui versões cadastradas no acervo.');
      return;
    }
    produtoSelecionado = {
      id: detalhado.id,
      nome: detalhado.nome,
      mi: detalhado.mi,
      inom: detalhado.inom,
      escala: detalhado.escala,
      versoes,
    };
    fillVersoes(versoes);
    if (versoes.length === 1) {
      versaoField.setValue(versoes[0].uuid_versao);
    }
    versaoField.setError(null);
    renderSelectedInfo();
    showSelected();
  }

  // ---------------------------------------------------------------------------
  // Search results (server-side pagination)
  // ---------------------------------------------------------------------------
  function paginationRow(result) {
    const start = (currentPage - 1) * PAGE_LIMIT + 1;
    const end = Math.min(currentPage * PAGE_LIMIT, result.total);

    const prevBtn = el('button', {
      className: 'pagination__btn',
      type: 'button',
      'aria-label': 'Página anterior',
      onClick: () => search(currentPage - 1),
    }, [svgIcon(ICONS.chevronLeft, 18)]);
    prevBtn.disabled = currentPage <= 1;

    const nextBtn = el('button', {
      className: 'pagination__btn',
      type: 'button',
      'aria-label': 'Próxima página',
      onClick: () => search(currentPage + 1),
    }, [svgIcon(ICONS.chevronRight, 18)]);
    nextBtn.disabled = currentPage * PAGE_LIMIT >= result.total;

    return el('div', { className: 'pagination' }, [
      el('div', { className: 'pagination__info' }, [
        el('span', { textContent: `${start}-${end} de ${result.total}` }),
      ]),
      el('div', { className: 'pagination__controls' }, [prevBtn, nextBtn]),
    ]);
  }

  function renderResults(result) {
    clearChildren(resultsArea);

    if (!result.dados.length) {
      resultsArea.appendChild(el('div', { className: 'data-table__empty' }, [
        el('p', { textContent: RN08_MESSAGE }),
      ]));
      return;
    }

    const header = el('thead', {}, [
      el('tr', {}, ['Nome', 'MI', 'INOM', 'Escala', 'Tipo', 'Versões', ''].map(h =>
        el('th', { textContent: h })
      )),
    ]);

    const body = el('tbody', {}, result.dados.map(p => el('tr', {}, [
      el('td', { textContent: p.nome || '-' }),
      el('td', { textContent: p.mi || '-' }),
      el('td', { textContent: p.inom || '-' }),
      el('td', { textContent: p.escala || '-' }),
      el('td', { textContent: p.tipo_produto || '-' }),
      el('td', { textContent: String(p.num_versoes ?? '-') }),
      el('td', { className: 'data-table__actions-cell' }, [
        el('button', {
          className: 'btn btn--secondary btn--sm',
          type: 'button',
          onClick: () => selectProduto(p),
        }, 'Selecionar'),
      ]),
    ])));

    resultsArea.appendChild(el('div', { className: 'data-table-wrapper' }, [
      el('div', { className: 'data-table-scroll' }, [
        el('table', { className: 'data-table' }, [header, body]),
      ]),
      paginationRow(result),
    ]));
  }

  async function search(page) {
    const filtros = {
      termo: termoField.getValue() || undefined,
      tipo_produto_id: tipoProdutoField.getValue() || undefined,
      tipo_escala_id: tipoEscalaField.getValue() || undefined,
      page,
      limit: PAGE_LIMIT,
    };

    clearChildren(resultsArea);
    resultsArea.appendChild(el('div', { className: 'data-table__empty', textContent: 'Buscando produtos...' }));

    let result;
    try {
      result = await buscarProdutos(filtros);
    } catch (err) {
      clearChildren(resultsArea);
      showError(err.message || 'Erro ao buscar produtos no acervo');
      return;
    }
    currentPage = page;
    renderResults(result);
  }

  // ---------------------------------------------------------------------------
  // Item fields
  // ---------------------------------------------------------------------------
  const midiaOptions = tiposMidia.map(t => ({ value: t.code, label: t.nome }));
  const entregaOptions = formasEntrega.map(f => ({ value: f.code, label: f.nome }));

  const midiaField = createSelectField({
    label: 'Tipo de mídia',
    required: true,
    options: midiaOptions,
    value: item ? item.tipo_midia_id : undefined,
  });
  const quantidadeField = createNumberField({
    label: 'Quantidade',
    required: true,
    min: 1,
    value: item ? item.quantidade : 1,
  });
  const qtdFornecidaField = createNumberField({
    label: 'Quantidade fornecida',
    min: 0,
    value: item && item.quantidade_fornecida != null ? item.quantidade_fornecida : undefined,
    helpText: 'Quantidade efetivamente entregue',
  });
  const midiaFornecidaField = createSelectField({
    label: 'Mídia fornecida',
    options: midiaOptions,
    value: item && item.tipo_midia_fornecida_id != null ? item.tipo_midia_fornecida_id : undefined,
    placeholder: 'Não informada',
  });
  const formaEntregaField = createSelectField({
    label: 'Forma de entrega',
    options: entregaOptions,
    value: item && item.forma_entrega_id != null ? item.forma_entrega_id : undefined,
    placeholder: 'Não informada',
  });
  const dataEntregaField = createDateField({
    label: 'Data de entrega',
    value: item && item.data_entrega ? String(item.data_entrega).slice(0, 10) : '',
  });
  const producaoField = createCheckboxField({
    label: 'Produção específica (impressão sob demanda)',
    checked: Boolean(item && item.producao_especifica),
  });
  const observacaoField = createTextareaField({
    label: 'Observação',
    value: (item && item.observacao) || '',
    rows: 2,
  });

  producaoField.element.classList.add('form-grid__full');
  observacaoField.element.classList.add('form-grid__full');

  const itemSection = el('div', { style: { marginTop: 'var(--space-md)' } }, [
    el('div', { className: 'detail-card__title', textContent: 'Dados do item' }),
    el('div', { className: 'form-grid' }, [
      midiaField.element,
      quantidadeField.element,
      qtdFornecidaField.element,
      midiaFornecidaField.element,
      formaEntregaField.element,
      dataEntregaField.element,
      producaoField.element,
      observacaoField.element,
    ]),
  ]);

  const content = el('div', {}, [
    el('div', { className: 'detail-card__title', textContent: 'Produto do acervo' }),
    searchSection,
    selectedSection,
    itemSection,
  ]);

  // Edit mode: pre-select the current product/version and load the other
  // versions in background so the user can switch.
  if (item) {
    produtoSelecionado = {
      id: item.produto_id,
      nome: item.produto_nome,
      mi: item.mi,
      inom: item.inom,
      escala: item.escala,
      versoes: [],
    };
    versaoField.setOptions([{ value: item.uuid_versao, label: item.versao || 'Versão atual' }]);
    versaoField.setValue(item.uuid_versao);
    renderSelectedInfo();
    showSelected();

    if (item.produto_id) {
      getProdutoDetalhado(item.produto_id)
        .then(detalhado => {
          if (!produtoSelecionado || produtoSelecionado.id !== item.produto_id) return;
          produtoSelecionado.versoes = detalhado.versoes || [];
          if (produtoSelecionado.versoes.length) {
            fillVersoes(produtoSelecionado.versoes);
            if (versaoField.getValue() === null) versaoField.setValue(item.uuid_versao);
          }
        })
        .catch(() => { /* keeps the current version option */ });
    }
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  let submitting = false;

  openModal({
    title: title || (item ? 'Editar item do pedido' : 'Adicionar produto ao pedido'),
    content,
    width: '860px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: submitLabel || (item ? 'Salvar' : 'Adicionar'),
        variant: 'primary',
        onClick: async ({ close }) => {
          if (submitting) return;

          versaoField.setError(null);
          midiaField.setError(null);
          quantidadeField.setError(null);
          qtdFornecidaField.setError(null);

          let ok = true;
          const uuidVersao = versaoField.getValue();
          if (!produtoSelecionado || !uuidVersao) {
            versaoField.setError('Selecione o produto e a versão no catálogo do acervo');
            showWarning('Selecione um produto do catálogo do acervo e a versão desejada.');
            ok = false;
          }
          if (midiaField.getValue() === null) {
            midiaField.setError('Campo obrigatório');
            ok = false;
          }
          const quantidade = quantidadeField.getValue();
          if (quantidade === null || quantidade < 1) {
            quantidadeField.setError('Informe uma quantidade maior que zero');
            ok = false;
          }
          const qtdFornecida = qtdFornecidaField.getValue();
          if (qtdFornecida !== null && qtdFornecida < 0) {
            qtdFornecidaField.setError('A quantidade fornecida não pode ser negativa');
            ok = false;
          }
          if (!ok) return;

          const payload = {
            uuid_versao: uuidVersao,
            quantidade,
            quantidade_fornecida: qtdFornecida,
            tipo_midia_id: midiaField.getValue(),
            tipo_midia_fornecida_id: midiaFornecidaField.getValue(),
            forma_entrega_id: formaEntregaField.getValue(),
            data_entrega: dataEntregaField.getValue(),
            observacao: observacaoField.getValue() || null,
            producao_especifica: producaoField.getValue(),
          };

          const versaoSel = produtoSelecionado.versoes.find(v => v.uuid_versao === uuidVersao);
          const tipoMidiaSel = tiposMidia.find(t => t.code === payload.tipo_midia_id);
          const display = {
            produto_id: produtoSelecionado.id,
            produto_nome: produtoSelecionado.nome,
            mi: produtoSelecionado.mi,
            inom: produtoSelecionado.inom,
            escala: produtoSelecionado.escala,
            versao: versaoSel ? versaoSel.versao : ((item && item.versao) || '-'),
            tipo_midia_nome: tipoMidiaSel ? tipoMidiaSel.nome : '-',
          };

          submitting = true;
          try {
            await onSubmit({ payload, display });
            close();
          } catch (err) {
            submitting = false;
            showError(err.message || 'Erro ao salvar o item do pedido');
          }
        },
      },
    ],
  });
}
