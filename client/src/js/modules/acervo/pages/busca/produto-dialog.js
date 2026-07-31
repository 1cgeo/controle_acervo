import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { chip } from '@components/status-chip.js';
import { showError } from '@utils/toast.js';
import {
  getProdutoDetalhado,
  getMiniaturaVersao,
  baixarArquivoDoAcervo,
} from '@modules/acervo/services/acervo-service.js';

/**
 * Ficha do produto.
 *
 * O DESENHO, e o que ele corrige (chefe, 2026-07-31: "a UI e UX esta ruim").
 * A ficha anterior era uma pilha de linhas rotulo-valor, todas com o mesmo peso
 * visual, e sem CSS proprio: MI, INOM, escala, descricao e data de cadastro
 * saiam iguais, e cada versao repetia o mesmo bloco de metadado administrativo
 * ANTES dos arquivos, que e o que a pessoa veio buscar. Tres mudancas:
 *
 *   1. IMAGEM. Quem procura carta reconhece a folha OLHANDO. A miniatura entra
 *      ao lado de cada versao, e a mais recente abre com a imagem maior. Sem
 *      imagem (produto so vetorial), o espaco nao fica vazio: entra uma marca
 *      dizendo que aquela versao nao tem raster.
 *   2. HIERARQUIA. A identificacao vira uma faixa de fatos curtos (MI, INOM,
 *      escala, versoes), com o valor grande e o rotulo pequeno. Na versao, o
 *      que sobe sao os ARQUIVOS; o metadado administrativo (orgao, lote,
 *      projeto, datas) desce para uma linha unica separada por ponto.
 *   3. RELACIONAMENTOS. O servidor sempre mandou, e a tela jogava fora. Agora
 *      aparecem, com o nome do produto relacionado, e navegam para ele.
 */

const LARGURA_MODAL = '1040px';

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

// Tileserver e uma URL de servico, sem byte em volume nenhum; status diferente de
// 'Carregado' (1) significa que o carregamento ou a exclusao falhou, e o byte no
// volume pode estar pela metade. O servidor recusa os dois casos, e a tela
// desabilita o botao para nao prometer um download que vai dar erro.
const TIPO_ARQUIVO_TILESERVER = 9;
const STATUS_ARQUIVO_CARREGADO = 1;

function podeBaixar(a) {
  return Boolean(a.uuid_arquivo)
    && a.tipo_arquivo_id !== TIPO_ARQUIVO_TILESERVER
    && (a.tipo_status_id == null || a.tipo_status_id === STATUS_ARQUIVO_CARREGADO);
}

/** Nome fisico do arquivo, que e o que a pessoa encontra no disco. */
function nomeFisico(a) {
  return a.extensao ? `${a.nome_arquivo}.${a.extensao}` : a.nome_arquivo;
}

/**
 * Um fato da faixa de identificacao: valor grande em cima, rotulo pequeno
 * embaixo. E o inverso da linha rotulo-valor, e e o que faz MI e INOM saltarem
 * aos olhos: sao eles que identificam a folha, nao a palavra "MI".
 */
function fato(rotulo, valor, mono = false) {
  if (valor == null || valor === '') return null;
  return el('div', { className: 'ficha-fato' }, [
    el('span', {
      className: `ficha-fato__valor${mono ? ' ficha-fato__valor--mono' : ''}`,
      textContent: String(valor),
    }),
    el('span', { className: 'ficha-fato__rotulo', textContent: rotulo }),
  ]);
}

/**
 * Fatos administrativos da versao, numa linha so, separados por ponto.
 *
 * O separador entra DENTRO do item seguinte, e nao entre os dois. Sendo um
 * elemento proprio, ele quebrava linha sozinho e a linha terminava com um "·"
 * orfao, apontando para nada.
 */
function linhaMeta(partes) {
  const vivos = partes.filter(p => p && p.valor);
  if (!vivos.length) return null;

  return el('div', { className: 'ficha-meta' }, vivos.map((p, i) => (
    el('span', { className: 'ficha-meta__item' }, [
      i ? el('span', { className: 'ficha-meta__ponto', textContent: '· ' }) : null,
      el('span', { className: 'ficha-meta__rotulo', textContent: `${p.rotulo} ` }),
      el('span', { className: 'ficha-meta__valor', textContent: p.valor }),
    ].filter(Boolean))
  )));
}

/**
 * Botao de baixar UM arquivo do acervo.
 *
 * O servidor le o volume e faz stream, entao o navegador nunca ve caminho de
 * rede. O nome do arquivo baixado e o nome FISICO, derivado do cadastro: e o
 * mesmo nome que o plugin do QGIS recebe, e o que a pessoa espera no disco.
 * @param {Object} a - arquivo da ficha
 */
