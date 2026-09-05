import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { getPalavrasChave } from '@modules/acervo/services/acervo-service.js';

/**
 * Campo de palavra-chave com sugestao PROPRIA, em vez de `<datalist>`.
 *
 * O datalist nativo era o desenho anterior, e o problema dele e de altura: o
 * navegador escolhe sozinho quantas linhas mostrar, sem CSS que o alcance, e com
 * as vinte etiquetas que a rota devolve a lista abria cobrindo boa parte da tela.
 * Um popover nosso limita a altura, rola por dentro e
 * mantem o resto da tela visivel.
 *
 * O que se ganha junto, e que o datalist nao dava: a contagem de usos aparece
 * como texto de verdade (no datalist ela ia no atributo `label`, que so o
 * Firefox mostrava), navegar com as setas e escolher com Enter funciona igual em
 * todo navegador, e a lista e refeita a cada tecla contra o servidor, que ja
 * filtra por substring.
 */

/** Quantas linhas cabem antes de rolar. Vale junto com o max-height do CSS. */
const VISIVEIS = 8;
/** Espera antes de pedir sugestao ao servidor enquanto a pessoa digita. */
const ESPERA = 250;

/**
 * @param {{valorInicial?:string, onEscolher:Function}} opcoes
 *   `onEscolher` roda quando o valor e COMMITADO (clique na sugestao, Enter, ou
 *   sair do campo com o texto mudado), nunca a cada tecla: buscar a cada letra
 *   por etiqueta exata devolveria zero em todas as letras menos a ultima.
 * @returns {{element:HTMLElement, valor:Function, limpar:Function, _cleanup:Function}}
 */
export function criarCampoPalavraChave({ valorInicial = '', onEscolher }) {
  let sugestoes = [];
  let ativo = -1;
  let aberto = false;
  // Respostas fora de ordem nao podem repintar a lista de um termo antigo.
  let requisicao = 0;
  let temporizador = null;
  // Valor com que a busca corrente foi disparada, para nao repetir a mesma.
  let ultimoCommit = valorInicial;

  const lista = el('ul', {
    className: 'busca-palavras hidden',
    role: 'listbox',
    id: 'busca-palavras-lista',
  });

  const input = el('input', {
    className: 'busca-filtros__palavra',
    type: 'text',
    placeholder: 'Palavra-chave',
    'aria-label': 'Palavra-chave',
    autocomplete: 'off',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    'aria-controls': 'busca-palavras-lista',
    value: valorInicial,
    onInput: () => pedirSugestoes(),
    onFocus: () => pedirSugestoes(),
    onKeyDown: (e) => tratarTecla(e),
    onBlur: () => {
      // Sem espera, o `blur` fecharia a lista ANTES do clique na sugestao
      // chegar, e clicar nunca escolheria nada. O mousedown do item cancela.
      temporizador = setTimeout(() => { fechar(); commit(input.value); }, 150);
    },
  });

  // Nasce visivel quando o campo ja vem preenchido (a palavra-chave do link):
  // com a classe `hidden` fixa, quem abria `#/acervo/busca?palavra_chave=CDGV`
  // via a etiqueta aplicada e nenhum jeito de tira-la sem apagar letra a letra,
  // porque o × so aparecia na primeira tecla digitada.
  const limparBtn = el('button', {
    className: `busca-palavras__limpar${String(valorInicial).trim() ? '' : ' hidden'}`,
    type: 'button',
    'aria-label': 'Limpar a palavra-chave',
    onClick: () => {
      input.value = '';
      fechar();
      commit('');
      input.focus();
    },
  }, [svgIcon(ICONS.close, 14)]);

  const element = el('div', { className: 'busca-palavras-campo' }, [input, limparBtn, lista]);

  function commit(valor) {
    const limpo = valor.trim();
    limparBtn.classList.toggle('hidden', limpo === '');
    if (limpo === ultimoCommit) return;
    ultimoCommit = limpo;
    onEscolher(limpo);
  }

  function abrir() {
    if (!sugestoes.length) return fechar();
    aberto = true;
    lista.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  }

  function fechar() {
    aberto = false;
    ativo = -1;
    lista.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
  }

  function pintar() {
    lista.replaceChildren(...sugestoes.map((s, i) => {
      const item = el('li', {
        className: `busca-palavras__item${i === ativo ? ' busca-palavras__item--ativo' : ''}`,
        role: 'option',
        'aria-selected': i === ativo ? 'true' : 'false',
        // mousedown, e nao click: ele acontece ANTES do blur do input, entao
        // cancelar o fechamento aqui e o que faz o clique valer.
        onMouseDown: (e) => {
          e.preventDefault();
          clearTimeout(temporizador);
          escolher(i);
        },
        onMouseEnter: () => { ativo = i; marcar(); },
      }, [
        el('span', { className: 'busca-palavras__texto', textContent: s.palavra }),
        el('span', { className: 'busca-palavras__usos', textContent: formatNumber(s.usos) }),
      ]);
      return item;
    }));
    abrir();
  }

  /** So repinta a marca do item ativo: refazer a lista inteira pisca a tela. */
  function marcar() {
    const itens = [...lista.children];
    itens.forEach((item, i) => {
      item.classList.toggle('busca-palavras__item--ativo', i === ativo);
      item.setAttribute('aria-selected', i === ativo ? 'true' : 'false');
    });
    // O jsdom nao implementa scrollIntoView, e rolar aqui e conforto: sem o
    // guarda, navegar com as setas quebraria a pagina dentro da suite.
    const alvo = itens[ativo];
    if (alvo && typeof alvo.scrollIntoView === 'function') {
      alvo.scrollIntoView({ block: 'nearest' });
    }
  }

  function escolher(i) {
    const s = sugestoes[i];
    if (!s) return;
    input.value = s.palavra;
    fechar();
    commit(s.palavra);
  }

  function tratarTecla(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!aberto) return pintar();
      e.preventDefault();
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      ativo = (ativo + passo + sugestoes.length) % sugestoes.length;
      return marcar();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Com um item marcado, Enter escolhe ele; sem marca, vale o que foi
      // digitado. Exigir a escolha na lista impediria buscar etiqueta que a
      // sugestao (limitada a 20) nao trouxe.
      if (aberto && ativo >= 0) return escolher(ativo);
      fechar();
      return commit(input.value);
    }
    if (e.key === 'Escape' && aberto) {
      e.preventDefault();
      return fechar();
    }
    return undefined;
  }

  function pedirSugestoes() {
    clearTimeout(temporizador);
    const termo = input.value.trim();
    limparBtn.classList.toggle('hidden', termo === '');
    temporizador = setTimeout(async () => {
      const meuToken = ++requisicao;
      try {
        const dados = await getPalavrasChave(termo);
        if (meuToken !== requisicao) return;
        sugestoes = (dados || []).slice(0, VISIVEIS * 3);
        ativo = -1;
        pintar();
      } catch {
        // Sugestao que falha nao pode travar o campo: digitar a etiqueta na mao
        // continua funcionando, e e o caminho de quem ja sabe o nome dela.
        sugestoes = [];
        fechar();
      }
    }, ESPERA);
  }

  return {
    element,
    input,
    valor: () => input.value.trim(),
    limpar: () => {
      input.value = '';
      ultimoCommit = '';
      limparBtn.classList.add('hidden');
      fechar();
    },
    _cleanup: () => {
      clearTimeout(temporizador);
      requisicao += 1;
    },
  };
}
