import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { chip } from '@components/status-chip.js';
import {
  buscarProdutos, buscarGeometrias, baixarBuscaCsv, getPalavrasChave,
  getTiposProduto, getTiposEscala, getSubtiposProduto,
} from '@modules/acervo/services/acervo-service.js';
import { criarMapa } from './mapa.js';
import { abrirProdutoDialog, plural } from './produto-dialog.js';
import { criarSelecao } from './selecao.js';

/** Espera antes de disparar a busca enquanto a pessoa ainda digita. */
const ESPERA_DIGITACAO = 350;
/** Espera depois de mover o mapa, quando a busca segue a area visivel. */
const ESPERA_MAPA = 500;
const POR_PAGINA = 20;

function debounce(fn, ms) {
  let id = null;
  const chamada = (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
  chamada.cancelar = () => clearTimeout(id);
  return chamada;
}

/**
 * Busca do acervo (#/acervo/busca): textual e espacial, lado a lado.
 *
 * O desenho responde a uma pergunta so ("o que existe, e onde?"), e por isso a
 * lista e o mapa dividem a tela em vez de serem duas telas.
 *
 * Quatro decisoes que valem registro:
 *
 * 1. **A LISTA pagina; o MAPA, nao.** Sao duas chamadas: a paginada alimenta os
 *    cartoes, e `busca/geometrias` traz o poligono de TODOS os resultados. Antes
 *    o mapa mostrava so a pagina, e vinte poligonos numa busca de oitocentos
 *    afirmavam visualmente que o acervo tinha vinte cartas ali.
 * 2. **O filtro vive na URL.** Toda busca e um endereco que se manda por DIEx e
 *    que sobrevive ao F5, inclusive com a area desenhada.
 * 3. **O recorte espacial tem dois modos, nunca os dois juntos.** Ou a busca
 *    segue a area visivel do mapa, ou usa a area desenhada. Misturar faria o
 *    desenho sumir sozinho no primeiro arrasto do mapa.
 * 4. **A selecao e multipla e alterna.** Clicar seleciona, clicar de novo
 *    desmarca, e o que esta selecionado aparece numa barra com acesso as fichas.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} ctx
 * @returns {Promise<Function>} cleanup
 */
export async function renderBusca(container, ctx) {
  let disposed = false;
  let pagina = 1;
  // Buscas voltam fora de ordem; so a mais recente pode pintar a tela.
  let requisicao = 0;
  // 'nenhum' | 'mapa' | 'desenho'
  let modoArea = 'nenhum';
  let areaDesenhada = null;

  const query = ctx && ctx.query ? ctx.query : new URLSearchParams();

  // ---------------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------------
  const termoInput = el('input', {
    className: 'busca-campo__input',
    type: 'search',
    placeholder: 'Buscar por nome, MI, INOM ou palavra-chave',
    'aria-label': 'Buscar no acervo',
    autocomplete: 'off',
    value: query.get('termo') || '',
    onInput: () => buscarComEspera(),
  });

  const campoBusca = el('div', { className: 'busca-campo' }, [
    el('span', { className: 'busca-campo__icone' }, [svgIcon(ICONS.search, 20)]),
    termoInput,
  ]);

  const tipoSelect = el('select', {
    className: 'busca-filtros__select',
    'aria-label': 'Tipo de produto',
    onChange: () => {
      // Trocar o tipo estreita a lista de subtipos. Um subtipo que nao pertence
      // ao tipo novo e descartado, senao a busca ficaria com dois filtros que
      // nunca se cruzam e devolveria zero sem explicar por que.
      atualizarSubtipos();
      buscar({ reiniciarPagina: true });
    },
  }, [el('option', { value: '', textContent: 'Todos os tipos' })]);

  const subtipoSelect = el('select', {
    className: 'busca-filtros__select',
    'aria-label': 'Subtipo de produto',
    onChange: () => buscar({ reiniciarPagina: true }),
  }, [el('option', { value: '', textContent: 'Todos os subtipos' })]);

  const escalaSelect = el('select', {
    className: 'busca-filtros__select',
    'aria-label': 'Escala',
    onChange: () => buscar({ reiniciarPagina: true }),
  }, [el('option', { value: '', textContent: 'Todas as escalas' })]);

  const palavraInput = el('input', {
    className: 'busca-filtros__palavra',
    type: 'text',
    placeholder: 'Palavra-chave',
    'aria-label': 'Palavra-chave',
    autocomplete: 'off',
    list: 'busca-palavras-chave',
    value: query.get('palavra_chave') || '',
    onChange: () => buscar({ reiniciarPagina: true }),
  });

  const palavrasDatalist = el('datalist', { id: 'busca-palavras-chave' });

  const areaCheck = el('input', {
    className: 'form-field__checkbox',
    type: 'checkbox',
    onChange: (e) => {
      if (e.target.checked) {
        modoArea = 'mapa';
        areaDesenhada = null;
        mapa.limparArea();
      } else if (modoArea === 'mapa') {
        modoArea = 'nenhum';
      }
      atualizarChipArea();
      buscar({ reiniciarPagina: true });
    },
  });

  const chipArea = el('div', { className: 'busca-area-chip hidden' });

  const limparBtn = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => limparTudo(),
  }, [svgIcon(ICONS.close, 16), 'Limpar filtros']);

  const contador = el('p', { className: 'busca-resultados__contador', textContent: 'Buscando...' });

  /**
   * Exporta o resultado em CSV.
   * @param {boolean} soSelecionados
   */
  async function exportarCsv(soSelecionados, botao) {
    const ids = soSelecionados ? [...selecao.ids()] : [];
    if (soSelecionados && !ids.length) return;

    botao.disabled = true;
    try {
      await baixarBuscaCsv(
        { ...filtrosAtuais(), ids: ids.length ? ids.join(',') : null },
        soSelecionados ? 'selecionados-acervo.csv' : 'busca-acervo.csv'
      );
    } catch (err) {
      showError(err.message || 'Erro ao exportar o CSV');
    } finally {
      botao.disabled = false;
    }
  }

  const exportarTudoBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    title: 'Baixa em CSV todos os produtos do resultado, e não apenas a página exibida',
    onClick: (e) => exportarCsv(false, e.currentTarget),
  }, [svgIcon(ICONS.download, 16), 'Exportar CSV']);

  // So aparece quando ha selecao: um botao permanentemente desativado e ruido.
  const exportarSelecaoBtn = el('button', {
    className: 'btn btn--secondary btn--sm hidden',
    type: 'button',
    onClick: (e) => exportarCsv(true, e.currentTarget),
  }, [svgIcon(ICONS.download, 16), 'Exportar selecionados']);

  const acoesTopo = el('div', { className: 'busca__acoes' }, [exportarSelecaoBtn, exportarTudoBtn]);

  const filtros = el('div', { className: 'busca-filtros' }, [
    tipoSelect,
    subtipoSelect,
    escalaSelect,
    palavraInput,
    palavrasDatalist,
    el('label', { className: 'busca-filtros__area' }, [
      areaCheck,
      el('span', { textContent: 'Só na área do mapa' }),
    ]),
    chipArea,
    el('span', { className: 'busca-filtros__espaco' }),
    limparBtn,
  ]);

  // ---------------------------------------------------------------------------
  // Selecao
  // ---------------------------------------------------------------------------
  const selecao = criarSelecao({
    onMudou: (ids) => {
      mapa.setSelecionados(ids);
      marcarCartoes();
      exportarSelecaoBtn.classList.toggle('hidden', ids.size === 0);
      exportarSelecaoBtn.replaceChildren(
        svgIcon(ICONS.download, 16),
        document.createTextNode(` Exportar ${ids.size} selecionado${ids.size > 1 ? 's' : ''}`)
      );
    },
    onVerFichas: (produtos, indice) => abrirProdutoDialog(produtos, indice),
  });

  // ---------------------------------------------------------------------------
  // Lista
  // ---------------------------------------------------------------------------
  const lista = el('div', { className: 'busca-lista' });
  const cartoes = new Map();

  const paginaAnterior = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => { pagina--; buscar({ recarregarMapa: false }); },
  }, [svgIcon(ICONS.arrowBack, 16), 'Anterior']);

  const paginaProxima = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => { pagina++; buscar({ recarregarMapa: false }); },
  }, ['Próxima']);

  const paginacaoInfo = el('span', { className: 'busca-paginacao__info' });
  const paginacao = el('div', { className: 'busca-paginacao hidden' }, [
    paginaAnterior, paginacaoInfo, paginaProxima,
  ]);

  const painel = el('div', { className: 'busca-painel' }, [selecao.element, lista, paginacao]);

  // ---------------------------------------------------------------------------
  // Mapa
  // ---------------------------------------------------------------------------
  const mapa = criarMapa({
    onApontar: (produtoId) => apontarCartao(produtoId),
    onAlternarSelecao: (produtoId) => {
      // O produto clicado no mapa pode nao estar na pagina atual da lista. A
      // camada do mapa guarda o basico (id, nome, mi, escala), que e o
      // suficiente para a barra de selecao e para abrir a ficha.
      const produto = geometriasPorId.get(Number(produtoId))
        || cartoesPorId.get(Number(produtoId))
        || { id: Number(produtoId) };
      selecao.alternar(produto);
      destacarNaLista(Number(produtoId));
    },
    onAreaDesenhada: (geometria) => {
      modoArea = 'desenho';
      areaDesenhada = geometria;
      areaCheck.checked = false;
      atualizarChipArea();
      buscar({ reiniciarPagina: true });
    },
    onAreaCancelada: () => {
      if (modoArea !== 'desenho') return;
      modoArea = 'nenhum';
      areaDesenhada = null;
      atualizarChipArea();
      buscar({ reiniciarPagina: true });
    },
  });

  const page = el('div', { className: 'busca' }, [
    el('div', { className: 'busca__topo' }, [
      el('div', { className: 'busca__cabecalho' }, [
        el('div', { className: 'busca__identidade' }, [
          el('h1', { className: 'busca__titulo', textContent: 'Busca no Acervo' }),
          contador,
        ]),
        acoesTopo,
      ]),
      campoBusca,
      filtros,
    ]),
    el('div', { className: 'busca__corpo' }, [painel, mapa.element]),
  ]);
  container.appendChild(page);

  // Esqueleto ANTES de qualquer espera.
  //
  // A primeira busca so sai depois que os dominios dos filtros voltam, e nesse
  // intervalo a lista ficava vazia: a tela nascia com um painel em branco ao
  // lado do mapa, sem dizer se estava carregando ou se nao havia resultado.
  // Pintar o esqueleto na montagem fecha esse vao.
  mostrarEsqueleto();

  mapa.iniciar();
  mapa.aoMover(() => {
    if (modoArea !== 'mapa') return;
    buscarPorMapa();
  });

  // Enter, Backspace e Escape do desenho. No documento, e nao no mapa: o foco
  // costuma estar num campo de filtro quando a pessoa desenha.
  const aoTeclar = (e) => {
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    mapa.tratarTecla(e);
  };
  document.addEventListener('keydown', aoTeclar);

  // ---------------------------------------------------------------------------
  // Area
  // ---------------------------------------------------------------------------
  function atualizarChipArea() {
    if (modoArea === 'desenho' && areaDesenhada) {
      chipArea.replaceChildren(
        svgIcon(ICONS.layers, 16),
        el('span', { textContent: 'Área desenhada no mapa' }),
        el('button', {
          className: 'busca-area-chip__remover',
          type: 'button',
          'aria-label': 'Remover a área desenhada',
          textContent: '×',
          onClick: () => {
            modoArea = 'nenhum';
            areaDesenhada = null;
            mapa.limparArea();
            atualizarChipArea();
            buscar({ reiniciarPagina: true });
          },
        })
      );
      chipArea.classList.remove('hidden');
    } else {
      chipArea.classList.add('hidden');
    }
  }

  /** O recorte que vale agora: poligono desenhado ou caixa da area visivel. */
  function recorteAtual() {
    if (modoArea === 'desenho' && areaDesenhada) {
      return { geometria: JSON.stringify(areaDesenhada), bbox: null };
    }
    if (modoArea === 'mapa') return { geometria: null, bbox: mapa.areaVisivel() };
    return { geometria: null, bbox: null };
  }

  // ---------------------------------------------------------------------------
  // Busca
  // ---------------------------------------------------------------------------
  function filtrosAtuais() {
    const recorte = recorteAtual();
    return {
      termo: termoInput.value.trim(),
      tipo_produto_id: tipoSelect.value,
      subtipo_produto_id: subtipoSelect.value,
      tipo_escala_id: escalaSelect.value,
      palavra_chave: palavraInput.value.trim(),
      geometria: recorte.geometria,
      bbox: recorte.bbox,
    };
  }

  /**
   * Espelha os filtros na URL, sem re-resolver a rota.
   *
   * `history.replaceState` em vez de mexer no hash: trocar o hash dispara o
   * roteador, que remontaria a pagina inteira a cada tecla digitada.
   */
  function sincronizarUrl(f) {
    const params = new URLSearchParams();
    if (f.termo) params.set('termo', f.termo);
    if (f.tipo_produto_id) params.set('tipo_produto_id', f.tipo_produto_id);
    if (f.subtipo_produto_id) params.set('subtipo_produto_id', f.subtipo_produto_id);
    if (f.tipo_escala_id) params.set('tipo_escala_id', f.tipo_escala_id);
    if (f.palavra_chave) params.set('palavra_chave', f.palavra_chave);
    if (f.geometria) params.set('geometria', f.geometria);
    if (f.bbox) params.set('bbox', f.bbox.map(n => n.toFixed(5)).join(','));
    if (pagina > 1) params.set('page', String(pagina));

    const consulta = params.toString();
    history.replaceState(null, '', `#/acervo/busca${consulta ? `?${consulta}` : ''}`);
  }

  /** Produtos da camada do mapa, por id (para selecao vinda do mapa). */
  const geometriasPorId = new Map();
  /** Produtos da pagina atual, por id. */
  const cartoesPorId = new Map();

  async function buscar({ reiniciarPagina = false, enquadrar = true, recarregarMapa = true } = {}) {
    if (disposed) return;
    if (reiniciarPagina) pagina = 1;

    const meuToken = ++requisicao;
    const f = filtrosAtuais();
    sincronizarUrl(f);

    contador.textContent = 'Buscando...';
    lista.setAttribute('aria-busy', 'true');
    mostrarEsqueleto();

    try {
      // A lista e o mapa saem juntos: sao a MESMA pergunta, e esperar uma para
      // pedir a outra dobraria o tempo ate a tela ficar pronta.
      const [resposta, camada] = await Promise.all([
        buscarProdutos({ ...f, com_geometria: false, page: pagina, limit: POR_PAGINA }),
        recarregarMapa ? buscarGeometrias(f) : Promise.resolve(null),
      ]);
      if (disposed || meuToken !== requisicao) return;

      renderResultados(resposta.dados || []);
      atualizarContador(resposta, camada);

      if (camada) {
        geometriasPorId.clear();
        for (const p of camada.dados || []) geometriasPorId.set(Number(p.id), p);
        mapa.setProdutos(camada.dados || []);
        mapa.setSelecionados(selecao.ids());
      }

      // O mapa so se reenquadra quando NINGUEM definiu area. Se a pessoa
      // desenhou ou esta navegando, ela ja disse onde quer olhar.
      //
      // O caso que tornou isto obrigatorio: existem produtos de cobertura
      // NACIONAL no acervo, e eles intersectam qualquer recorte. O `extent` de
      // 22 produtos achados num quadrado de 15 km no RS vinha sendo o Brasil
      // inteiro (medido em 2026-07-28).
      if (enquadrar && modoArea === 'nenhum' && resposta.extent) {
        mapa.enquadrar(resposta.extent);
      }
    } catch (err) {
      if (disposed || meuToken !== requisicao) return;
      lista.replaceChildren(el('p', {
        className: 'busca-lista__vazio',
        textContent: err.message || 'Erro ao buscar no acervo',
      }));
      contador.textContent = '';
      paginacao.classList.add('hidden');
      showError(err.message || 'Erro ao buscar no acervo');
    } finally {
      lista.removeAttribute('aria-busy');
    }
  }

  const buscarComEspera = debounce(() => buscar({ reiniciarPagina: true }), ESPERA_DIGITACAO);
  const buscarPorMapa = debounce(
    () => buscar({ reiniciarPagina: true, enquadrar: false }),
    ESPERA_MAPA
  );

  function atualizarContador(resposta, camada) {
    const total = resposta.total;
    let texto = total === 0
      ? 'Nenhum produto encontrado'
      : plural(total, 'produto encontrado', 'produtos encontrados');

    // Truncar em silencio seria repetir, em escala maior, o defeito que a
    // camada completa veio corrigir.
    if (camada && camada.truncado) {
      texto += ` (o mapa mostra os primeiros ${formatNumber(camada.dados.length)})`;
    }
    contador.textContent = texto;

    const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    paginacao.classList.toggle('hidden', totalPaginas <= 1);
    paginacaoInfo.textContent = `Página ${resposta.page} de ${formatNumber(totalPaginas)}`;
    paginaAnterior.disabled = resposta.page <= 1;
    paginaProxima.disabled = resposta.page >= totalPaginas;
  }

  // ---------------------------------------------------------------------------
  // Cartoes
  // ---------------------------------------------------------------------------
  function mostrarEsqueleto() {
    const quantos = Math.min(Math.max(cartoes.size || 4, 3), 6);
    lista.replaceChildren(
      ...Array.from({ length: quantos }, () => el('div', { className: 'busca-esqueleto' }))
    );
  }

  function cartaoProduto(p) {
    const identificacao = [p.mi, p.inom].filter(Boolean).join(' · ');
    const palavras = (p.palavras_chave || []).slice(0, 3);

    // Clicar no cartao faz DUAS coisas de proposito: alterna a selecao e leva o
    // mapa ate a carta. Sao a mesma intencao ("quero esta"), e separa-las
    // obrigaria a pessoa a procurar o poligono no mapa depois de escolher.
    const escolher = () => {
      selecao.alternar(p);
      mapa.setSelecionados(selecao.ids());
      mapa.enquadrarProduto(p.id);
    };

    return el('article', {
      className: 'busca-cartao',
      tabIndex: 0,
      dataset: { id: String(p.id) },
      onClick: escolher,
      onKeyDown: (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        escolher();
      },
      // Apontar na lista acende o poligono, e vice-versa: e o que liga os dois
      // lados sem exigir clique.
      onMouseEnter: () => mapa.setApontado(p.id),
      onMouseLeave: () => mapa.setApontado(null),
      onFocus: () => mapa.setApontado(p.id),
      onBlur: () => mapa.setApontado(null),
    }, [
      el('div', { className: 'busca-cartao__topo' }, [
        el('h2', { className: 'busca-cartao__nome', textContent: p.nome || `Produto ${p.id}` }),
        chip(p.escala || '-', 'info'),
      ]),
      identificacao ? el('p', { className: 'busca-cartao__id', textContent: identificacao }) : null,
      el('p', { className: 'busca-cartao__id', textContent: p.tipo_produto || '-' }),
      palavras.length
        ? el('div', { className: 'busca-chips' }, palavras.map(t => chip(t, 'secondary')))
        : null,
      el('div', { className: 'busca-cartao__rodape' }, [
        el('span', {
          textContent: p.ultima_versao
            ? `${p.ultima_versao} · ${formatDate(p.ultima_data_edicao)} · ${plural(p.num_versoes, 'versão', 'versões')}`
            : 'Sem versão cadastrada',
        }),
        el('button', {
          className: 'btn btn--text btn--sm busca-cartao__ficha',
          type: 'button',
          onClick: (e) => {
            // Sem isto o clique subiria para o cartao e alternaria a selecao.
            e.stopPropagation();
            abrirProdutoDialog(p);
          },
        }, [svgIcon(ICONS.visibility, 16), 'Ficha']),
      ]),
    ]);
  }

  function renderResultados(produtos) {
    cartoes.clear();
    cartoesPorId.clear();

    if (!produtos.length) {
      lista.replaceChildren(el('div', { className: 'busca-lista__vazio' }, [
        el('p', { textContent: 'Nenhum produto encontrado com estes filtros.' }),
        el('p', {
          className: 'busca-lista__dica',
          textContent: modoArea !== 'nenhum'
            ? 'A busca está limitada a uma área do mapa. Tente ampliar a área ou remover o recorte.'
            : 'Tente um termo mais curto, ou remova um dos filtros.',
        }),
      ]));
      return;
    }

    const elementos = produtos.map((p) => {
      const cartao = cartaoProduto(p);
      cartoes.set(Number(p.id), cartao);
      cartoesPorId.set(Number(p.id), p);
      return cartao;
    });
    lista.replaceChildren(...elementos);
    marcarCartoes();
  }

  /** Repinta a marca de selecao em todos os cartoes da pagina. */
  function marcarCartoes() {
    for (const [id, cartao] of cartoes) {
      cartao.classList.toggle('busca-cartao--selecionado', selecao.tem(id));
    }
  }

  /** Realce vindo do MAPA: acende o cartao correspondente, se ele estiver na pagina. */
  function apontarCartao(produtoId) {
    for (const [id, cartao] of cartoes) {
      cartao.classList.toggle(
        'busca-cartao--apontado',
        produtoId !== null && Number(id) === Number(produtoId)
      );
    }
  }

  /** Traz para a vista o cartao do produto clicado no mapa, se ele estiver na pagina. */
  function destacarNaLista(produtoId) {
    marcarCartoes();
    const alvo = cartoes.get(Number(produtoId));
    // O jsdom nao implementa scrollIntoView, e rolar a lista e conforto, nao
    // funcao: sem o guarda, clicar no mapa quebraria a pagina dentro da suite.
    if (alvo && typeof alvo.scrollIntoView === 'function') {
      alvo.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ---------------------------------------------------------------------------
  // Limpeza dos filtros
  // ---------------------------------------------------------------------------
  function limparTudo() {
    termoInput.value = '';
    tipoSelect.value = '';
    subtipoSelect.value = '';
    atualizarSubtipos();
    escalaSelect.value = '';
    palavraInput.value = '';
    areaCheck.checked = false;
    modoArea = 'nenhum';
    areaDesenhada = null;
    mapa.limparArea();
    atualizarChipArea();
    buscar({ reiniciarPagina: true });
  }

  // ---------------------------------------------------------------------------
  // Carga inicial
  // ---------------------------------------------------------------------------
  function preencherSelect(select, itens, rotuloTodos) {
    select.replaceChildren(
      el('option', { value: '', textContent: rotuloTodos }),
      ...itens.map(i => el('option', { value: String(i.code), textContent: i.nome }))
    );
  }

  let todosSubtipos = [];

  /**
   * @param {string} [preferido] - subtipo a manter. Sem isto, o valor que ja
   *   esta no campo. Existe por causa da carga inicial: atribuir a um <select>
   *   AINDA SEM as opcoes nao guarda nada, o navegador descarta em silencio, e
   *   o subtipo que veio no link se perdia.
   */
  function atualizarSubtipos(preferido = subtipoSelect.value) {
    const tipo = tipoSelect.value;
    const visiveis = tipo
      ? todosSubtipos.filter(s => String(s.tipo_id) === String(tipo))
      : todosSubtipos;

    preencherSelect(subtipoSelect, visiveis, 'Todos os subtipos');
    subtipoSelect.value = visiveis.some(s => String(s.code) === preferido) ? preferido : '';
    subtipoSelect.classList.toggle('hidden', visiveis.length === 0);
  }

  // Os dominios nao bloqueiam a busca: se um deles falhar, o filtro fica so com
  // "Todos", e procurar por texto continua funcionando.
  const [tipos, escalas, palavras, subtipos] = await Promise.allSettled([
    getTiposProduto(), getTiposEscala(), getPalavrasChave(), getSubtiposProduto(),
  ]);
  if (disposed) return () => {};

  if (tipos.status === 'fulfilled') {
    preencherSelect(tipoSelect, tipos.value || [], 'Todos os tipos');
    tipoSelect.value = query.get('tipo_produto_id') || '';
  }
  if (subtipos.status === 'fulfilled') {
    todosSubtipos = subtipos.value || [];
    atualizarSubtipos(query.get('subtipo_produto_id') || '');
  }
  if (escalas.status === 'fulfilled') {
    preencherSelect(escalaSelect, escalas.value || [], 'Todas as escalas');
    escalaSelect.value = query.get('tipo_escala_id') || '';
  }
  if (palavras.status === 'fulfilled') {
    palavrasDatalist.replaceChildren(
      ...(palavras.value || []).map(p => el('option', {
        value: p.palavra,
        label: `${p.palavra} (${formatNumber(p.usos)})`,
      }))
    );
  }

  // Area que veio na URL: e DESENHADA no mapa, para a pessoa ver o recorte que
  // o link trouxe em vez de um resultado filtrado por uma area invisivel.
  const geometriaUrl = query.get('geometria');
  if (geometriaUrl) {
    try {
      const geo = JSON.parse(geometriaUrl);
      if (geo && geo.type === 'Polygon' && Array.isArray(geo.coordinates)) {
        modoArea = 'desenho';
        areaDesenhada = geo;
        mapa.mostrarArea(geo);
        atualizarChipArea();
      }
    } catch {
      // Geometria ilegivel no link: a busca segue sem recorte.
    }
  }

  const paginaUrl = parseInt(query.get('page'), 10);
  if (Number.isFinite(paginaUrl) && paginaUrl > 1) pagina = paginaUrl;

  await buscar();

  return () => {
    disposed = true;
    document.removeEventListener('keydown', aoTeclar);
    buscarComEspera.cancelar();
    buscarPorMapa.cancelar();
    mapa._cleanup();
  };
}