function botaoBaixar(a) {
  const nome = nomeFisico(a);

  const botao = el('button', {
    className: 'btn btn--text btn--sm ficha-arquivo__baixar',
    type: 'button',
    title: podeBaixar(a) ? `Baixar ${nome}` : 'Este arquivo não tem download',
  }, [svgIcon(ICONS.download, 14), 'Baixar']);

  if (!podeBaixar(a)) {
    botao.disabled = true;
    return botao;
  }

  botao.addEventListener('click', async () => {
    // A referencia vem do FECHAMENTO, e nao de `e.currentTarget`: depois do
    // primeiro await o evento terminou e `currentTarget` e null, entao o botao
    // ficaria travado para sempre depois de uma falha.
    botao.disabled = true;
    try {
      await baixarArquivoDoAcervo(a.uuid_arquivo, nome);
    } catch (erro) {
      showError(erro.message || 'Não foi possível baixar o arquivo');
    } finally {
      botao.disabled = false;
    }
  });

  return botao;
}

/**
 * Uma linha de arquivo.
 *
 * O NOME que aparece e o fisico, e nao o rotulo do cadastro, porque e o nome
 * fisico que sai no download e que a pessoa vai procurar depois. O rotulo do
 * cadastro (`nome`) vira o titulo, para quem quiser conferir.
 */
function linhaArquivo(a) {
  const tamanho = a.tamanho_mb != null
    ? `${formatNumber(Number(a.tamanho_mb).toFixed(1))} MB`
    : '';

  return el('li', { className: 'ficha-arquivo', title: a.nome || '' }, [
    svgIcon(ICONS.description, 16),
    el('span', { className: 'ficha-arquivo__nome', textContent: nomeFisico(a) || 'arquivo' }),
    a.tipo_arquivo
      ? el('span', { className: 'ficha-arquivo__tipo', textContent: a.tipo_arquivo })
      : null,
    el('span', { className: 'ficha-arquivo__tamanho', textContent: tamanho }),
    botaoBaixar(a),
  ].filter(Boolean));
}

/**
 * Relacionamentos da versao.
 *
 * O servidor sempre devolveu isto e a tela anterior descartava em silencio. Um
 * insumo ou um conjunto e informacao de proveniencia: e o que responde "de onde
 * veio esta carta". Cada item leva para a ficha do produto relacionado.
 */
function blocoRelacionamentos(relacionamentos, irParaProduto) {
  if (!relacionamentos || !relacionamentos.length) return null;

  return el('div', { className: 'ficha-relacionamentos' }, [
    el('span', { className: 'ficha-relacionamentos__titulo', textContent: 'Relacionadas' }),
    el('ul', { className: 'ficha-relacionamentos__lista' }, relacionamentos.map((r) => {
      const alvo = [r.produto_relacionado, r.versao_relacionada].filter(Boolean).join(', ');

      const conteudo = () => [
        chip(r.tipo_relacionamento || 'Relação', 'secondary'),
        el('span', {
          className: 'ficha-relacionamentos__alvo',
          textContent: alvo || `versão ${r.versao_relacionada_id}`,
        }),
      ];

      // So vira link quando ha para onde ir. Relacionamento apontando para
      // versao apagada continua aparecendo (a proveniencia existiu), mas como
      // texto: link que nao leva a lugar nenhum e pior que texto.
      if (!r.produto_relacionado_id) {
        return el('li', { className: 'ficha-relacionamentos__item' }, conteudo());
      }

      return el('li', { className: 'ficha-relacionamentos__item' }, [
        el('button', {
          className: 'ficha-relacionamentos__link',
          type: 'button',
          title: `Abrir a ficha de ${alvo}`,
          onClick: () => irParaProduto({
            id: Number(r.produto_relacionado_id),
            nome: r.produto_relacionado,
          }),
        }, conteudo()),
      ]);
    })),
  ]);
}

/**
 * Painel da miniatura.
 *
 * A imagem chega DEPOIS da ficha, por uma segunda requisicao. O painel ja nasce
 * com a proporcao certa (largura e altura vem na ficha detalhada), para o bloco
 * nao pular de tamanho quando a imagem chega. Sem miniatura, o painel diz por
 * que, em vez de sumir: espaco vazio pareceria carregamento travado.
 *
 * @param {Object} v versao
 * @param {boolean} destaque a versao mais recente abre com a imagem maior
 * @param {Function} registrarUrl recebe a URL de objeto, para liberar no fim
 */
