import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getMetasPit,
  getAnosMetaPit,
  deleteMetaPit,
  codigoMetaPit,
} from '@services/plataforma-service.js';
import { isAdmin } from '@store/auth-store.js';
import { formatCurrency, toNumber } from '@utils/format.js';
import { openMetaDialog } from './meta-dialog.js';

/**
 * Metas do PIT (#/metas). Tela de PLATAFORMA, como a de usuarios.
 *
 * Ela morou dentro do modulo orcamento ate 2026-07-31, e saiu porque o PIT nao
 * e artefato orcamentario: e o plano anual da Divisao. O orcamento amarra a NC e
 * o item do PDR a meta que financiam, e a mapoteca amarra o pedido de impressao
 * a meta que ele cumpre. Enquanto a tela era do orcamento, quem so tinha perfil
 * na mapoteca nao conseguia nem VER a lista.
 *
 * LER e de qualquer pessoa logada. ESCREVER e do administrador global: o PIT
 * muda uma vez por ano, vem de documento assinado, e errar nele contamina os
 * tres modulos. O backend cobra a regra; aqui so escondemos o que nao adianta
 * oferecer.
 *
 * O ANO tem filtro PROPRIO no topo, o mesmo componente que as telas do
 * orcamento usam (@components/filtro-ano.js). Ele nasce no ano ATUAL e nao
 * guarda nada. Os anos vem de GET /metas/anos, mais o ano corrente, para
 * cadastrar o exercicio novo.
 *
 * Ate 2026-08-04 esta tela importava o ano do modulo ORCAMENTO, porque o
 * seletor daquele modulo morava na navbar. Era acoplamento errado: metas e tela
 * de PLATAFORMA, e o ano dela nao depende de em que ano alguem lancou uma nota
 * de credito.
 *
 * `permitirOutroAno` fica FALSO: aqui o ano so filtra o que ja existe, e um ano
 * vazio seria oferecer uma tela em branco. A meta de um ano novo se cria pelo
 * dialogo, que recebe o ano por parametro.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderMetasList(container, _ctx) {
  let disposed = false;
  const podeEscrever = isAdmin();

  const filtroAno = criarFiltroAno({
    carregarAnos: getAnosMetaPit,
    permitirOutroAno: false,
    onChange: () => load(),
  });

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openMetaDialog({ ano: filtroAno.getAno(), onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova meta']);

  const table = createDataTable({
    columns: [
      { key: 'ano', label: 'Ano', sortable: true },
      {
        key: 'codigo',
        label: 'Meta',
        sortable: true,
        render: (row) => codigoMetaPit(row),
      },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
      // O que o PIT promete. Entrou em 2026-08-02 e é o que faz a subseção 2.1
      // do RPCMTec ser gerável. Vazio na linha de cabeçalho da meta é o certo:
      // quem promete são os itens que ela agrupa.
      {
        key: 'quantidade_prevista',
        label: 'Previsto',
        sortable: true,
        render: (row) => (row.quantidade_prevista == null
          ? '-'
          : `${row.quantidade_prevista}${row.unidade ? ` ${row.unidade}` : ''}`),
      },
      { key: 'demandante', label: 'Demandante', render: (row) => row.demandante || '-' },
      {
        key: 'prazo',
        label: 'Prazo',
        sortable: true,
        render: (row) => (row.prazo ? String(row.prazo).slice(0, 10).split('-').reverse().join('/') : '-'),
      },
      // O que FINANCIA a promessa. As duas colunas entraram em 2026-08-04 e sao
      // o caminho de volta do orcamento para o PIT: a NC e o item do PDR
      // apontam a meta, e a tela da meta nao mostrava nenhum dos dois.
      // NUMERIC chega como texto no JSON, entao a ordenacao passa por sortValue.
      {
        key: 'credito_nc',
        label: 'Crédito (NC)',
        sortable: true,
        sortValue: (row) => toNumber(row.credito_nc),
        render: (row) => formatCurrency(row.credito_nc),
      },
      {
        key: 'pdr_autorizado',
        label: 'PDR autorizado',
        sortable: true,
        // Nulo aqui e "nao informado", e nao zero: `valor_autorizado` e
        // anulavel. O sortValue devolve nulo para a linha cair no fim da
        // ordenacao, em vez de se misturar com as metas de valor zero.
        sortValue: (row) => (row.pdr_autorizado == null ? null : toNumber(row.pdr_autorizado)),
        render: (row) => formatCurrency(row.pdr_autorizado),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 50,
    loading: true,
    emptyMessage: 'Nenhuma meta cadastrada',
    actions: podeEscrever ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openMetaDialog({ meta: row, onSaved: load }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      },
    ] : [],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Metas do PIT' }),
      el('div', { className: 'page__actions' }, podeEscrever ? [newBtn] : []),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [filtroAno.element]),
    table.element,
  ]);
  container.appendChild(page);

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getMetasPit(filtroAno.getAno());
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar as metas do PIT');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir meta',
      message: `Tem certeza que deseja excluir a meta ${codigoMetaPit(row)} de ${row.ano}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMetaPit(row.id);
      showSuccess('Meta excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir meta');
    }
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
