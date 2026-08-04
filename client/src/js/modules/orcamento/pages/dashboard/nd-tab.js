import { el } from '@utils/dom.js';
import { formatCurrency } from '@utils/format.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { mostrarErro } from '@components/estado-erro.js';
import { getLinhas } from './secao3-store.js';

const COLS_BASE = [
  { key: 'cod_nd', label: 'Cód. ND' },
  { key: 'nd_nome', label: 'Natureza de Despesa', render: (row) => row.nd_nome || '-' },
];

/**
 * A linha TOTAL fica no FIM em qualquer ordenacao.
 *
 * O `data-table` joga nulo para o fim independente da direcao, entao devolver
 * nulo no `sortValue` da linha de total resolve sem tocar no componente. Sem
 * isto, ordenar por valor sobe o TOTAL para o meio da tabela, onde ele parece
 * uma ND a mais.
 */
const ehTotal = (row) => String(row.cod_nd).toUpperCase() === 'TOTAL';
const valorOuTotalNoFim = (campo) => (row) => (ehTotal(row) ? null : Number(row[campo] || 0));

/** Coluna de dinheiro: ordenavel, e com o TOTAL sempre no rodape. */
const colunaValor = (key, label) => ({
  key,
  label,
  sortable: true,
  sortValue: valorOuTotalNoFim(key),
  render: (row) => formatCurrency(row[key]),
});

/**
 * Colunas de cada recorte. O previsto so existe no PDR.
 *
 * O recolhido vem por ULTIMO, depois do liquidado, e nao logo apos o recebido:
 * e a ordem que o RPCMTec fixou em julho/2026. Ele e INFORMATIVO e nao desconta
 * do recebido; a coluna existe porque sem ela quem le o painel soma recebido
 * menos empenhado e conclui um saldo que nao existe.
 */
const RECORTES = {
  pdr: {
    colunas: [
      colunaValor('previsto', 'Previsto'),
      colunaValor('recebido_pdr', 'Recebido'),
      colunaValor('empenhado_pdr', 'Empenhado'),
      colunaValor('liquidado_pdr', 'Liquidado'),
      colunaValor('recolhido_pdr', 'Recolhido'),
    ],
    vazio: 'Sem execução PDR para o mês selecionado',
  },
  extra: {
    colunas: [
      colunaValor('recebido_extra', 'Recebido'),
      colunaValor('empenhado_extra', 'Empenhado'),
      colunaValor('liquidado_extra', 'Liquidado'),
      colunaValor('recolhido_extra', 'Recolhido'),
    ],
    vazio: 'Sem execução Extra-PDR para o mês selecionado',
  },
};

/**
 * Fabrica das abas de tabela por Natureza de Despesa.
 *
 * PDR e Extra-PDR saem da MESMA linha da execucao por ND, so mudam as colunas.
 * Ficavam empilhadas na mesma tela; como cada uma ja e larga, uma escondia a
 * outra atras da rolagem. Em abas, cada recorte usa a largura toda.
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
      // A consulta devolve uma linha por ND do dominio, mais o TOTAL: sao 11
      // linhas hoje, e paginar em 25 so acrescenta um rodape inutil.
      paginated: false,
      loading: true,
      emptyMessage: vazio,
      rowClassName: (row) => (ehTotal(row) ? 'data-table__row--total' : ''),
    });

    // O conteudo vive num no proprio para o estado de erro poder tomar a aba
    // inteira e devolve-la depois, sem recriar a tabela.
    const conteudo = el('div', {}, [tabela.element]);
    container.appendChild(conteudo);

    async function load() {
      // Uma recarga (troca de mes ou de ano) enquanto o erro esta na tela tem
      // de devolver a tabela antes de pintar nela.
      if (!container.contains(conteudo)) container.replaceChildren(conteudo);

      tabela.update({ loading: true });
      try {
        const rows = getLinhas(await store.carregar());
        if (disposed) return;
        tabela.update({ rows, loading: false });
      } catch (err) {
        if (disposed) return;
        // Estado de ERRO proprio, e nao lista vazia. Zerar as linhas fazia a
        // tabela dizer "Sem execução PDR para o mês selecionado": a falha da
        // API lia-se como ausencia de execucao, e as duas pedem acoes opostas.
        tabela.update({ rows: [], loading: false });
        mostrarErro(container, err, load);
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
