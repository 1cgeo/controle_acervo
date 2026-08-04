import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, toNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getNotasEmpenho,
  deleteNotaEmpenho,
  getNotasCredito,
  getAnos,
} from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';
import { openNotaEmpenhoDialog } from './nota-empenho-dialog.js';

/**
 * O que ainda falta liquidar de uma NE.
 *
 * O empenhado que vale e o LIQUIDO da anulacao: NE anulada em parte nunca vai
 * liquidar o valor cheio, e contar o bruto a deixaria eternamente "em aberto".
 * Nunca devolve negativo, para a linha nao aparecer no topo por erro de
 * lancamento.
 * @param {Object} ne
 * @returns {number}
 */
function aLiquidar(ne) {
  const liquido = toNumber(ne.valor_empenhado) - toNumber(ne.valor_anulado);
  return Math.max(0, liquido - toNumber(ne.total_liquidado));
}

/**
 * Tolerância da quitação, em reais. Meio centavo.
 *
 * Os valores chegam como NUMERIC(15,2) e a subtração roda em ponto flutuante:
 * sobra resíduo. Dado real, a NE 2026NE000023: 2499.01 menos 339.16 menos
 * 2159.85 dá 4.547473508864641e-13, e não zero. Com o teste `<= 0` ela perdia o
 * chip "Liquidada" e subia na ordem padrão, que é por saldo.
 *
 * Meio centavo é menor que a menor diferença que o dado sabe representar: um
 * centavo de verdade continua em aberto.
 */
const TOLERANCIA_QUITACAO = 0.005;

/** A NE ja liquidou tudo o que podia? NE de valor liquido zero conta como sim. */
function estaQuitada(ne) {
  return aLiquidar(ne) < TOLERANCIA_QUITACAO;
}

/**
 * Lista de Notas de Empenho (#/notas_empenho). Filtros no topo: ano da tela e
 * nota de credito. A acao "Ver detalhes" navega para a pagina de detalhes da NE
 * (liquidacoes e recebimentos de material).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderNotasEmpenhoList(container, _ctx) {
  let disposed = false;
  let filtroNotaCredito = null;
  const pode = permissoes('orcamento');

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openNotaEmpenhoDialog({ ano: filtroAno.getAno(), onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova nota de empenho']);

  // ---- Filtros ----
  // O ano e DESTA tela, comeca no ano atual e nao guarda nada (chefe,
  // 2026-08-04). Trocar o ano tambem LIMPA o filtro de NC: as NCs sao do ano
  // anterior e a lista ficaria presa a uma NC que nao esta mais nas opcoes.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnos,
    permitirOutroAno: true,
    onChange: async () => {
      filtroNotaCredito = null;
      notaCreditoFilter.setValue(null);
      await loadFilterOptions();
      await load();
    },
  });

  const notaCreditoFilter = createSelectField({
    label: 'Nota de crédito',
    options: [],
    placeholder: 'Todas as notas de crédito',
    onChange: (id) => {
      filtroNotaCredito = id;
      load();
    },
  });

  const table = createDataTable({
    columns: [
      { key: 'numero', label: 'Número', sortable: true },
      { key: 'ano', label: 'Ano', sortable: true },
      {
        key: 'nota_credito_numero',
        label: 'NC',
        render: (row) => row.nota_credito_numero || '-',
      },
      {
        key: 'cod_nd',
        label: 'ND',
        render: (row) => (row.nd_nome ? `${row.cod_nd} - ${row.nd_nome}` : (row.cod_nd ?? '-')),
      },
      {
        // O numero NAO distingue as NEs: tres NEs reais de 2026 compartilham o
        // 2026NE000024 e so a NC as separa. A finalidade e o unico texto que diz
        // para que serve o empenho, e a busca da tabela varre esta coluna.
        key: 'finalidade',
        label: 'Finalidade',
        className: 'data-table__cell--truncate',
        render: (row) => row.finalidade || '-',
      },
      {
        key: 'valor_empenhado',
        label: 'Empenhado',
        sortable: true,
        sortValue: (row) => toNumber(row.valor_empenhado),
        render: (row) => formatCurrency(row.valor_empenhado),
      },
      {
        key: 'total_liquidado',
        label: 'Liquidado',
        sortable: true,
        sortValue: (row) => toNumber(row.total_liquidado),
        render: (row) => (row.total_liquidado === null || row.total_liquidado === undefined
          ? '-'
          : formatCurrency(row.total_liquidado)),
      },
      {
        // Coluna NOVA, e o criterio de ordem da tela (chefe, 2026-07-31): o que
        // importa e o que ainda falta liquidar. Ela nao vem do backend, e sai da
        // conta empenhado menos anulado menos liquidado.
        key: 'a_liquidar',
        label: 'A liquidar',
        sortable: true,
        sortValue: (row) => aLiquidar(row),
        render: (row) => (estaQuitada(row)
          ? el('span', { className: 'chip chip--success', textContent: 'Liquidada' })
          : formatCurrency(aLiquidar(row))),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    // Maior saldo a liquidar primeiro, e as 100% liquidadas no fim (chefe,
    // 2026-07-31). A ordem antiga era ano e numero, que espalha o que precisa de
    // acao entre o que ja fechou.
    defaultSort: { key: 'a_liquidar', dir: 'desc' },
    rowClassName: (row) => (estaQuitada(row) ? 'data-table__row--quitada' : ''),
    emptyMessage: 'Nenhuma nota de empenho cadastrada',
    actions: [
      {
        // Abre a pagina de detalhes da NE, onde se lancam liquidacoes e
        // recebimentos. Icone de "assignment" (prancheta) deixa claro que e
        // uma area de lancamento/gestao, nao apenas visualizacao.
        icon: ICONS.assignment,
        title: 'Detalhes e lançamento de liquidações',
        onClick: (row) => { location.hash = `/orcamento/notas_empenho/${row.id}`; },
      },
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openNotaEmpenhoDialog({
          neId: row.id,
          ano: filtroAno.getAno(),
          onSaved: load,
        }),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Notas de Empenho' }),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [
      filtroAno.element,
      notaCreditoFilter.element,
    ]),
    table.element,
  ]);
  container.appendChild(page);

  async function loadFilterOptions() {
    try {
      const notasCredito = await getNotasCredito({ ano: filtroAno.getAno() });
      if (disposed) return;
      notaCreditoFilter.setOptions((notasCredito || []).map(nc => ({
        value: nc.id,
        label: nc.cod_nd ? `${nc.numero ?? `NC ${nc.id}`} - ${nc.cod_nd}` : (nc.numero ?? `NC ${nc.id}`),
      })));
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar filtros');
    }
  }

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getNotasEmpenho({
        ano: filtroAno.getAno(),
        nota_credito_id: filtroNotaCredito ?? undefined,
      });
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar notas de empenho');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir nota de empenho',
      message: `Tem certeza que deseja excluir a NE ${row.numero}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteNotaEmpenho(row.id);
      showSuccess('Nota de empenho excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir nota de empenho');
    }
  }

  await loadFilterOptions();
  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
