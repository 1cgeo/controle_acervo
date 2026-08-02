import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';

// O teto de 100 e do SERVIDOR (`gerencia_schema.paginationParams`, max 100).
// Oferecer 200 aqui produziria um 400 do Joi num combo de interface.
const TAMANHOS = [10, 20, 50, 100];

/**
 * Rodape de paginacao de SERVIDOR.
 *
 * O `data-table` pagina no CLIENTE: ele recebe a lista inteira e fatia. Isso
 * vale para tudo o que cabe numa resposta, e nao vale para as rotas paginadas do
 * `/gerencia` -- `arquivos_deletados` e a lapide do acervo INTEIRO, e trazer
 * tudo para fatiar no navegador seria pedir ao servidor exatamente o que a
 * paginacao dele existe para evitar.
 *
 * Entao a tabela recebe SO a pagina atual (`paginated: false`, senao ela
 * pagina de novo em cima de 20 linhas) e este componente desenha o rodape a
 * partir do que o servidor informou. As classes sao as MESMAS do `data-table`
 * (`pagination__*`), de proposito: e o mesmo controle, e dois rodapes com
 * aparencia diferente na mesma tela leriam como coisas diferentes.
 *
 * O que NAO vem junto e a BUSCA: a caixa de busca do `data-table` filtra as
 * linhas que ele tem, e sobre uma pagina de 20 ela diria "nenhum resultado"
 * para um registro que existe na pagina 7. Tela paginada no servidor nao ganha
 * busca de cliente.
 *
 * @param {Object} opcoes
 * @param {(pagina:number, tamanho:number)=>void} opcoes.onMudar
 * @returns {{element:HTMLElement, atualizar:(p:Object|null)=>void, tamanho:()=>number}}
 */
export function criarPaginacao({ onMudar }) {
  let tamanho = TAMANHOS[1];

  const element = el('div', { className: 'pagination' });

  /**
   * Repinta o rodape.
   * @param {{totalItems:number, totalPages:number, currentPage:number, pageSize:number}|null} p
   */
  function atualizar(p) {
    clearChildren(element);
    if (!p || !p.totalItems) return;

    const paginaAtual = p.currentPage || 1;
    const totalPaginas = p.totalPages || 1;
    const porPagina = p.pageSize || tamanho;
    tamanho = porPagina;

    const inicio = (paginaAtual - 1) * porPagina + 1;
    const fim = Math.min(paginaAtual * porPagina, p.totalItems);

    const selectTamanho = el('select', {
      className: 'pagination__select',
      'aria-label': 'Itens por página',
      onChange: (e) => {
        tamanho = parseInt(e.target.value, 10);
        // Volta para a primeira pagina: manter a pagina 7 ao passar de 20 para
        // 100 por pagina pularia o registro que a pessoa estava lendo.
        onMudar(1, tamanho);
      },
    }, TAMANHOS.map(t => el('option', { value: String(t), textContent: `${t} por página` })));
    selectTamanho.value = String(porPagina);

    const info = el('div', { className: 'pagination__info' }, [
      // O total e o do SERVIDOR, e nao o tamanho da lista na tela: dizer
      // "20 registros" numa lapide de 3.400 seria a informacao errada.
      el('span', { textContent: `${inicio}-${fim} de ${p.totalItems}` }),
      selectTamanho,
    ]);

    const anterior = el('button', {
      className: 'pagination__btn',
      'aria-label': 'Página anterior',
      onClick: () => { if (paginaAtual > 1) onMudar(paginaAtual - 1, tamanho); },
    }, [svgIcon(ICONS.chevronLeft, 18)]);
    anterior.disabled = paginaAtual <= 1;

    const proxima = el('button', {
      className: 'pagination__btn',
      'aria-label': 'Próxima página',
      onClick: () => { if (paginaAtual < totalPaginas) onMudar(paginaAtual + 1, tamanho); },
    }, [svgIcon(ICONS.chevronRight, 18)]);
    proxima.disabled = paginaAtual >= totalPaginas;

    element.appendChild(info);
    element.appendChild(el('div', { className: 'pagination__controls' }, [anterior, proxima]));
  }

  return { element, atualizar, tamanho: () => tamanho };
}
