import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { chip } from '@components/status-chip.js';
import { showError } from '@utils/toast.js';
import { getProdutoDetalhado } from '@modules/acervo/services/acervo-service.js';

function linha(rotulo, valor) {
  return el('div', { className: 'detail-card__row' }, [
    el('span', { className: 'detail-card__label', textContent: rotulo }),
    valor instanceof Node
      ? valor
      : el('span', { className: 'detail-card__value', textContent: valor || '-' }),
  ]);
}

/**
 * Plural de verdade, em vez de "1 versão(ões)".
 *
 * O "(s)" e "(ões)" existem para o programador nao pensar, e o preco quem paga
 * e quem le. Com a contagem em maos, escolher a palavra e uma linha.
 * @param {number} n
 * @param {string} singular
 * @param {string} plural
 */
export function plural(n, singular, plural_) {
  const total = Number(n) || 0;
  return `${formatNumber(total)} ${total === 1 ? singular : plural_}`;
}

/**
 * Uma versao do produto, com os arquivos que ela tem.
 *
 * Versao SEM arquivo aparece marcada, e nao escondida: "registrado, sem arquivo
 * digital" e informacao, e e o caso da versao historica (chefe, 2026-07-25).
 * Esconder faria a ficha mentir sobre quantas versoes existem.
 */
function blocoVersao(v) {
  const arquivos = v.arquivos || [];

  const cabecalho = el('div', { className: 'versao-bloco__cabecalho' }, [
    el('span', { className: 'versao-bloco__titulo', textContent: v.versao || v.nome_versao || 'Versão' }),
    arquivos.length
      ? chip(plural(arquivos.length, 'arquivo', 'arquivos'), 'info')
      : chip('Sem arquivo digital', 'default'),
  ]);

  const meta = el('div', { className: 'versao-bloco__meta' }, [
    linha('Edição', formatDate(v.versao_data_edicao)),
    linha('Criação', formatDate(v.versao_data_criacao)),
    linha('Órgão produtor', v.orgao_produtor),
    v.lote_nome ? linha('Lote', v.lote_nome) : null,
    v.projeto_nome ? linha('Projeto', v.projeto_nome) : null,
  ]);

  const palavras = (v.palavras_chave || []).length
    ? el('div', { className: 'busca-chips' }, v.palavras_chave.map(p => chip(p, 'secondary')))
    : null;

  // Nome e tamanho bastam: a lista de arquivos aqui e para saber o que existe,
  // e baixar ainda nao entrou em cena (fase 1 do portal, nao feita).
  const listaArquivos = arquivos.length
    ? el('ul', { className: 'versao-bloco__arquivos' }, arquivos.map(a => el('li', {}, [
      svgIcon(ICONS.description, 14),
      el('span', { textContent: a.nome || a.nome_arquivo || 'arquivo' }),
      a.tamanho_mb != null
        ? el('span', {
          className: 'versao-bloco__tamanho',
          textContent: `${formatNumber(Number(a.tamanho_mb).toFixed(1))} MB`,
        })
        : null,
    ])))
    : null;

  return el('div', { className: 'versao-bloco' }, [cabecalho, meta, palavras, listaArquivos]);
}

/**
 * Ficha do produto: identificacao e todas as versoes.
 *
 * Recebe uma LISTA, e nao um produto, porque a busca permite selecionar varios.
 * Abrir uma janela por produto selecionado seria uma pilha de modais; aqui e um
 * modal so, com "anterior" e "proxima" percorrendo a selecao, e um contador
 * dizendo onde a pessoa esta.
 *
 * Abre com o aviso de carregando e busca depois: a ficha vem de um endpoint que
 * traz versoes, arquivos e relacionamentos, e prender o clique ate a resposta
 * daria a sensacao de que o botao nao funcionou.
 *
 * @param {Array<{id:number, nome:string}>|Object} produtos - a selecao, ou um so
 * @param {number} [indiceInicial]
 */
