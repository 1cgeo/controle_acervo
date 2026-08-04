import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getLicitacoes,
  deleteLicitacao,
  getTipoLicitacao,
  getAnos,
} from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';
import { openLicitacaoDialog } from './licitacao-dialog.js';

// As licitacoes alimentam o RPCMTec: o tipo 1 (GCALC DSG) corresponde a
// subsecao 4.4, e os tipos 2 (Própria) e 3 (Participante) correspondem a 4.5.
const COMPRIMENTO_TRUNCAR = 80;

function truncar(texto) {
  if (!texto) return '-';
  return texto.length > COMPRIMENTO_TRUNCAR ? `${texto.slice(0, COMPRIMENTO_TRUNCAR)}…` : texto;
}

/**
 * A celula da fase: o rotulo do dominio na tela, o texto livre no title.
 *
 * As duas coisas convivem por decisao. `fase_nome` classifica e serve para
 * varrer a lista; `fase_atual` narra, e um registro real gasta 103 caracteres
 * explicando por que o pregao se tornou fracassado. Mostrar so o rotulo
 * esconderia a explicacao, e mostrar so o texto devolveria a coluna ilegivel
 * que a tela tinha antes.
 * @param {Object} row
 * @returns {Node|string}
 */
function celulaFase(row) {
  const rotulo = row.fase_nome || truncar(row.fase_atual);
  if (!row.fase_atual) return rotulo;
  return el('span', { title: row.fase_atual, textContent: rotulo });
}

/**
 * Lista de Licitacoes (#/licitacoes). Filtros no topo: ano da tela e tipo
 * (1 = GCALC DSG / subsecao 4.4; 2 = Própria e 3 = Participante / subsecao 4.5).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderLicitacoesList(container, _ctx) {
  let disposed = false;
  let filtroTipo = null;
  const pode = permissoes('orcamento');

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openLicitacaoDialog({ ano: filtroAno.getAno(), onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova licitação']);

  // ---- Filtros ----
  // O ano e DESTA tela, comeca no ano atual e nao guarda nada (chefe,
  // 2026-08-04). `permitirOutroAno` porque o ano decide ONDE a licitacao e
  // cadastrada: abrir um exercicio novo passa por escolher um ano ainda vazio.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnos,
    permitirOutroAno: true,
    onChange: () => load(),
  });

  const tipoFilter = createSelectField({
    label: 'Tipo',
    options: [],
    placeholder: 'Todos os tipos',
    onChange: (id) => {
      filtroTipo = id;
      load();
    },
  });

  const table = createDataTable({
    // Sete campos novos entraram no cadastro e SO DOIS aparecem aqui. A lista
    // identifica a licitacao (pregao, objeto, tipo) e diz em que pe ela esta;
    // NUP, fornecedor e data de homologacao ficam no dialogo, que e onde se
    // trabalha um processo de cada vez.
    columns: [
      {
        key: 'numero_pregao',
        label: 'Pregão',
        render: (row) => row.numero_pregao || '-',
      },
      {
        key: 'objeto',
        label: 'Objeto',
        className: 'truncate',
        render: (row) => truncar(row.objeto),
      },
      {
        key: 'tipo_nome',
        label: 'Tipo',
        render: (row) => row.tipo_nome || '-',
      },
      {
        key: 'fase_nome',
        label: 'Fase',
        className: 'truncate',
        render: celulaFase,
      },
      {
        key: 'valor_total_estimado',
        label: 'Estimado',
        sortable: true,
        render: (row) => formatCurrency(row.valor_total_estimado),
      },
      {
        key: 'valor_final_homologado',
        label: 'Homologado',
        sortable: true,
        render: (row) => formatCurrency(row.valor_final_homologado),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhuma licitação cadastrada',
    actions: [
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openLicitacaoDialog({ licId: row.id, ano: filtroAno.getAno(), onSaved: load }),
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
      el('h1', { className: 'page__title', textContent: 'Licitações' }),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [
      filtroAno.element,
      tipoFilter.element,
    ]),
    table.element,
  ]);
  container.appendChild(page);

  async function loadFilterOptions() {
    try {
      const tipos = await getTipoLicitacao();
      if (disposed) return;
      tipoFilter.setOptions((tipos || []).map(t => ({ value: t.code, label: t.nome })));
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar filtros');
    }
  }

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getLicitacoes({
        ano: filtroAno.getAno(),
        tipo_id: filtroTipo ?? undefined,
      });
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar licitações');
    }
  }

  async function handleDelete(row) {
    // A confirmacao NOMEIA o registro. Dois ids reais tem o mesmo objeto em anos
    // diferentes: "esta licitação" nao distingue qual das duas some.
    const identificacao = [row.objeto ? truncar(row.objeto) : null, row.tipo_nome, row.ano]
      .filter(Boolean)
      .join(', ');
    const ok = await confirmDialog({
      title: 'Excluir licitação',
      message: `Tem certeza que deseja excluir a licitação "${identificacao}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteLicitacao(row.id);
      showSuccess('Licitação excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir licitação');
    }
  }

  await loadFilterOptions();
  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