function painelMiniatura(v, destaque, registrarUrl) {
  const classe = `ficha-miniatura${destaque ? ' ficha-miniatura--destaque' : ''}`;

  if (!v.tem_miniatura) {
    return el('div', { className: `${classe} ficha-miniatura--vazia` }, [
      svgIcon(ICONS.layers, 20),
      el('span', { textContent: 'Sem imagem' }),
    ]);
  }

  const painel = el('div', { className: classe });

  // Reserva a proporcao antes de a imagem chegar. Sem isto, a lista inteira de
  // versoes salta para baixo a cada imagem que carrega.
  if (v.miniatura_largura && v.miniatura_altura) {
    painel.style.aspectRatio = `${v.miniatura_largura} / ${v.miniatura_altura}`;
  }

  getMiniaturaVersao(v.versao_id)
    .then((url) => {
      if (!url) {
        painel.classList.add('ficha-miniatura--vazia');
        painel.replaceChildren(el('span', { textContent: 'Sem imagem' }));
        return;
      }

      registrarUrl(url);

      painel.replaceChildren(el('img', {
        className: 'ficha-miniatura__img',
        src: url,
        alt: `Miniatura da versão ${v.versao || ''}`,
        loading: 'lazy',
      }));
    })
    .catch(() => {
      // Falha de imagem nao merece um aviso vermelho na tela: a ficha inteira
      // continua util sem ela.
      painel.classList.add('ficha-miniatura--vazia');
      painel.replaceChildren(el('span', { textContent: 'Imagem indisponível' }));
    });

  return painel;
}

/**
 * Uma versao do produto.
 *
 * Versao SEM arquivo aparece marcada, e nao escondida: "registrado, sem arquivo
 * digital" e informacao, e e o caso da versao historica (chefe, 2026-07-25).
 * Esconder faria a ficha mentir sobre quantas versoes existem.
 */
function blocoVersao(v, maisRecente, registrarUrl, irParaProduto) {
  const arquivos = v.arquivos || [];

  const cabecalho = el('div', { className: 'ficha-versao__cabecalho' }, [
    el('h4', {
      className: 'ficha-versao__titulo',
      textContent: v.versao || v.nome_versao || 'Versão',
    }),
    // A busca lista PRODUTOS e mostra no cartao a ultima edicao. Quem abre a
    // ficha vem atras das anteriores, e precisa saber num relance qual das
    // linhas e aquela que o cartao anunciou. A ordem (mais nova primeiro) vem do
    // servidor; a marca e o que a torna legivel sem contar datas.
    maisRecente ? chip('Mais recente', 'success') : null,
    arquivos.length
      ? chip(plural(arquivos.length, 'arquivo', 'arquivos'), 'info')
      : chip('Sem arquivo digital', 'default'),
  ].filter(Boolean));

  const meta = linhaMeta([
    { rotulo: 'Edição', valor: formatDate(v.versao_data_edicao) },
    { rotulo: 'Criação', valor: formatDate(v.versao_data_criacao) },
    { rotulo: 'Órgão', valor: v.orgao_produtor },
    { rotulo: 'Lote', valor: v.lote_nome },
    { rotulo: 'Projeto', valor: v.projeto_nome },
  ]);

  const palavras = (v.palavras_chave || []).length
    ? el('div', { className: 'ficha-palavras' }, v.palavras_chave.map(p => chip(p, 'secondary')))
    : null;

  const listaArquivos = arquivos.length
    ? el('ul', { className: 'ficha-arquivos' }, arquivos.map(linhaArquivo))
    : null;

  return el('div', {
    className: `ficha-versao${maisRecente ? ' ficha-versao--destaque' : ''}`,
  }, [
    painelMiniatura(v, maisRecente, registrarUrl),
    el('div', { className: 'ficha-versao__corpo' }, [
      cabecalho,
      meta,
      v.versao_descricao
        ? el('p', { className: 'ficha-versao__descricao', textContent: v.versao_descricao })
        : null,
      palavras,
      listaArquivos,
      blocoRelacionamentos(v.relacionamentos, irParaProduto),
    ].filter(Boolean)),
  ]);
}

/** Espaco reservado enquanto a ficha carrega, no formato do que vai chegar. */
function esqueleto() {
  return el('div', { className: 'ficha-esqueleto' }, [
    el('div', { className: 'ficha-esqueleto__faixa' }),
    el('div', { className: 'ficha-esqueleto__bloco' }),
    el('div', { className: 'ficha-esqueleto__bloco' }),
  ]);
}

