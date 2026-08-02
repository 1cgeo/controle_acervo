import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { chip, chipSituacaoPedido } from '@components/status-chip.js';
import { getCliente } from '@modules/mapoteca/services/mapoteca-service.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { permissoes } from '@store/auth-store.js';
import { openClienteDialog } from './dialog-cliente.js';
import { criarHistorico } from '@components/historico/historico.js';

function summaryCard(label, value) {
  return el('div', { className: 'summary-card' }, [
    el('div', { className: 'summary-card__value', textContent: value }),
    el('div', { className: 'summary-card__label', textContent: label }),
  ]);
}

function infoRow(label, value) {
  return el('div', { className: 'detail-card__row' }, [
    el('span', { className: 'detail-card__label', textContent: label }),
    el('span', { className: 'detail-card__value', textContent: value || '-' }),
  ]);
}

/**
 * Cliente details page (#/clientes/:id): statistics cards, contact info,
 * recent orders (link to order details) and the edit dialog.
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderClienteDetails(container, { params }) {
  const clienteId = Number(params.id);
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
    root.appendChild(el('div', { className: 'data-table__empty', textContent: 'Carregando cliente...' }));

    let cliente;
    try {
      cliente = await getCliente(clienteId);
    } catch (err) {
      if (disposed) return;
      clearChildren(root);
      showError(err.message || 'Erro ao carregar o cliente');
      root.appendChild(el('div', { className: 'data-table__empty', textContent: err.message || 'Cliente não encontrado' }));
      root.appendChild(el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => { location.hash = '/mapoteca/clientes'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar para clientes']));
      return;
    }
    if (disposed) return;

    clearChildren(root);
    renderCliente(cliente);
  }

  function renderCliente(cliente) {
    const est = cliente.estatisticas || {};

    // Header
    root.appendChild(el('div', { className: 'page__header' }, [
      el('div', {}, [
        el('button', {
          className: 'btn btn--text btn--sm',
          type: 'button',
          onClick: () => { location.hash = '/mapoteca/clientes'; },
        }, [svgIcon(ICONS.arrowBack, 16), 'Clientes']),
        el('div', { className: 'flex gap-sm' }, [
          el('h1', { className: 'page__title', textContent: cliente.nome }),
          chip(cliente.tipo_cliente_nome || '-', 'info'),
        ]),
      ]),
      // PUT /cliente e gerente: sem isso o botao aparecia para quem so le.
      el('div', { className: 'page__actions' }, permissoes('mapoteca').gerente ? [
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => openClienteDialog({ cliente, onSaved: load }),
        }, [svgIcon(ICONS.edit, 16), 'Editar']),
      ] : []),
    ]));

    // Statistics cards
    root.appendChild(el('div', { className: 'summary-cards' }, [
      summaryCard('Total de pedidos', formatNumber(est.total_pedidos)),
      summaryCard('Em andamento', formatNumber(est.pedidos_em_andamento)),
      summaryCard('Concluídos', formatNumber(est.pedidos_concluidos)),
      summaryCard('Total de produtos', formatNumber(est.total_produtos)),
      summaryCard('Primeiro pedido', formatDate(est.data_primeiro_pedido)),
      summaryCard('Último pedido', formatDate(est.data_ultimo_pedido)),
    ]));

    // Contact info
    root.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Informações de contato' }),
        infoRow('Tipo de cliente', cliente.tipo_cliente_nome),
        // "Geral" e o que o distingue do contato de UM pedido, que mora em
        // mapoteca.pedido.ponto_contato e aparece no detalhe do pedido.
        infoRow('Contato geral da OM', cliente.ponto_contato_principal),
        infoRow('Endereço de entrega principal', cliente.endereco_entrega_principal),
      ]),
    ]));

    // Recent orders
    const pedidosTable = createDataTable({
      columns: [
        { key: 'id', label: 'ID', sortable: true },
        {
          key: 'data_pedido',
          label: 'Data',
          sortable: true,
          render: (row) => formatDate(row.data_pedido),
        },
        {
          key: 'situacao_pedido_nome',
          label: 'Situação',
          render: (row) => chipSituacaoPedido(row.situacao_pedido_id, row.situacao_pedido_nome),
        },
        { key: 'documento_solicitacao', label: 'Documento' },
        { key: 'prazo', label: 'Prazo', render: (row) => formatDate(row.prazo) },
        {
          key: 'quantidade_produtos',
          label: 'Produtos',
          render: (row) => formatNumber(row.quantidade_produtos),
        },
      ],
      rows: cliente.ultimos_pedidos || [],
      pageSize: 5,
      emptyMessage: 'Nenhum pedido para este cliente',
      actions: [
        {
          icon: ICONS.visibility,
          title: 'Ver pedido',
          onClick: (row) => { location.hash = `/mapoteca/pedidos/${row.id}`; },
        },
      ],
    });
    cleanups.push(() => pedidosTable._cleanup());

    root.appendChild(el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Últimos pedidos' }),
      ]),
      pedidosTable.element,
    ]));
  }

  await load();

  // Histórico de alterações. É o MESMO componente da ficha do pedido, e é por
  // isso que ele existe: a seção que o chefe gostou lá vale em toda ficha, e
  // copiá-la seria a segunda versão a divergir na primeira correção.
  //
  // Fica FORA do `load()` de propósito: `load` se remonta a cada salvamento, e
  // dentro dele o histórico seria destruído e refeito a cada edição. Aqui ele é
  // montado uma vez, e quem o recarrega é quem sabe que algo mudou.
  const historico = criarHistorico({
    modulo: 'mapoteca',
    entidade: 'cliente',
    id: clienteId,
    subtitulo: 'Quem alterou o cadastro deste cliente',
  });
  cleanups.push(() => historico.cleanup());
  root.appendChild(historico.element);

  return () => {
    disposed = true;
    disposeCleanups();
  };
}
