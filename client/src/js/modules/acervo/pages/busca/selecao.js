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
 * O `rotulo` e o `substantivo` existem porque a tela de PONTO DE CONTROLE usa
 * esta mesma selecao, e la o item nao tem `nome`: tem `cod_ponto`. Sem eles, os
 * chips diriam "Produto 12" para um ponto de controle.
 *
 * @param {Object} opts
 * @param {(ids:Set<number>)=>void} opts.onMudou
 * @param {(itens:Array<Object>, indice:number)=>void} opts.onVerFichas
 * @param {(item:Object)=>string} [opts.rotulo] - como o item se chama na tela
 * @param {[string,string]} [opts.substantivo] - singular e plural do contador
 */
export function criarSelecao({
  onMudou,
  onVerFichas,
  rotulo = p => p.nome || `Produto ${p.id}`,
  substantivo = ['produto selecionado', 'produtos selecionados'],
}) {
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
      ? `1 ${substantivo[0]}`
      : `${formatNumber(total)} ${substantivo[1]}`;

    // Os chips sao a unica forma de saber O QUE esta selecionado quando os
    // produtos estao em paginas diferentes. Cada um remove a si mesmo.
    listaChips.replaceChildren(...[...escolhidos.values()].map(p => el('span', {
      className: 'busca-selecao__chip',
      title: rotulo(p),
    }, [
      el('span', {
        className: 'busca-selecao__chip-nome',
        textContent: rotulo(p),
      }),
      el('button', {
        className: 'busca-selecao__chip-remover',
        type: 'button',
        'aria-label': `Remover ${rotulo(p)} da seleção`,
        textContent: '×',
        onClick: () => alternar(p),
      }),
    ])));
  }

  /** Alterna: selecionado sai, nao selecionado entra. */
  function alternar(item) {
    const id = Number(item.id);
    if (escolhidos.has(id)) escolhidos.delete(id);
    else escolhidos.set(id, item);
    pintar();
    onMudou(new Set(escolhidos.keys()));
  }

  /**
   * Alterna um GRUPO de itens de uma vez, com regra de tudo ou nada: se todos
   * ja estao selecionados, o grupo inteiro sai; senao, entra o que falta.
   *
   * POR QUE NAO E `itens.forEach(alternar)`. Alternando um a um, o resultado
   * depende do estado anterior de CADA item, e um clique sobre uma pilha de
   * poligonos removeria uns e acrescentaria outros na mesma acao. Quem clicou
   * pediu "estes", nao "inverta cada um destes".
   *
   * Tambem repinta e avisa UMA vez, e nao uma por item.
   */
  function alternarVarios(itens) {
    const lista = (itens || []).filter(Boolean);
    if (!lista.length) return;

    const todosDentro = lista.every(item => escolhidos.has(Number(item.id)));
    for (const item of lista) {
      const id = Number(item.id);
      if (todosDentro) escolhidos.delete(id);
      else escolhidos.set(id, item);
    }
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

  return { element, alternar, alternarVarios, limpar, tem, ids, produtos };
}
