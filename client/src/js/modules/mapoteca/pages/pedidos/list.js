import { el, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chipSituacaoPedido } from '@components/status-chip.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import {
  getPedidos, deletePedidos, getAnosMapoteca,
} from '@modules/mapoteca/services/mapoteca-service.js';
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

// Aguardando producao (situacao 7) saiu da fila de atendimento em 2026-07-30:
// o pedido espera carta que ainda nao existe. Fora da fila, esses pedidos so
// aparecem AQUI. Sem um filtro proprio eles viram esquecimento quando a
// producao terminar, porque ninguem lembra de procurar linha a linha.
const SITUACAO_AGUARDANDO_PRODUCAO = 7;

// As duas situacoes que SAO o trabalho de atendimento, do dominio
// mapoteca.situacao_pedido (codigos copiados do DDL, er/mapoteca.sql).
//
// Militar e Civil sao o corte do DASHBOARD, e nao o de quem atende. Sem estes
// dois filtros nao havia como chegar aos 25 pedidos em andamento nem ao unico
// pedido Remetido (medidos na producao em 2026-08-04). O Remetido depende de
// alguem marca-lo Concluido justamente aqui, e uma linha em 17 paginas de 10
// nao e encontrada por quem nao a procura.
const SITUACAO_EM_ANDAMENTO = 3;
const SITUACAO_REMETIDO = 4;

const FILTROS = [
  { id: 'todos', label: 'Todos', casa: () => true },
  { id: 'militar', label: 'Militar', casa: (p) => TIPOS_MILITARES.includes(Number(p.tipo_cliente_id)) },
  { id: 'civil', label: 'Civil', casa: (p) => !TIPOS_MILITARES.includes(Number(p.tipo_cliente_id)) },
  {
    id: 'em_andamento',
    label: 'Em andamento',
    casa: (p) => Number(p.situacao_pedido_id) === SITUACAO_EM_ANDAMENTO,
  },
  {
    id: 'remetido',
    label: 'Remetido',
    casa: (p) => Number(p.situacao_pedido_id) === SITUACAO_REMETIDO,
  },
  {
    id: 'aguardando_producao',
    label: 'Aguardando produção',
    casa: (p) => Number(p.situacao_pedido_id) === SITUACAO_AGUARDANDO_PRODUCAO,
  },
];

export async function renderPedidosList(container, _ctx) {
  let disposed = false;
  let todosPedidos = [];
  let filtroAtual = 'todos';
  // O ano da ultima carga, para o contador dizer de que ano e a contagem.
  let ano = null;
  const pode = permissoes('mapoteca');

  // O ano e DESTA tela, comeca no ano atual e nao guarda nada (chefe,
  // 2026-08-04). Sem "+ Outro ano": aqui o ano so filtra o pedido que ja
  // existe, e um ano sem pedido nenhum seria uma lista em branco.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnosMapoteca,
    permitirOutroAno: false,
    onChange: () => load(),
  });

  function aplicarFiltro() {
    const filtro = FILTROS.find(f => f.id === filtroAtual) || FILTROS[0];
    const linhas = todosPedidos.filter(filtro.casa);
    table.update({ rows: linhas, loading: false });
    contador.textContent = filtroAtual === 'todos'
      ? `${linhas.length} pedido(s) em ${ano}`
      : `${linhas.length} de ${todosPedidos.length} pedido(s) em ${ano}`;
  }

  async function load() {
    ano = filtroAno.getAno();
    table.update({ loading: true });
    try {
      const pedidos = await getPedidos(ano);
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
        key: 'data_atualizacao',
        label: 'Alterado em',
        sortable: true,
        // QUANDO O REGISTRO mudou pela ultima vez, e nao a data do pedido, que
        // e a do DIEx. E o que mostra qual dos pedidos em aberto esta parado:
        // ordenar por esta coluna poe o esquecido na frente.
        //
        // Registro nunca alterado tem `data_atualizacao` nulo, e nele a ultima
        // alteracao E a criacao. Por isso a queda para `data_criacao`, que a
        // lista sempre traz.
        //
        // So a DATA, sem o autor: a migracao gravou um unico login em 164 de
        // 164 pedidos (medido na producao em 2026-08-04), entao `usuario_criacao_nome`
        // chega na resposta e fica de fora de proposito, e nao por esquecimento.
        render: (row) => formatDate(row.data_atualizacao || row.data_criacao),
        sortValue: (row) => row.data_atualizacao || row.data_criacao || null,
      },
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
    // A ordem que o servidor JA aplica (ORDER BY p.data_pedido DESC). Sem
    // declara-la, nenhum cabecalho mostrava a seta, o `aria-sort` ficava "none"
    // em todos, e o primeiro clique em "Data" saltava para o pedido mais ANTIGO,
    // obrigando a um segundo clique para voltar ao que a tela ja mostrava.
    defaultSort: { key: 'data_pedido', dir: 'desc' },
    searchable: true,
    loading: true,
    // Sem o ano no texto, de proposito: a mensagem e montada uma vez e o ano
    // muda no filtro. Quem diz de que ano e a lista e o contador ao lado dos
    // filtros, que se repinta a cada carga.
    emptyMessage: 'Nenhum pedido neste ano. Troque o ano no filtro para ver outro.',
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
      el('div', { className: 'page__actions' }, [
        // A planilha do RTM saiu daqui em 2026-08-02 (chefe). Ela morava nesta
        // tela porque "a planilha sai dos pedidos"; agora ela sai da tela do
        // RPCMTec, junto do Anuario e do DOCX, que e onde se monta o envio
        // mensal para a DSG -- e la ela passou a respeitar o MES escolhido, o
        // que aqui nao tinha como acontecer (esta tela so tem ano).
        ...(pode.gerente ? [
          el('button', {
            className: 'btn btn--primary',
            type: 'button',
            onClick: () => { location.hash = '/mapoteca/pedidos/novo'; },
          }, [svgIcon(ICONS.add, 16), 'Novo pedido']),
        ] : []),
      ]),
    ]),
    el('div', { className: 'filtro-barra' }, [
      // O ano vem PRIMEIRO: ele decide o que o servidor traz, e os botoes ao
      // lado so recortam o que ja chegou.
      filtroAno.element,
      el('div', { className: 'filtro-barra__grupo', role: 'group', 'aria-label': 'Filtrar os pedidos' }, botoesFiltro),
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
