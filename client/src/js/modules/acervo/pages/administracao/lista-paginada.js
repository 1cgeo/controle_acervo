import { el } from '@utils/dom.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { criarPaginacao } from '@components/paginacao/paginacao.js';

/**
 * O esqueleto das três listas de diagnóstico que paginam NO SERVIDOR.
 *
 * As três (arquivos com problema, arquivos excluídos, downloads excluídos) são
 * a mesma coisa com colunas diferentes: leitura pura, sem ação de linha, com
 * `page`/`limit` na query e `pagination` ao lado de `dados`. Escrever a terceira
 * cópia deste laço foi o que fez a lápide do arquivo excluído viver em três
 * lugares no servidor até 2026-08-02, e é o mesmo erro em outra camada.
 *
 * O QUE ELE FAZ QUE UMA TABELA SOZINHA NÃO FAZ:
 *  - `paginated: false` na tabela, senão ela pagina de novo em cima das 20
 *    linhas que o servidor já paginou, e o rodapé de baixo diria outra coisa;
 *  - `searchable: false`, porque a busca do `data-table` filtra as linhas que
 *    ele TEM: sobre uma página de 20 ela diria "nenhum resultado" para um
 *    registro que existe na página 7;
 *  - descarta resposta atrasada (`requisicao`), senão virar duas páginas
 *    depressa deixa a primeira resposta pintar por cima da segunda.
 *
 * @param {Object} cfg
 * @param {HTMLElement} cfg.container
 * @param {string} cfg.intro - a linha que diz o que esta lista é
 * @param {Array<Object>} cfg.colunas - colunas do data-table
 * @param {(opcoes:{page:number, limit:number})=>Promise<{dados:Array, pagination:Object}>} cfg.carregar
 * @param {string} cfg.vazio - texto de lista vazia
 * @param {string} cfg.erro - texto do aviso quando a carga falha
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function montarListaPaginada({ container, intro, colunas, carregar, vazio, erro }) {
  let disposed = false;
  let requisicao = 0;
  let pagina = 1;

  const tabela = createDataTable({
    columns: colunas,
    rows: [],
    paginated: false,
    searchable: false,
    loading: true,
    emptyMessage: vazio,
  });

  const paginacao = criarPaginacao({
    onMudar: (novaPagina, tamanho) => {
      pagina = novaPagina;
      load(tamanho);
    },
  });

  container.appendChild(el('div', {}, [
    el('p', { className: 'page__subtitle', textContent: intro }),
    tabela.element,
    paginacao.element,
  ]));

  async function load(tamanho = paginacao.tamanho()) {
    const meu = ++requisicao;
    tabela.update({ loading: true });
    try {
      const resposta = await carregar({ page: pagina, limit: tamanho });
      if (disposed || meu !== requisicao) return;
      tabela.update({ rows: resposta.dados || [], loading: false });
      paginacao.atualizar(resposta.pagination);
    } catch (err) {
      if (disposed || meu !== requisicao) return;
      tabela.update({ rows: [], loading: false });
      paginacao.atualizar(null);
      showError(err.message || erro);
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      requisicao++;
      tabela._cleanup();
    },
    // Recarrega a pagina ATUAL, e nao a primeira: quem estava na pagina 7 da
    // lapide continua nela.
    refresh: () => load(),
  };
}
