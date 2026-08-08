import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, toNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
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
  // O ano e DESTA tela, comeca no ano atual e nao guarda nada. `permitirOutroAno` porque o ano decide ONDE a licitacao e
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
    // A lista identifica a licitacao (pregao, objeto, tipo) e diz em que pe ela
    // esta; a data de homologacao e a OM gestora ficam no dialogo, que e onde se
    // trabalha um processo de cada vez. O NUP e o fornecedor sairam do banco em
    // 2026-08-08, com 0 de 11 licitacoes preenchidas nos dois.
    columns: [
      {
        key: 'numero_pregao',
        label: 'Pregão',
        render: (row) => row.numero_pregao || '-',
      },
      {
        // O texto INTEIRO vai para a celula, e quem corta e a CSS. Cortar antes
        // fazia o `title` do <td> repetir o texto ja cortado, entao passar o
        // mouse nao revelava nada. A classe 'truncate' tambem nao existe: as
        // reais sao `.text-truncate` e `.data-table__cell--truncate`.
        key: 'objeto',
        label: 'Objeto',
        className: 'data-table__cell--truncate',
        render: (row) => row.objeto || '-',
      },
      {
        key: 'tipo_nome',
        label: 'Tipo',
        render: (row) => row.tipo_nome || '-',
      },
      {
        key: 'fase_nome',
        label: 'Fase',
        className: 'data-table__cell--truncate',
        render: celulaFase,
      },
      {
        key: 'valor_total_estimado',
        label: 'Estimado',
        sortable: true,
        // NUMERIC(15,2) chega como TEXTO no JSON (er/orcamento.sql:99-100), e a
        // ordem por string mente: '900.00' passa a frente de '1000.00'. As irmas
        // (DFD, PDR, notas de credito) ja passam por toNumber.
        sortValue: (row) => toNumber(row.valor_total_estimado),
        render: (row) => formatCurrency(row.valor_total_estimado),
      },
      {
        key: 'valor_final_homologado',
        label: 'Homologado',
        sortable: true,
        sortValue: (row) => toNumber(row.valor_final_homologado),
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

  // A tabela vive num no proprio para o estado de ERRO poder tomar o lugar dela
  // e devolve-lo depois, sem recriar a tabela. Ver `falhaNaCarga`.
  const areaTabela = el('div', {}, [table.element]);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Licitações' }),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    el('div', { className: 'page__filters' }, [
      filtroAno.element,
      tipoFilter.element,
    ]),
    areaTabela,
  ]);
  container.appendChild(page);

  /**
   * Estado de ERRO no lugar da tabela.
   *
   * Zerar as linhas fazia a tabela escrever "Nenhuma licitação cadastrada": a
   * falha da API lia-se como cadastro vazio, e as duas pedem acoes opostas.
   *
   * A tabela volta ANTES do aviso porque `mostrarErro` guarda o que estava no
   * no: uma segunda falha guardaria o proprio aviso, e "Tentar de novo" pararia
   * de devolver a tabela.
   */
  function falhaNaCarga(err) {
    areaTabela.replaceChildren(table.element);
    mostrarErro(areaTabela, err, load);
  }

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
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);

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
      table.update({ loading: false });
      falhaNaCarga(err);
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