/**
 * Ficha do produto: identificacao e todas as versoes.
 *
 * Recebe uma LISTA, e nao um produto, porque a busca permite selecionar varios.
 * Abrir uma janela por produto selecionado seria uma pilha de modais; aqui e um
 * modal so, com "anterior" e "proxima" percorrendo a selecao, e um contador
 * dizendo onde a pessoa esta.
 *
 * Abre com o esqueleto e busca depois: a ficha vem de um endpoint que traz
 * versoes, arquivos e relacionamentos, e prender o clique ate a resposta daria a
 * sensacao de que o botao nao funcionou.
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

  // URLs de objeto das miniaturas ja desenhadas. Sem soltar, percorrer uma
  // selecao grande deixaria uma imagem por produto presa na memoria da aba.
  let urlsMiniatura = [];

  const soltarMiniaturas = () => {
    // A guarda existe porque a API de blob URL nao esta em todo ambiente que
    // roda este modulo (o jsdom dos testes nao a tem). Onde ela falta, nao ha
    // blob criado para vazar, entao pular o revoke e correto, e nao remendo.
    if (typeof URL.revokeObjectURL === 'function') {
      urlsMiniatura.forEach(URL.revokeObjectURL);
    }
    urlsMiniatura = [];
  };

  const registrarUrl = (url) => urlsMiniatura.push(url);

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
  }, ['Próxima', svgIcon(ICONS.chevronRight, 16)]);

  const navegacao = el('div', { className: 'produto-ficha__nav' }, [
    btnAnterior, posicao, btnProxima,
  ]);

  // A navegacao so existe quando ha mais de um: com um produto so, uma barra
  // com dois botoes desativados e ruido.
  const raiz = el('div', { className: 'produto-ficha__raiz' }, [
    lista.length > 1 ? navegacao : null,
    corpo,
  ].filter(Boolean));

  function tituloDe(p) {
    return (p && p.nome) || `Produto ${p && p.id}`;
  }

  const modal = openModal({
    title: tituloDe(lista[indice]),
    content: raiz,
    width: LARGURA_MODAL,
    onClose: () => {
      fechado = true;
      soltarMiniaturas();
    },
    actions: [{ label: 'Fechar', variant: 'text', onClick: ({ close }) => close() }],
  });

  const tituloEl = modal.element.querySelector('.modal__title');

  /**
   * Abre a ficha de OUTRO produto, vindo de um relacionamento.
   *
   * Empurra o produto no fim da selecao em vez de trocar a ficha no lugar: sem
   * isso, seguir um insumo perderia a selecao que a pessoa montou na busca, e
   * "Anterior" nao teria como voltar.
   */
  function irParaProduto(produto) {
    const jaEsta = lista.findIndex(p => Number(p.id) === Number(produto.id));
    if (jaEsta >= 0) {
      irPara(jaEsta);
      return;
    }
    lista.push(produto);
    if (lista.length === 2) raiz.prepend(navegacao);
    irPara(lista.length - 1);
  }

  function pintarFicha(d) {
    const versoes = d.versoes || [];

    const escala = d.denominador_escala_especial
      ? `1:${formatNumber(d.denominador_escala_especial)}`
      : d.escala;

    const identificacao = el('div', { className: 'ficha-identificacao' }, [
      fato('MI', d.mi, true),
      fato('INOM', d.inom, true),
      fato('Escala', escala),
      fato('Versões', formatNumber(versoes.length)),
      fato('Cadastrado', formatDate(d.data_cadastramento)),
    ].filter(Boolean));

    corpo.replaceChildren(...[
      identificacao,
      d.descricao
        ? el('p', { className: 'ficha-descricao', textContent: d.descricao })
        : null,
      el('h3', {
        className: 'produto-ficha__secao',
        textContent: versoes.length > 1
          ? `${plural(versoes.length, 'versão', 'versões')}, da mais recente para a mais antiga`
          : plural(versoes.length, 'versão', 'versões'),
      }),
      ...(versoes.length
        ? versoes.map((v, i) => blocoVersao(
          v,
          versoes.length > 1 && i === 0,
          registrarUrl,
          irParaProduto
        ))
        : [el('p', {
          className: 'produto-ficha__vazio',
          textContent: 'Este produto ainda não tem versão cadastrada.',
        })]),
    ].filter(Boolean));
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

    // Trocar de produto descarta as imagens do anterior. O cache da FICHA
    // continua valendo (o JSON), e a imagem volta do cache HTTP do navegador,
    // entao a viagem de volta nao custa rede.
    soltarMiniaturas();

    if (cache.has(produto.id)) {
      pintarFicha(cache.get(produto.id));
      return;
    }

    corpo.replaceChildren(esqueleto());
    carregar(produto, meuToken);
  }

  function irPara(novo) {
    if (novo < 0 || novo >= lista.length) return;
    indice = novo;
    corpo.scrollTop = 0;
    pintar();
  }

  pintar();

  return modal;
}
