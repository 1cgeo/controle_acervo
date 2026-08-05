import { el, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { chip } from '@components/status-chip.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { getClientes, deleteClientes } from '@modules/mapoteca/services/mapoteca-service.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { permissoes } from '@store/auth-store.js';
import { criarAvisoDeErro } from '../aviso-carga.js';
import { openClienteDialog } from './dialog-cliente.js';

/**
 * Clientes list page (#/clientes): table with search, edit/delete row actions,
 * multi-selection for bulk delete and the "Novo cliente" dialog.
 *
 * Criar, editar e excluir cliente sao gerente no servidor
 * (verifyPerfil('gerente', 'mapoteca')), entao quem tem consulta ou operador ve
 * a lista sem botao nenhum de escrita, em vez de descobrir no clique.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderClientesList(container, _ctx) {
  let disposed = false;
  const pode = permissoes('mapoteca');
  // Os clientes da ÚLTIMA carga. O diálogo de criação usa esta lista para avisar
  // sobre cliente parecido ANTES de gravar. Nada impede duplicata no banco, e o
  // par já existe: os ids 33 e 59 são a mesma OM, com um pedido cada.
  let clientesCarregados = [];

  async function load() {
    table.update({ loading: true });
    try {
      const clientes = await getClientes();
      if (disposed) return;
      clientesCarregados = clientes;
      table.update({ rows: clientes, loading: false });
      aviso.ok();
    } catch (err) {
      if (disposed) return;
      table.update({ loading: false });
      aviso.falhou(err.message || 'Erro ao carregar os clientes');
      showError(err.message || 'Erro ao carregar os clientes');
    }
  }

  function abrirDialog(cliente) {
    openClienteDialog({ cliente, onSaved: load, clientesExistentes: clientesCarregados });
  }

  async function excluirCliente(cliente) {
    const confirmado = await confirmDialog({
      title: 'Excluir cliente',
      message: `Excluir o cliente "${cliente.nome}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;

    try {
      await deleteClientes([cliente.id]);
      showSuccess('Cliente excluído com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o cliente');
    }
  }

  async function excluirSelecionados() {
    const selecionados = table.getSelected();
    if (!selecionados.length) return;

    const confirmado = await confirmDialog({
      title: 'Excluir clientes',
      message: `Excluir ${selecionados.length} cliente(s) selecionado(s)? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;

    try {
      await deleteClientes(selecionados.map(c => c.id));
      showSuccess(`${selecionados.length} cliente(s) excluído(s) com sucesso`);
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir os clientes');
    }
  }

  const deleteSelectedBtn = el('button', {
    className: 'btn btn--danger hidden',
    type: 'button',
    onClick: excluirSelecionados,
  }, [svgIcon(ICONS.delete, 16), 'Excluir selecionados']);

  const novoBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirDialog(null),
  }, [svgIcon(ICONS.add, 16), 'Novo cliente']);

  const table = createDataTable({
    columns: [
      // Sem coluna de ID: o id e chave interna, e quem opera identifica o
      // cliente pelo nome. Ele continua na URL do detalhe, para quem precisar.
      { key: 'nome', label: 'Nome', sortable: true },
      // A sigla é como a OM se apresenta ao telefone ("aqui é do 3º GAC Ap").
      // A busca da tabela varre as colunas DECLARADAS, então declarar a coluna
      // já faz "GAC Ap" achar a linha, sem digitar o nome por extenso. Ela está
      // preenchida em 174 dos 180 clientes; quem não é OM fica com "-".
      { key: 'sigla', label: 'Sigla', sortable: true },
      { key: 'tipo_cliente_nome', label: 'Tipo', sortable: true },
      { key: 'ponto_contato_principal', label: 'Contato' },
      {
        key: 'total_pedidos',
        label: 'Pedidos',
        sortable: true,
        render: (row) => formatNumber(row.total_pedidos),
      },
      {
        key: 'data_ultimo_pedido',
        label: 'Último pedido',
        sortable: true,
        render: (row) => formatDate(row.data_ultimo_pedido),
      },
      {
        // A coluna responde "tem pedido em andamento?", que e a pergunta de quem
        // varre a lista. A CONTAGEM exata continua no detalhe do cliente, no card
        // "Em andamento", porque um punhado de clientes tem mais de um.
        key: 'pedidos_em_andamento',
        label: 'Em andamento',
        sortable: true,
        render: (row) => Number(row.pedidos_em_andamento) > 0
          ? chip('Sim', 'info')
          : chip('Não', 'default'),
      },
    ],
    rows: [],
    searchable: true,
    // Sem exclusao a coluna de selecao nao serve para nada: ela existe SO para
    // a exclusao em lote.
    selectable: pode.gerente,
    loading: true,
    emptyMessage: 'Nenhum cliente cadastrado',
    onSelectionChange: (selecionados) => {
      deleteSelectedBtn.classList.toggle('hidden', selecionados.length === 0);
      deleteSelectedBtn.textContent = '';
      deleteSelectedBtn.appendChild(svgIcon(ICONS.delete, 16));
      deleteSelectedBtn.appendChild(
        document.createTextNode(`Excluir selecionados (${selecionados.length})`)
      );
    },
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver detalhes',
        onClick: (row) => { location.hash = `/mapoteca/clientes/${row.id}`; },
      },
      ...(pode.gerente ? [
        {
          icon: ICONS.edit,
          title: 'Editar',
          onClick: (row) => abrirDialog(row),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir',
          variant: 'danger',
          onClick: (row) => excluirCliente(row),
        },
      ] : []),
    ],
  });

  const aviso = criarAvisoDeErro(table, load);

  container.appendChild(el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Clientes' }),
      el('div', { className: 'page__actions' }, pode.gerente ? [deleteSelectedBtn, novoBtn] : []),
    ]),
    aviso.element,
  ]));

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