export function abrirProdutoDialog(produtos, indiceInicial = 0) {
  const lista = Array.isArray(produtos) ? produtos : [produtos];
  if (!lista.length) return null;

  let indice = Math.min(Math.max(indiceInicial, 0), lista.length - 1);
  // Fichas ja buscadas: voltar para a anterior nao refaz a requisicao.
  const cache = new Map();
  // Respostas fora de ordem nao podem pintar a ficha do produto errado.
  let requisicao = 0;
  let fechado = false;

  const corpo = el('div', { className: 'produto-ficha' });
  const posicao = el('span', { className: 'produto-ficha__posicao' });

  const btnAnterior = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => irPara(indice - 1),
  }, [svgIcon(ICONS.arrowBack, 16), 'Anterior']);

  const btnProxima = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => irPara(indice + 1),
  }, ['Próxima']);

  const navegacao = el('div', { className: 'produto-ficha__nav' }, [
    btnAnterior, posicao, btnProxima,
  ]);

  // A navegacao so existe quando ha mais de um: com um produto so, uma barra
  // com dois botoes desativados e ruido.
  const raiz = el('div', {}, [lista.length > 1 ? navegacao : null, corpo]);

  function tituloDe(p) {
    return (p && p.nome) || `Produto ${p && p.id}`;
  }

  const modal = openModal({
    title: tituloDe(lista[indice]),
    content: raiz,
    width: '760px',
    onClose: () => { fechado = true; },
    actions: [{ label: 'Fechar', variant: 'text', onClick: ({ close }) => close() }],
  });

  const tituloEl = modal.element.querySelector('.modal__title');

  function pintarFicha(d) {
    const versoes = d.versoes || [];
    corpo.replaceChildren(
      el('div', { className: 'detail-card' }, [
        linha('MI', d.mi),
        linha('INOM', d.inom),
        linha('Escala', d.denominador_escala_especial
          ? `1:${formatNumber(d.denominador_escala_especial)}`
          : d.escala),
        linha('Descrição', d.descricao),
        linha('Cadastrado em', formatDate(d.data_cadastramento)),
      ]),
      el('h3', {
        className: 'produto-ficha__secao',
        textContent: plural(versoes.length, 'versão', 'versões'),
      }),
      ...(versoes.length
        ? versoes.map(blocoVersao)
        : [el('p', {
          className: 'produto-ficha__vazio',
          textContent: 'Este produto ainda não tem versão cadastrada.',
        })])
    );
  }

  function carregar(produto, meuToken) {
    getProdutoDetalhado(produto.id)
      .then((d) => {
        cache.set(produto.id, d);
        if (fechado || meuToken !== requisicao) return;
        pintarFicha(d);
      })
      .catch((err) => {
        if (fechado || meuToken !== requisicao) return;
        corpo.replaceChildren(el('p', {
          className: 'produto-ficha__vazio',
          textContent: err.message || 'Erro ao carregar a ficha do produto',
        }));
        showError(err.message || 'Erro ao carregar a ficha do produto');
      });
  }

  function pintar() {
    const produto = lista[indice];
    if (tituloEl) tituloEl.textContent = tituloDe(produto);
    posicao.textContent = `${indice + 1} de ${lista.length}`;
    btnAnterior.disabled = indice === 0;
    btnProxima.disabled = indice === lista.length - 1;

    const meuToken = ++requisicao;

    if (cache.has(produto.id)) {
      pintarFicha(cache.get(produto.id));
      return;
    }

    corpo.replaceChildren(el('p', {
      className: 'produto-ficha__carregando',
      textContent: 'Carregando a ficha do produto...',
    }));
    carregar(produto, meuToken);
  }

  function irPara(novo) {
    if (novo < 0 || novo >= lista.length) return;
    indice = novo;
    pintar();
  }

  pintar();

  return modal;
}
