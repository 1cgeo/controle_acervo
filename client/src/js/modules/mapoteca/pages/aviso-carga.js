import { el } from '@utils/dom.js';
import { estadoErro } from '@components/estado-erro.js';

/**
 * O lugar da tabela na pagina: ou a tabela, ou o estado de ERRO que impediu de
 * carrega-la.
 *
 * O DEFEITO QUE ISTO CORRIGE. A lista que falhava chamava
 * `table.update({ rows: [] })` e o data-table escrevia a mensagem de vazio dela:
 * "Nenhum cliente cadastrado", "Nenhum pedido neste ano. Troque o ano no
 * filtro". A tela afirmava que NAO HA dado quando o que houve foi falta de
 * resposta. As duas frases pedem acoes opostas: uma manda cadastrar ou trocar o
 * ano, a outra manda tentar de novo. O toast de erro sumia em segundos e a frase
 * errada ficava na tela.
 *
 * O estado de erro e o `estadoErro` de `@components/`, o MESMO que o acervo usa:
 * ele traz o botao "Tentar de novo" e o `role="alert"`. Uma copia daqui
 * divergiria dele na primeira correcao.
 *
 * A tabela SAI DO DOM no erro, e nao se esconde por CSS: escondida, o texto dela
 * continuaria no `textContent` da pagina, e a pagina ainda diria "nenhum
 * registro" embaixo de um erro (para o leitor de tela e para quem busca na
 * pagina).
 *
 * Sair do DOM nao desmonta a tabela: o estado dela (busca, ordem, pagina,
 * selecao) mora no OBJETO, e nao nos nos. Uma carga que der certo depois do erro
 * devolve a MESMA tabela, com tudo onde estava.
 *
 * Uso: ponha `corpo.element` na pagina NO LUGAR de `tabela.element`.
 *
 * @param {{element:HTMLElement}} tabela - o retorno de createDataTable
 * @param {Function} [recarregar] - o que o botao "Tentar de novo" chama
 * @returns {{element:HTMLElement, falhou:(mensagem:string)=>void,
 *   carregando:(texto:string)=>void, ok:()=>void}}
 */
export function criarAvisoDeErro(tabela, recarregar = null) {
  const element = el('div', {}, [tabela.element]);

  const por = (no) => {
    if (no.parentNode !== element) element.replaceChildren(no);
  };

  return {
    element,
    /** Tira a tabela da tela e poe o estado de erro no lugar dela. */
    falhou(mensagem) {
      // Nao passa pelo `por`: o no do erro e novo a cada falha, e a mensagem
      // pode ter mudado entre uma e outra.
      element.replaceChildren(estadoErro(
        new Error(mensagem),
        () => { if (recarregar) recarregar(); },
      ));
    },
    /**
     * A PRIMEIRA carga, que ainda nao tem tabela para preservar.
     *
     * Nao e erro, entao nao leva o botao "Tentar de novo" nem o `role="alert"`.
     * Recarga de tabela JA na tela nao passa por aqui: ela usa
     * `update({ loading: true })`, que preserva as linhas.
     */
    carregando(texto) {
      por(el('div', { className: 'data-table__empty', textContent: texto }));
    },
    /** Devolve a tabela, com a busca e a pagina onde estavam. */
    ok() {
      por(tabela.element);
    },
  };
}
