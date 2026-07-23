import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chip, chipSituacaoPedido } from '@components/status-chip.js';
import {
  getPedido,
  updatePedido,
  deletePedidos,
  createProdutoPedido,
  updateProdutoPedido,
  deleteProdutosPedido,
  getImpressaoItem,
  deleteImpressoes,
  getClientes,
  getDominioSituacaoPedido,
  getAnexosPedido,
  uploadAnexoPedido,
  downloadAnexoPedido,
  deleteAnexoPedido,
} from '@services/mapoteca-service.js';
import { formatDate, formatDateTime, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createPedidoFormFields } from './pedido-form.js';
import { openProdutoPedidoDialog } from './dialog-produto.js';

function infoRow(label, value) {
  return el('div', { className: 'detail-card__row' }, [
    el('span', { className: 'detail-card__label', textContent: label }),
    value instanceof Node
      ? el('span', { className: 'detail-card__value' }, [value])
      : el('span', { className: 'detail-card__value', textContent: value || '-' }),
  ]);
}

// Domínio mapoteca.tipo_anexo_pedido (estável; espelha o seed do banco).
const TIPOS_ANEXO = [
  { code: 1, nome: 'Documento de solicitação (DIEx/Ofício)' },
  { code: 2, nome: 'Anexo do documento de solicitação' },
  { code: 3, nome: 'Comprovante de entrega/remessa' },
  { code: 4, nome: 'Outros' },
];

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Pedido details page (#/pedidos/:id): header with chips and edit/delete,
 * 4 info cards, cancellation reason, items table with add/edit/delete and
 * printing history, plus the order printing summary.
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderPedidoDetails(container, { params }) {
  const pedidoId = Number(params.id);
  let disposed = false;
  const cleanups = [];

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  function disposeCleanups() {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch { /* ignore */ }
    }
  }

  async function load() {
    disposeCleanups();
    clearChildren(root);
    root.appendChild(el('div', { className: 'data-table__empty', textContent: 'Carregando pedido...' }));

    let pedido;
    try {
      pedido = await getPedido(pedidoId);
    } catch (err) {
      if (disposed) return;
      clearChildren(root);
      showError(err.message || 'Erro ao carregar o pedido');
      root.appendChild(el('div', { className: 'data-table__empty', textContent: err.message || 'Pedido não encontrado' }));
      root.appendChild(el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => { location.hash = '/pedidos'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar para pedidos']));
      return;
    }
    if (disposed) return;

    clearChildren(root);
    renderPedido(pedido);
  }

  // ---------------------------------------------------------------------------
  // Edit / delete pedido
  // ---------------------------------------------------------------------------
  async function editarPedido(pedido) {
    let clientes, situacoes;
    try {
      [clientes, situacoes] = await Promise.all([getClientes(), getDominioSituacaoPedido()]);
    } catch (err) {
      showError(err.message || 'Erro ao carregar os dados do formulário');
      return;
    }

    const form = createPedidoFormFields({ pedido, clientes, situacoes });

    const content = el('div', {}, [
      el('div', { className: 'detail-card__title', textContent: 'Dados básicos' }),
      form.basicoElement,
      el('div', {
        className: 'detail-card__title',
        style: { marginTop: 'var(--space-md)' },
        textContent: 'Dados adicionais',
      }),
      form.adicionalElement,
    ]);

    let submitting = false;

    openModal({
      title: `Editar pedido #${pedido.id}`,
      content,
      width: '860px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (submitting) return;
            const basicoOk = form.validateBasico();
            const adicionalOk = form.validateAdicional();
            if (!basicoOk || !adicionalOk) return;

            submitting = true;
            try {
              await updatePedido({ id: pedido.id, ...form.getValues() });
              showSuccess('Pedido atualizado com sucesso');
              close();
              load();
            } catch (err) {
              submitting = false;
              showError(err.message || 'Erro ao atualizar o pedido');
            }
          },
        },
      ],
    });
  }

  async function excluirPedido(pedido) {
    const confirmado = await confirmDialog({
      title: 'Excluir pedido',
      message: `Excluir o pedido #${pedido.id} (${pedido.localizador_pedido}) e todos os seus itens? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;

    try {
      await deletePedidos([pedido.id]);
      showSuccess('Pedido excluído com sucesso');
      location.hash = '/pedidos';
    } catch (err) {
      showError(err.message || 'Erro ao excluir o pedido');
    }
  }

  // ---------------------------------------------------------------------------
  // Items (produto_pedido)
  // ---------------------------------------------------------------------------
  function adicionarItem() {
    openProdutoPedidoDialog({
      onSubmit: async ({ payload }) => {
        await createProdutoPedido({ ...payload, pedido_id: pedidoId });
        showSuccess('Item adicionado ao pedido');
        load();
      },
    });
  }

  function editarItem(row) {
    openProdutoPedidoDialog({
      item: row,
      onSubmit: async ({ payload }) => {
        await updateProdutoPedido({ ...payload, id: row.id, pedido_id: pedidoId });
        showSuccess('Item atualizado com sucesso');
        load();
      },
    });
  }

  async function excluirItem(row) {
    const confirmado = await confirmDialog({
      title: 'Excluir item',
      message: `Excluir o item "${row.produto_nome || '-'}" do pedido? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;

    try {
      await deleteProdutosPedido([row.id]);
      showSuccess('Item excluído com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o item');
    }
  }

  async function verHistoricoImpressao(row) {
    let historico;
    try {
      historico = await getImpressaoItem(row.id);
    } catch (err) {
      showError(err.message || 'Erro ao carregar o histórico de impressão');
      return;
    }

    const content = el('div');
    let registrosTable = null;
    let mutated = false;

    async function excluirRegistro(registro) {
      const confirmado = await confirmDialog({
        title: 'Excluir registro de impressão',
        message: `Excluir o registro de ${formatNumber(registro.quantidade)} cópia(s) de ${formatDateTime(registro.data_impressao)}? As quantidades impressas do item serão recalculadas.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!confirmado) return;

      try {
        await deleteImpressoes([registro.id]);
        showSuccess('Registro de impressão excluído com sucesso');
        mutated = true;
        renderHistorico(await getImpressaoItem(row.id));
      } catch (err) {
        showError(err.message || 'Erro ao excluir o registro de impressão');
      }
    }

    function renderHistorico(dados) {
      if (registrosTable) registrosTable._cleanup();

      registrosTable = createDataTable({
        columns: [
          {
            key: 'data_impressao',
            label: 'Data',
            sortable: true,
            render: (registro) => formatDateTime(registro.data_impressao),
          },
          { key: 'usuario_nome', label: 'Usuário' },
          {
            key: 'quantidade',
            label: 'Cópias',
            sortable: true,
            render: (registro) => formatNumber(registro.quantidade),
          },
          { key: 'observacao', label: 'Observação' },
        ],
        rows: dados.registros || [],
        pageSize: 5,
        emptyMessage: 'Nenhuma sessão de impressão registrada',
        actions: [
          {
            icon: ICONS.delete,
            title: 'Excluir registro',
            variant: 'danger',
            onClick: (registro) => excluirRegistro(registro),
          },
        ],
      });

      clearChildren(content);
      content.appendChild(el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
        el('div', { className: 'detail-card__title', textContent: 'Resumo' }),
        infoRow('Quantidade pedida', formatNumber(dados.quantidade)),
        infoRow('Quantidade impressa', formatNumber(dados.quantidade_impressa)),
        infoRow('Restante', formatNumber(dados.quantidade_restante)),
        infoRow('Situação', dados.impressao_concluida
          ? chip('Concluída', 'success')
          : chip('Pendente', 'warning')),
      ]));
      content.appendChild(registrosTable.element);
    }

    renderHistorico(historico);

    openModal({
      title: `Histórico de impressão — ${row.produto_nome || 'Item'}`,
      content,
      width: '720px',
      actions: [{ label: 'Fechar', variant: 'secondary', onClick: ({ close }) => close() }],
      onClose: () => {
        if (registrosTable) registrosTable._cleanup();
        if (mutated) load();
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Anexos do pedido (documento de solicitação + arquivos, guardados no banco)
  // ---------------------------------------------------------------------------
  function adicionarAnexo(onDone) {
    const fileInput = el('input', { type: 'file', className: 'form-field__input' });
    const tipoSelect = el('select', { className: 'form-field__input' },
      TIPOS_ANEXO.map((t) => el('option', { value: String(t.code), textContent: t.nome })));
    tipoSelect.value = '1';
    const descInput = el('input', { type: 'text', className: 'form-field__input', maxLength: '1000' });

    const content = el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-field' }, [
        el('label', { className: 'form-field__label', textContent: 'Arquivo' }),
        fileInput,
      ]),
      el('div', { className: 'form-field' }, [
        el('label', { className: 'form-field__label', textContent: 'Tipo do anexo' }),
        tipoSelect,
      ]),
      el('div', { className: 'form-field' }, [
        el('label', { className: 'form-field__label', textContent: 'Descrição (opcional)' }),
        descInput,
      ]),
    ]);

    let submitting = false;
    openModal({
      title: 'Anexar documento',
      content,
      width: '520px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Anexar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (submitting) return;
            const file = fileInput.files && fileInput.files[0];
            if (!file) { showError('Selecione um arquivo'); return; }
            submitting = true;
            try {
              await uploadAnexoPedido(pedidoId, file, {
                tipo_anexo_id: Number(tipoSelect.value),
                descricao: descInput.value.trim() || undefined,
              });
              showSuccess('Anexo cadastrado com sucesso');
              close();
              onDone();
            } catch (err) {
              submitting = false;
              showError(err.message || 'Erro ao anexar o arquivo');
            }
          },
        },
      ],
    });
  }

  async function excluirAnexo(anexo, onDone) {
    const confirmado = await confirmDialog({
      title: 'Excluir anexo',
      message: `Excluir o anexo "${anexo.nome_original}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;
    try {
      await deleteAnexoPedido(anexo.id);
      showSuccess('Anexo excluído com sucesso');
      onDone();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o anexo');
    }
  }

  function renderAnexosSection() {
    const body = el('div', { className: 'data-table__empty', textContent: 'Carregando anexos...' });
    let anexosTable = null;

    async function loadAnexos() {
      let anexos;
      try {
        anexos = await getAnexosPedido(pedidoId);
      } catch (err) {
        if (disposed) return;
        clearChildren(body);
        body.className = 'data-table__empty';
        body.textContent = err.message || 'Erro ao carregar anexos';
        return;
      }
      if (disposed) return;
      if (anexosTable) anexosTable._cleanup();

      anexosTable = createDataTable({
        columns: [
          { key: 'nome_original', label: 'Arquivo', sortable: true },
          { key: 'tipo_anexo_nome', label: 'Tipo' },
          { key: 'descricao', label: 'Descrição', render: (r) => r.descricao || '-' },
          { key: 'tamanho_bytes', label: 'Tamanho', render: (r) => formatBytes(r.tamanho_bytes) },
          {
            key: 'data_cadastramento',
            label: 'Cadastrado em',
            sortable: true,
            render: (r) => formatDateTime(r.data_cadastramento),
          },
          { key: 'usuario_cadastramento_nome', label: 'Por', render: (r) => r.usuario_cadastramento_nome || '-' },
        ],
        rows: anexos || [],
        pageSize: 5,
        emptyMessage: 'Nenhum anexo neste pedido',
        actions: [
          {
            icon: ICONS.download,
            title: 'Baixar',
            onClick: (r) => downloadAnexoPedido(r.id, r.nome_original)
              .catch((err) => showError(err.message || 'Erro ao baixar o anexo')),
          },
          {
            icon: ICONS.delete,
            title: 'Excluir anexo',
            variant: 'danger',
            onClick: (r) => excluirAnexo(r, loadAnexos),
          },
        ],
      });
      cleanups.push(() => anexosTable._cleanup());

      clearChildren(body);
      body.className = '';
      body.appendChild(anexosTable.element);
    }

    const section = el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Anexos do pedido' }),
        el('div', { className: 'dashboard-section__controls' }, [
          el('button', {
            className: 'btn btn--primary btn--sm',
            type: 'button',
            onClick: () => adicionarAnexo(loadAnexos),
          }, [svgIcon(ICONS.add, 14), 'Anexar documento']),
        ]),
      ]),
      body,
    ]);

    root.appendChild(section);
    loadAnexos();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function renderPedido(pedido) {
    // Header
    root.appendChild(el('div', { className: 'page__header' }, [
      el('div', {}, [
        el('button', {
          className: 'btn btn--text btn--sm',
          type: 'button',
          onClick: () => { location.hash = '/pedidos'; },
        }, [svgIcon(ICONS.arrowBack, 16), 'Pedidos']),
        el('div', { className: 'flex gap-sm' }, [
          el('h1', { className: 'page__title', textContent: `Pedido #${pedido.id}` }),
          chipSituacaoPedido(pedido.situacao_pedido_id, pedido.situacao_pedido_nome),
          chip(pedido.localizador_pedido || '-', 'secondary'),
        ]),
      ]),
      el('div', { className: 'page__actions' }, [
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => editarPedido(pedido),
        }, [svgIcon(ICONS.edit, 16), 'Editar']),
        el('button', {
          className: 'btn btn--danger',
          type: 'button',
          onClick: () => excluirPedido(pedido),
        }, [svgIcon(ICONS.delete, 16), 'Excluir']),
      ]),
    ]));

    // Info cards
    const cards = [
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Datas' }),
        infoRow('Pedido', formatDate(pedido.data_pedido)),
        infoRow('Atendimento', formatDate(pedido.data_atendimento)),
        infoRow('Prazo', formatDate(pedido.prazo)),
      ]),
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Cliente' }),
        infoRow('Nome', el('a', {
          href: `#/clientes/${pedido.cliente_id}`,
          textContent: pedido.cliente_nome || '-',
        })),
        infoRow('Tipo', pedido.tipo_cliente_nome),
        infoRow('Contato', pedido.ponto_contato),
        infoRow('Endereço', pedido.endereco_entrega),
      ]),
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Documento' }),
        infoRow('DIEx/Ofício', pedido.documento_solicitacao),
        infoRow('NUP', pedido.documento_solicitacao_nup),
        infoRow('Palavras-chave', (pedido.palavras_chave || []).length
          ? pedido.palavras_chave.join(', ')
          : '-'),
        infoRow('Demandante', pedido.demandante),
        infoRow('OM responsável', pedido.omds),
        infoRow('Previsto no PIT', pedido.previsto_pit ? 'Sim' : 'Não'),
      ]),
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Entrega' }),
        infoRow('Localizador de envio', pedido.localizador_envio),
        infoRow('Observação de envio', pedido.observacao_envio),
        infoRow('Operação', pedido.operacao),
      ]),
    ];

    if (pedido.motivo_cancelamento) {
      cards.push(el('div', { className: 'detail-card', style: { gridColumn: '1 / -1' } }, [
        el('div', { className: 'detail-card__title', textContent: 'Motivo do cancelamento' }),
        el('div', { className: 'detail-card__value', textContent: pedido.motivo_cancelamento }),
      ]));
    }
    if (pedido.observacao) {
      cards.push(el('div', { className: 'detail-card', style: { gridColumn: '1 / -1' } }, [
        el('div', { className: 'detail-card__title', textContent: 'Observação' }),
        el('div', { className: 'detail-card__value', textContent: pedido.observacao }),
      ]));
    }

    root.appendChild(el('div', { className: 'detail-cards' }, cards));

    // Items table
    const produtosTable = createDataTable({
      columns: [
        {
          key: 'produto_nome',
          label: 'Produto',
          sortable: true,
          render: (row) => row.produto_nome || '-',
        },
        { key: 'mi', label: 'MI', sortable: true },
        { key: 'inom', label: 'INOM' },
        { key: 'escala', label: 'Escala' },
        { key: 'tipo_midia_nome', label: 'Mídia' },
        {
          key: 'quantidade',
          label: 'Qtd.',
          sortable: true,
          render: (row) => formatNumber(row.quantidade),
        },
        {
          key: 'quantidade_fornecida',
          label: 'Qtd. fornecida',
          render: (row) => row.quantidade_fornecida == null ? '-' : formatNumber(row.quantidade_fornecida),
        },
        { key: 'forma_entrega_nome', label: 'Entrega' },
        {
          key: 'data_entrega',
          label: 'Data de entrega',
          render: (row) => formatDate(row.data_entrega),
        },
        {
          key: 'impressao_concluida',
          label: 'Impressão',
          render: (row) => el('span', { className: 'flex gap-sm' }, [
            el('span', {
              textContent: `${row.quantidade_impressa}/${row.quantidade} (restante ${row.quantidade_restante})`,
            }),
            row.impressao_concluida ? chip('Concluída', 'success') : chip('Pendente', 'warning'),
          ]),
        },
      ],
      rows: pedido.produtos || [],
      searchable: true,
      pageSize: 10,
      emptyMessage: 'Nenhum produto neste pedido',
      actions: [
        {
          icon: ICONS.print,
          title: 'Histórico de impressão',
          onClick: (row) => verHistoricoImpressao(row),
        },
        {
          icon: ICONS.edit,
          title: 'Editar item',
          onClick: (row) => editarItem(row),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir item',
          variant: 'danger',
          onClick: (row) => excluirItem(row),
        },
      ],
    });
    cleanups.push(() => produtosTable._cleanup());

    const impressao = pedido.impressao || {};
    const resumoImpressao = el('div', { className: 'flex gap-sm' }, [
      impressao.concluida
        ? chip('Impressão concluída', 'success')
        : chip('Impressão pendente', 'warning'),
      el('span', {
        className: 'detail-card__label',
        textContent: `${impressao.itens_concluidos ?? 0}/${impressao.total_itens ?? 0} itens impressos`,
      }),
    ]);

    root.appendChild(el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Produtos do pedido' }),
        el('div', { className: 'dashboard-section__controls' }, [
          resumoImpressao,
          el('button', {
            className: 'btn btn--primary btn--sm',
            type: 'button',
            onClick: adicionarItem,
          }, [svgIcon(ICONS.add, 14), 'Adicionar item']),
        ]),
      ]),
      produtosTable.element,
    ]));

    // Anexos do pedido (documento de solicitação + arquivos)
    renderAnexosSection();
  }

  await load();

  return () => {
    disposed = true;
    disposeCleanups();
  };
}
