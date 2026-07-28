import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';

/**
 * Selecao de produtos da busca.
 *
 * O estado mora aqui, e nao espalhado pela pagina, porque tres coisas dependem
 * dele ao mesmo tempo: o realce no mapa, a marca no cartao e a barra de acoes.
 * Com o estado num lugar so, "selecionar" e uma operacao, e nao tres em fila.
 *
 * A selecao guarda o PRODUTO inteiro, e nao so o id. O motivo e a ficha: os
 * selecionados podem estar em paginas que ja sairam da tela, e sem os dados
 * guardados a barra nao teria como listar o que a pessoa escolheu.
 *
 * @param {Object} opts
 * @param {(ids:Set<number>)=>void} opts.onMudou
 * @param {(produtos:Array<Object>, indice:number)=>void} opts.onVerFichas
 */
export function criarSelecao({ onMudou, onVerFichas }) {
  /** @type {Map<number, Object>} id -> produto */
  const escolhidos = new Map();

  const contador = el('span', { className: 'busca-selecao__contador' });

  const btnFichas = el('button', {
    className: 'btn btn--primary btn--sm',
    type: 'button',
    onClick: () => {
      if (!escolhidos.size) return;
      onVerFichas([...escolhidos.values()], 0);
    },
  }, [svgIcon(ICONS.visibility, 16), 'Ver fichas']);

  const btnLimpar = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => limpar(),
  }, [svgIcon(ICONS.close, 16), 'Limpar']);

  const listaChips = el('div', { className: 'busca-selecao__chips' });

  const element = el('div', {
    className: 'busca-selecao hidden',
    role: 'region',
    'aria-label': 'Produtos selecionados',
  }, [
    el('div', { className: 'busca-selecao__topo' }, [contador, el('div', { className: 'busca-selecao__acoes' }, [btnFichas, btnLimpar])]),
    listaChips,
  ]);

  function pintar() {
    const total = escolhidos.size;
    element.classList.toggle('hidden', total === 0);
    contador.textContent = total === 1
      ? '1 produto selecionado'
      : `${formatNumber(total)} produtos selecionados`;

    // Os chips sao a unica forma de saber O QUE esta selecionado quando os
    // produtos estao em paginas diferentes. Cada um remove a si mesmo.
    listaChips.replaceChildren(...[...escolhidos.values()].map(p => el('span', {
      className: 'busca-selecao__chip',
      title: p.nome || `Produto ${p.id}`,
    }, [
      el('span', {
        className: 'busca-selecao__chip-nome',
        textContent: p.nome || `Produto ${p.id}`,
      }),
      el('button', {
        className: 'busca-selecao__chip-remover',
        type: 'button',
        'aria-label': `Remover ${p.nome || p.id} da seleção`,
        textContent: '×',
        onClick: () => alternar(p),
      }),
    ])));
  }

  /** Alterna: selecionado sai, nao selecionado entra. */
  function alternar(produto) {
    const id = Number(produto.id);
    if (escolhidos.has(id)) escolhidos.delete(id);
    else escolhidos.set(id, produto);
    pintar();
    onMudou(new Set(escolhidos.keys()));
  }

  function limpar() {
    if (!escolhidos.size) return;
    escolhidos.clear();
    pintar();
    onMudou(new Set());
  }

  function tem(id) {
    return escolhidos.has(Number(id));
  }

  function ids() {
    return new Set(escolhidos.keys());
  }

  function produtos() {
    return [...escolhidos.values()];
  }

  pintar();

  return { element, alternar, limpar, tem, ids, produtos };
}
