import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, formatDate, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chip } from '@components/status-chip.js';
import { getPlotters, deletePlotters, getManutencoes } from '@modules/mapoteca/services/mapoteca-service.js';
import { permissoes } from '@store/auth-store.js';
import { criarAvisoDeErro } from '../aviso-carga.js';
import { openPlotterDialog } from './plotter-dialog.js';

/**
 * Plotters list page (#/plotters).
 *
 * Cadastro de plotter e gerente no servidor, criar, editar e excluir.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderPlottersList(container, _ctx) {
  let disposed = false;
  const pode = permissoes('mapoteca');

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openPlotterDialog({ onSaved: recarregar }),
  }, [svgIcon(ICONS.add, 16), 'Novo plotter']);

  const table = createDataTable({
    columns: [
      {
        key: 'ativo',
        label: 'Status',
        render: (row) => chip(row.ativo ? 'Ativo' : 'Inativo', row.ativo ? 'success' : 'default'),
      },
      {
        key: 'nr_serie',
        label: 'Número de série',
        sortable: true,
        render: (row) => el('a', { href: `#/mapoteca/plotters/${row.id}`, textContent: row.nr_serie }),
      },
      { key: 'modelo', label: 'Modelo', sortable: true },
      {
        key: 'data_aquisicao',
        label: 'Data de aquisição',
        sortable: true,
        render: (row) => formatDate(row.data_aquisicao),
      },
      {
        key: 'vida_util',
        label: 'Vida útil',
        sortable: true,
        render: (row) => (row.vida_util === null || row.vida_util === undefined
          ? '-'
          : `${formatNumber(row.vida_util)} meses`),
      },
      {
        key: 'data_ultima_manutencao',
        label: 'Última manutenção',
        sortable: true,
        render: (row) => formatDate(row.data_ultima_manutencao),
      },
      {
        key: 'quantidade_manutencoes',
        label: 'Manutenções',
        sortable: true,
        render: (row) => formatNumber(row.quantidade_manutencoes),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum plotter cadastrado',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver detalhes',
        onClick: (row) => { location.hash = `/mapoteca/plotters/${row.id}`; },
      },
      ...(pode.gerente ? [
        {
          icon: ICONS.edit,
          title: 'Editar',
          onClick: (row) => openPlotterDialog({ plotter: row, onSaved: recarregar }),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir',
          variant: 'danger',
          onClick: (row) => handleDelete(row),
        },
      ] : []),
    ],
  });

  // ---------------------------------------------------------------------------
  // Manutencoes da frota
  // ---------------------------------------------------------------------------
  // A INTERACAO QUE FALTAVA. GET /mapoteca/manutencao_plotter devolve a
  // manutencao de TODOS os plotters, e nenhuma tela a chamava: a manutencao so
  // aparecia dentro da ficha de um equipamento. Quem pergunta "quanto a frota
  // custou este ano" ou "qual foi a ultima parada" tinha de abrir plotter a
  // plotter e somar de cabeca.
  //
  // Leitura pura (a rota e perfil consulta), entao a secao aparece para todos.
  // Criar, editar e excluir manutencao continuam na ficha do plotter, onde o
  // equipamento ja esta escolhido.
  const manutencoesTable = createDataTable({
    columns: [
      {
        key: 'data_manutencao',
        label: 'Data',
        sortable: true,
        render: (row) => formatDate(row.data_manutencao),
      },
      {
        key: 'modelo',
        label: 'Plotter',
        sortable: true,
        render: (row) => el('a', {
          href: `#/mapoteca/plotters/${row.plotter_id}`,
          textContent: `${row.modelo || '-'} (${row.nr_serie || '-'})`,
        }),
      },
      {
        key: 'valor',
        label: 'Valor',
        sortable: true,
        render: (row) => formatCurrency(row.valor),
        // NUMERIC do PostgreSQL chega como texto, e ordenar texto poe
        // '1000.00' antes de '500.00'.
        sortValue: (row) => Number(row.valor),
      },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
      {
        key: 'usuario_criacao_nome',
        label: 'Registrado por',
        render: (row) => row.usuario_criacao_nome || '-',
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 10,
    loading: true,
    defaultSort: { key: 'data_manutencao', dir: 'desc' },
    emptyMessage: 'Nenhuma manutenção registrada na frota',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver o plotter',
        onClick: (row) => { location.hash = `/mapoteca/plotters/${row.plotter_id}`; },
      },
    ],
  });

  // Diz o total gasto e quantas paradas ele soma. Sem ele a secao seria uma
  // lista paginada, e a pergunta "quanto custou" continuaria sem resposta.
  const manutencoesMeta = el('span', { className: 'dashboard-section__meta', textContent: '' });

  const avisoManutencoes = criarAvisoDeErro(manutencoesTable, loadManutencoes);

  const secaoManutencoes = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Manutenções da frota' }),
      manutencoesMeta,
    ]),
    avisoManutencoes.element,
  ]);

  const aviso = criarAvisoDeErro(table, load);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Plotters' }),
      el('div', { className: 'page__actions' }, pode.gerente ? [newBtn] : []),
    ]),
    aviso.element,
    secaoManutencoes,
  ]);
  container.appendChild(page);

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getPlotters();
      if (disposed) return;
      const rows = dados.map(r => ({
        ...r,
        quantidade_manutencoes: Number(r.quantidade_manutencoes),
      }));
      table.update({ rows, loading: false });
      aviso.ok();
    } catch (err) {
      if (disposed) return;
      table.update({ loading: false });
      aviso.falhou(err.message || 'Erro ao carregar os plotters');
      showError(err.message || 'Erro ao carregar os plotters');
    }
  }

  async function loadManutencoes() {
    manutencoesTable.update({ loading: true });
    try {
      const dados = await getManutencoes();
      if (disposed) return;
      const total = dados.reduce((soma, m) => soma + (Number(m.valor) || 0), 0);
      manutencoesTable.update({ rows: dados, loading: false });
      manutencoesMeta.textContent = dados.length
        ? `${formatNumber(dados.length)} manutenção(ões), ${formatCurrency(total)} no total`
        : '';
      avisoManutencoes.ok();
    } catch (err) {
      if (disposed) return;
      manutencoesTable.update({ loading: false });
      manutencoesMeta.textContent = '';
      avisoManutencoes.falhou(err.message || 'Erro ao carregar as manutenções');
      showError(err.message || 'Erro ao carregar as manutenções');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir plotter',
      message: `Tem certeza que deseja excluir o plotter ${row.modelo} (${row.nr_serie})? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePlotters([row.id]);
      showSuccess('Plotter excluído com sucesso');
      await recarregar();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o plotter');
    }
  }

  /**
   * As duas listas juntas.
   *
   * Excluir um plotter leva as manutencoes dele, e editar o equipamento muda o
   * modelo e o numero de serie que a tabela de manutencoes mostra. Recarregar
   * so a lista de cima deixaria a de baixo mentindo ate a proxima visita.
   *
   * As duas so chamam `update`, entao a busca, a ordem e a pagina de cada uma
   * atravessam a gravacao.
   */
  async function recarregar() {
    await Promise.all([load(), loadManutencoes()]);
  }

  await recarregar();

  return () => {
    disposed = true;
    table._cleanup();
    manutencoesTable._cleanup();
  };
}
