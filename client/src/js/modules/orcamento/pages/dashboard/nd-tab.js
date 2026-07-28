import { formatCurrency } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';

const COLS_BASE = [
  { key: 'cod_nd', label: 'Cód. ND' },
  { key: 'nd_nome', label: 'Natureza de Despesa', render: (row) => row.nd_nome || '-' },
];

/** Colunas de cada recorte. O previsto so existe no PDR. */
const RECORTES = {
  pdr: {
    colunas: [
      { key: 'previsto', label: 'Previsto', render: (row) => formatCurrency(row.previsto) },
      { key: 'recebido_pdr', label: 'Recebido', render: (row) => formatCurrency(row.recebido_pdr) },
      { key: 'empenhado_pdr', label: 'Empenhado', render: (row) => formatCurrency(row.empenhado_pdr) },
      { key: 'liquidado_pdr', label: 'Liquidado', render: (row) => formatCurrency(row.liquidado_pdr) },
    ],
    vazio: 'Sem execução PDR para o mês selecionado',
  },
  extra: {
    colunas: [
      { key: 'recebido_extra', label: 'Recebido', render: (row) => formatCurrency(row.recebido_extra) },
      { key: 'empenhado_extra', label: 'Empenhado', render: (row) => formatCurrency(row.empenhado_extra) },
      { key: 'liquidado_extra', label: 'Liquidado', render: (row) => formatCurrency(row.liquidado_extra) },
    ],
    vazio: 'Sem execução Extra-PDR para o mês selecionado',
  },
};

/**
 * Fabrica das abas de tabela por Natureza de Despesa.
 *
 * PDR (3.2) e Extra-PDR (3.7) saem da MESMA linha da tabela_31, so mudam as
 * colunas. Ficavam empilhadas na mesma tela; como cada uma ja e larga, uma
 * escondia a outra atras da rolagem. Em abas, cada recorte usa a largura toda.
 *
 * @param {'pdr'|'extra'} recorte
 * @returns {(container:HTMLElement, store:Object)=>Promise<Object>}
 */
export function criarNdTab(recorte) {
  const { colunas, vazio } = RECORTES[recorte];

  return async function renderNdTab(container, store) {
    let disposed = false;

    const tabela = createDataTable({
      columns: [...COLS_BASE, ...colunas],
      rows: [],
      pageSize: 25,
      loading: true,
      emptyMessage: vazio,
    });

    container.appendChild(tabela.element);

    async function load() {
      tabela.update({ loading: true });
      try {
        const secao3 = await store.carregar();
        if (disposed) return;
        tabela.update({ rows: (secao3 && secao3.tabela_31) || [], loading: false });
      } catch (err) {
        if (disposed) return;
        tabela.update({ rows: [], loading: false });
        showError(err.message || 'Erro ao carregar a execução orçamentária');
      }
    }

    await load();

    return {
      cleanup: () => {
        disposed = true;
        tabela._cleanup();
      },
      refresh: load,
    };
  };
}
