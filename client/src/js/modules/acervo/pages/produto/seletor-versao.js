import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { formatDate } from '@utils/format.js';
import { buscarProdutos, getProdutoDetalhado } from '@modules/acervo/services/acervo-service.js';

/**
 * Escolher uma VERSAO do acervo, em dois passos: acha o produto, escolhe a
 * versao dele.
 *
 * Existe porque a rota de relacionamento pede `versao_id`, que e um inteiro
 * sequencial: sem esta tela, criar um vinculo exigiria saber de cor o id da
 * versao do outro produto, ou abrir a ficha dele num segundo separador para
 * copiar o numero. Ninguem sabe esse numero.
 *
 * A busca reusa `/acervo/busca` (a MESMA da tela de busca), e nao um endpoint
 * proprio: as duas respondem "que produto e este", e uma segunda consulta com
 * regra propria acabaria achando coisa diferente da busca principal.
 *
 * A ergonomia do campo e a do popover de palavra-chave (`pages/busca/
 * palavra-chave.js`): setas navegam, Enter escolhe, Escape fecha. E o mesmo
 * gesto, e por isso a mesma implementacao, e nao um `<datalist>`.
 */

/** Espera antes de perguntar ao servidor enquanto a pessoa digita. */
const ESPERA = 300;
/** Quantos produtos a lista oferece. Mais que isto vira rolagem sem serventia. */
const LIMITE = 12;

/**
 * @param {Object} [opcoes]
 * @param {string} [opcoes.titulo]
 * @param {number} [opcoes.versaoExcluida] - versao que NAO pode ser escolhida
 *   (a propria, no caso de relacionamento: o servidor recusa auto-relacionamento
 *   e a tela nao deve oferecer o que sabe que sera recusado)
 * @returns {Promise<{versao_id:number, rotulo:string, produto_nome:string}|null>}
 *   null quando a pessoa fecha sem escolher
 */
