import { el, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chipSituacaoPedido } from '@components/status-chip.js';
import { getPedidos, deletePedidos } from '@modules/mapoteca/services/mapoteca-service.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { permissoes } from '@store/auth-store.js';

/**
 * Pedidos list page (#/pedidos): table with search, status chips, printing
 * progress, link to details, delete with confirmation and "Novo pedido".
 *
 * Criar e excluir pedido sao gerente no servidor, entao quem tem consulta ou
 * operador ve a lista e o detalhe, e nada mais.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
// Militar e OM EB, OM Aeronautica e OM Marinha (tipo_cliente 1 a 3). Civil e o
// resto: orgao publico federal, estadual e municipal, pessoa juridica, pessoa
// fisica e LAI. O mesmo corte que o dashboard usa para "pedido militar".
const TIPOS_MILITARES = [1, 2, 3];

const FILTROS = [
  { id: 'todos', label: 'Todos', casa: () => true },
  { id: 'militar', label: 'Militar', casa: (p) => TIPOS_MILITARES.includes(Number(p.tipo_cliente_id)) },
  { id: 'civil', label: 'Civil', casa: (p) => !TIPOS_MILITARES.includes(Number(p.tipo_cliente_id)) },
];

export async function renderPedidosList(container, _ctx) {
  let disposed = false;
  let todosPedidos = [];
  let filtroAtual = 'todos';
  const pode = permissoes('mapoteca');

  function aplicarFiltro() {
    const filtro = FILTROS.find(f => f.id === filtroAtual) || FILTROS[0];
    const linhas = todosPedidos.filter(filtro.casa);
    table.update({ rows: linhas, loading: false });
    contador.textContent = filtroAtual === 'todos'
      ? `${linhas.length} pedido(s)`
      : `${linhas.length} de ${todosPedidos.length} pedido(s)`;
  }

  async function load() {
    table.update({ loading: true });
    try {
      const pedidos = await getPedidos();
      if (disposed) return;
      todosPedidos = pedidos;
      aplicarFiltro();
    } catch (err) {
      if (disposed) return;
      todosPedidos = [];
      table.update({ rows: [], loading: false });
      contador.textContent = '';
      showError(err.message || 'Erro ao carregar os pedidos');
    }
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
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o pedido');
    }
  }

  const contador = el('span', { className: 'page__meta', textContent: '' });

  const botoesFiltro = FILTROS.map(f => el('button', {
    className: `btn btn--sm ${f.id === filtroAtual ? 'btn--primary' : 'btn--secondary'}`,
    type: 'button',
    textContent: f.label,
    onClick: () => {
      filtroAtual = f.id;
      for (const b of botoesFiltro) {
        const ativo = b.dataset.filtro === filtroAtual;
        b.classList.toggle('btn--primary', ativo);
        b.classList.toggle('btn--secondary', !ativo);
      }
      aplicarFiltro();
    },
  }));
  botoesFiltro.forEach((b, i) => { b.dataset.filtro = FILTROS[i].id; });

  const table = createDataTable({
    columns: [
      // Sem coluna de ID: e chave interna. O pedido se identifica pelo
      // localizador e pelo documento, e o id segue na URL do detalhe.
      {
        key: 'data_pedido',
        label: 'Data',
        sortable: true,
        render: (row) => formatDate(row.data_pedido),
      },
      { key: 'cliente_nome', label: 'Cliente', sortable: true },
      { key: 'tipo_cliente_nome', label: 'Tipo', sortable: true },
      { key: 'documento_solicitacao', label: 'Documento' },
      {
        key: 'situacao_pedido_nome',
        label: 'Situação',
        render: (row) => chipSituacaoPedido(row.situacao_pedido_id, row.situacao_pedido_nome),
      },
      { key: 'prazo', label: 'Prazo', sortable: true, render: (row) => formatDate(row.prazo) },
      {
        key: 'quantidade_produtos',
        label: 'Qtd. produtos',
        sortable: true,
        render: (row) => formatNumber(row.quantidade_produtos),
      },
      {
        key: 'itens_impressos',
        label: 'Impressão',
        render: (row) => `${row.itens_impressos ?? 0}/${row.quantidade_produtos ?? 0}`,
      },
      { key: 'localizador_pedido', label: 'Localizador' },
    ],
    rows: [],
    searchable: true,
    loading: true,
    emptyMessage: 'Nenhum pedido cadastrado',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver detalhes',
        onClick: (row) => { location.hash = `/mapoteca/pedidos/${row.id}`; },
      },
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => excluirPedido(row),
      }] : []),
    ],
  });

  container.appendChild(el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Pedidos' }),
      el('div', { className: 'page__actions' }, pode.gerente ? [
        el('button', {
          className: 'btn btn--primary',
          type: 'button',
          onClick: () => { location.hash = '/mapoteca/pedidos/novo'; },
        }, [svgIcon(ICONS.add, 16), 'Novo pedido']),
      ] : []),
    ]),
    el('div', { className: 'filtro-barra' }, [
      el('div', { className: 'filtro-barra__grupo', role: 'group', 'aria-label': 'Filtrar por tipo de cliente' }, botoesFiltro),
      contador,
    ]),
    table.element,
  ]));

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