export function abrirSeletorVersao({
  titulo = 'Escolher versão',
  versaoExcluida = null,
} = {}) {
  return new Promise((resolve) => {
    let escolhido = null;
    let produtos = [];
    let ativo = -1;
    let aberto = false;
    // Respostas fora de ordem nao podem repintar a lista de um termo antigo.
    let requisicao = 0;
    let temporizador = null;
    let produtoEscolhido = null;

    const lista = el('ul', {
      className: 'seletor-versao__sugestoes hidden',
      role: 'listbox',
      id: 'seletor-versao-lista',
    });

    const input = el('input', {
      className: 'form-field__input',
      type: 'text',
      placeholder: 'Nome, MI ou INOM do produto',
      'aria-label': 'Buscar produto',
      autocomplete: 'off',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      'aria-controls': 'seletor-versao-lista',
      onInput: () => pedirProdutos(),
      onKeyDown: (e) => tratarTecla(e),
    });

    const painelVersoes = el('div', { className: 'seletor-versao__versoes' });

    const conteudo = el('div', { className: 'seletor-versao' }, [
      el('div', { className: 'seletor-versao__campo' }, [
        el('label', { className: 'form-field__label', textContent: 'Produto' }),
        input,
        lista,
      ]),
      painelVersoes,
    ]);

    pintarVersoes();

    function fechar() {
      aberto = false;
      ativo = -1;
      lista.classList.add('hidden');
      input.setAttribute('aria-expanded', 'false');
    }

    function abrir() {
      if (!produtos.length) return fechar();
      aberto = true;
      lista.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
    }

    /** So repinta a marca do item ativo: refazer a lista inteira pisca a tela. */
    function marcar() {
      const itens = [...lista.children];
      itens.forEach((item, i) => {
        item.classList.toggle('seletor-versao__item--ativo', i === ativo);
        item.setAttribute('aria-selected', i === ativo ? 'true' : 'false');
      });
      const alvo = itens[ativo];
      // O jsdom nao implementa scrollIntoView, e rolar aqui e conforto: sem o
      // guarda, navegar com as setas quebraria a pagina dentro da suite.
      if (alvo && typeof alvo.scrollIntoView === 'function') {
        alvo.scrollIntoView({ block: 'nearest' });
      }
    }

    function pintarSugestoes() {
      lista.replaceChildren(...produtos.map((p, i) => el('li', {
        className: `seletor-versao__item${i === ativo ? ' seletor-versao__item--ativo' : ''}`,
        role: 'option',
        'aria-selected': i === ativo ? 'true' : 'false',
        // mousedown, e nao click: ele acontece ANTES do blur do campo.
        onMouseDown: (e) => {
          e.preventDefault();
          escolherProduto(i);
        },
        onMouseEnter: () => { ativo = i; marcar(); },
      }, [
        el('span', {
          className: 'seletor-versao__item-nome',
          textContent: p.nome || `Produto ${p.id}`,
        }),
        el('span', {
          className: 'seletor-versao__item-id',
          textContent: [p.mi, p.inom, p.escala].filter(Boolean).join(' · '),
        }),
      ])));
      abrir();
    }

    function pedirProdutos() {
      clearTimeout(temporizador);
      const termo = input.value.trim();
      if (!termo) {
        produtos = [];
        fechar();
        return;
      }

      temporizador = setTimeout(async () => {
        const meuToken = ++requisicao;
        try {
          const resposta = await buscarProdutos({ termo, page: 1, limit: LIMITE });
          if (meuToken !== requisicao) return;
          produtos = resposta.dados || [];
          ativo = -1;
          pintarSugestoes();
        } catch {
          // Falha de busca nao trava o diálogo: a pessoa tenta outro termo. Um
          // aviso vermelho a cada tecla seria pior do que a lista vazia.
          produtos = [];
          fechar();
        }
      }, ESPERA);
    }

    function tratarTecla(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!aberto) return pintarSugestoes();
        e.preventDefault();
        const passo = e.key === 'ArrowDown' ? 1 : -1;
        ativo = (ativo + passo + produtos.length) % produtos.length;
        return marcar();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (aberto && ativo >= 0) return escolherProduto(ativo);
        return undefined;
      }
      if (e.key === 'Escape' && aberto) {
        // Para o Escape aqui: no modal ele fecharia a janela inteira, e quem o
        // apertou com a lista aberta queria fechar A LISTA.
        e.preventDefault();
        e.stopPropagation();
        return fechar();
      }
      return undefined;
    }

    /**
     * Pinta o passo 2: as versoes do produto escolhido.
     *
     * A versao EXCLUIDA aparece desabilitada, e nao some: some-la faria a ficha
     * parecer ter uma versao a menos, e quem esta ligando uma versao a outra
     * precisa entender por que aquela nao esta disponivel.
     */
    function pintarVersoes(estado = 'vazio') {
      if (estado === 'carregando') {
        painelVersoes.replaceChildren(
          el('p', { className: 'seletor-versao__aviso', textContent: 'Carregando versões...' })
        );
        return;
      }

      if (!produtoEscolhido) {
        painelVersoes.replaceChildren(el('p', {
          className: 'seletor-versao__aviso',
          textContent: 'Busque um produto para ver as versões dele.',
        }));
        return;
      }

      const versoes = produtoEscolhido.versoes || [];
      if (!versoes.length) {
        painelVersoes.replaceChildren(el('p', {
          className: 'seletor-versao__aviso',
          textContent: 'Este produto não tem versão cadastrada.',
        }));
        return;
      }

      painelVersoes.replaceChildren(
        el('span', {
          className: 'seletor-versao__titulo',
          textContent: `Versões de ${produtoEscolhido.nome || `produto ${produtoEscolhido.id}`}`,
        }),
        el('ul', { className: 'seletor-versao__lista' }, versoes.map((v) => {
          const id = Number(v.versao_id);
          const proibida = versaoExcluida !== null && id === Number(versaoExcluida);

          const botao = el('button', {
            className: `seletor-versao__versao${escolhido === id ? ' seletor-versao__versao--marcada' : ''}`,
            type: 'button',
            title: proibida ? 'É a própria versão' : `Escolher ${v.versao}`,
            onClick: () => {
              escolhido = id;
              pintarVersoes();
            },
          }, [
            el('span', { textContent: v.versao || `Versão ${id}` }),
            el('span', {
              className: 'seletor-versao__versao-data',
              textContent: formatDate(v.versao_data_edicao) || '',
            }),
          ]);
          botao.disabled = proibida;

          return el('li', {}, [botao]);
        }))
      );
    }

    async function escolherProduto(indice) {
      const p = produtos[indice];
      if (!p) return;
      input.value = p.nome || p.mi || `Produto ${p.id}`;
      fechar();
      escolhido = null;
      produtoEscolhido = null;
      pintarVersoes('carregando');

      const meuToken = ++requisicao;
      try {
        const ficha = await getProdutoDetalhado(p.id);
        if (meuToken !== requisicao) return;
        produtoEscolhido = ficha;
        pintarVersoes();
      } catch (erro) {
        if (meuToken !== requisicao) return;
        painelVersoes.replaceChildren(el('p', {
          className: 'seletor-versao__aviso',
          textContent: erro.message || 'Não foi possível carregar as versões',
        }));
      }
    }

    let confirmado = null;

    openModal({
      title: titulo,
      content: conteudo,
      width: '620px',
      // Resolve UMA vez, no fechamento: cancelar, Escape e clicar fora são a
      // mesma coisa para quem chamou (ninguém escolheu), e tratar cada caminho
      // separado deixaria um deles sem resposta e a promessa pendurada.
      onClose: () => {
        clearTimeout(temporizador);
        resolve(confirmado);
      },
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Escolher',
          variant: 'primary',
          onClick: ({ close }) => {
            if (!escolhido) return;
            const versao = (produtoEscolhido.versoes || [])
              .find(v => Number(v.versao_id) === escolhido);
            confirmado = {
              versao_id: escolhido,
              rotulo: versao ? versao.versao : String(escolhido),
              produto_nome: produtoEscolhido.nome || `Produto ${produtoEscolhido.id}`,
            };
            close();
          },
        },
      ],
    });

    // O foco começa no campo de busca: é sempre o primeiro passo, e o modal
    // sozinho focaria o primeiro elemento focável, que aqui é o mesmo, mas isto
    // continua valendo se um campo entrar antes dele.
    input.focus();
  });
}
