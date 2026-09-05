import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { chip } from '@components/status-chip.js';
import { estadoErro } from '@components/estado-erro.js';
import { reconciliar } from '@utils/reconciliar.js';
import {
  buscarProdutos, buscarGeometrias, baixarBuscaCsv, getBuscaFacetas,
  getTiposProduto, getTiposEscala, getSubtiposProduto, getProdutoDetalhado,
  getProjetos, getLotes,
} from '@modules/acervo/services/acervo-service.js';
import { getLimite } from '@modules/acervo/services/limites-service.js';
import { permissoes } from '@store/auth-store.js';
import { openProdutoDialogForm } from '@modules/acervo/pages/produto/produto-dialog-form.js';
import { criarFiltroMultiplo } from '@components/filtro-multiplo/filtro-multiplo.js';
import { criarMapa } from './mapa.js';
import { abrirProdutoDialog, plural } from './produto-dialog.js';
import { criarSelecao, pintarBotaoSelecao } from './selecao.js';
import { criarCampoPalavraChave } from './palavra-chave.js';

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
  const pode = permissoes('acervo');
  let pagina = 1;
  // Buscas voltam fora de ordem; so a mais recente pode pintar a tela.
  let requisicao = 0;
  // Verdadeiro ate a primeira resposta pintar a lista. E o que autoriza o
  // esqueleto: da segunda busca em diante ja ha resultado na tela.
  let primeiraCarga = true;
  // 'nenhum' | 'mapa' | 'desenho'
  let modoArea = 'nenhum';
  let areaDesenhada = null;
  /**
   * Caixa que veio no LINK, como [minx, miny, maxx, maxy].
   *
   * `sincronizarUrl` sempre ESCREVEU o `bbox` do modo "so na area do mapa", e a
   * tela nunca o LIA de volta: o endereco copiado e mandado por DIEx abria sem
   * recorte nenhum e devolvia o acervo inteiro, com o mesmo endereco na barra.
   * Quem recebeu o link via um resultado que nao era o do remetente.
   *
   * Vale so ate o mapa saber a propria area visivel: `areaVisivel()` devolve
   * null enquanto ele nao terminou de montar, e a primeira busca sai antes
   * disso. E a mesma solucao do `bboxDoLink` da tela de ponto de controle.
   */
  let bboxDoLink = null;
  // Lugar destacado no mapa, como 'estado:43' ou 'municipio:4314902'. Guarda a
  // CHAVE, e nao a geometria: serve para saber quando o destaque mudou e para
  // descartar a resposta de um pedido que ja ficou velho.
  let chaveLugar = '';
  // Verdadeiro quando o destaque do lugar levou a camera. E ele que substitui o
  // enquadramento automatico no `extent` do resultado.
  let lugarComandaCamera = false;

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

  /**
   * Lista de codigos que veio na URL, nas DUAS formas que o servidor aceita:
   * `?tipo_produto_id=1,3` e `?tipo_produto_id=1&tipo_produto_id=3` (as tres
   * formas estao em `server/src/utils/lista_schema.js`). Com `query.get`, a
   * segunda forma perdia tudo depois da primeira ocorrencia em silencio -- e a
   * primeira busca ainda reescrevia a barra de endereco sem o que foi perdido.
   */
  const daUrl = (campo) => query.getAll(campo)
    .flatMap(v => String(v).split(','))
    .filter(v => v !== '');

  // Os filtros de dominio marcam VARIAS opcoes. Antes eram
  // `<select>` de escolha unica, e perguntar "o que existe em 25k e em 50k"
  // custava duas buscas e a soma na mao.
  const tipoFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Todos os tipos',
    nomePlural: 'tipos',
    ariaLabel: 'Tipo de produto',
    valorInicial: daUrl('tipo_produto_id'),
    onMudar: () => {
      // Marcar um tipo estreita a lista de subtipos. O subtipo que nao pertence
      // a nenhum tipo marcado e descartado, senao a busca ficaria com dois
      // filtros que nunca se cruzam e devolveria zero sem explicar por que.
      atualizarSubtipos();
      buscar({ reiniciarPagina: true });
    },
  });

  const subtipoFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Todos os subtipos',
    nomePlural: 'subtipos',
    ariaLabel: 'Subtipo de produto',
    valorInicial: daUrl('subtipo_produto_id'),
    onMudar: () => buscar({ reiniciarPagina: true }),
  });

  const escalaFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Todas as escalas',
    nomePlural: 'escalas',
    ariaLabel: 'Escala',
    valorInicial: daUrl('tipo_escala_id'),
    onMudar: () => buscar({ reiniciarPagina: true }),
  });

  // Lugar. O municipio depende do ESTADO: sem estado
  // escolhido o servidor devolve lista vazia, porque um combo com os 5.572
  // municipios do pais nao ajuda a escolher. Trocar de estado zera o municipio,
  // senao a busca levaria um municipio de outro estado.
  const estadoFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Todos os estados',
    nomePlural: 'estados',
    ariaLabel: 'Estado',
    valorInicial: daUrl('estado_id'),
    onMudar: () => {
      municipioFiltro.limpar();
      destacarLugar();
      buscar({ reiniciarPagina: true });
    },
  });

  const municipioFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Escolha o estado',
    nomePlural: 'municípios',
    ariaLabel: 'Município',
    valorInicial: daUrl('municipio_id'),
    onMudar: () => { destacarLugar(); buscar({ reiniciarPagina: true }); },
  });

  // Projeto e lote. O servidor sempre aceitou os dois (`filtrosBusca`, em
  // acervo_schema.js) e a tela nao os oferecia: "que cartas sairam do lote 3"
  // so tinha resposta pelo SQL ou pelo plugin. Os dois montam UM `EXISTS` no
  // servidor, entao marcar os dois quer dizer "o lote X, dentro do projeto Y".
  //
  // Sem quantitativo cruzado: a rota de facetas devolve tipo, escala, subtipo,
  // estado e municipio, e nao projeto nem lote. A lista vem do dominio, e o
  // filtro aceita `contagem` nula.
  const projetoFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Todos os projetos',
    nomePlural: 'projetos',
    ariaLabel: 'Projeto',
    valorInicial: daUrl('projeto_id'),
    onMudar: () => {
      // Trocar de projeto estreita a lista de lotes. O lote que nao pertence a
      // nenhum projeto marcado e descartado, senao a busca ficaria com dois
      // filtros que nunca se cruzam e devolveria zero sem dizer por que.
      atualizarLotes();
      buscar({ reiniciarPagina: true });
    },
  });

  const loteFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Todos os lotes',
    nomePlural: 'lotes',
    ariaLabel: 'Lote',
    valorInicial: daUrl('lote_id'),
    onMudar: () => buscar({ reiniciarPagina: true }),
  });

  // Sugestao propria em vez de `<datalist>`: a lista nativa escolhia sozinha
  // quantas linhas mostrar, sem CSS que a alcance, e abria cobrindo boa parte da
  // tela. Ver o comentario de palavra-chave.js.
  const campoPalavra = criarCampoPalavraChave({
    valorInicial: query.get('palavra_chave') || '',
    onEscolher: () => buscar({ reiniciarPagina: true }),
  });

  const areaCheck = el('input', {
    className: 'form-field__checkbox',
    type: 'checkbox',
    onChange: (e) => {
      // A caixa do link vale so ate alguem mexer no interruptor: dali em diante
      // quem manda no recorte e a area visivel do mapa que a pessoa esta vendo.
      bboxDoLink = null;
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

  // Cadastrar produto é OPERADOR, como a rota. Perfil no client é ergonomia:
  // esconder o botão que devolveria 403 poupa a viagem, mas quem barra a escrita
  // continua sendo o `verifyPerfil` do servidor.
  const novoProdutoBtn = el('button', {
    className: 'btn btn--primary btn--sm busca__novo',
    type: 'button',
    // Refaz a busca depois de criar: o produto novo pode não casar com os
    // filtros da tela, e nesse caso não aparecer é a resposta certa. Recarregar
    // é o que impede a lista de ficar afirmando um total que mudou.
    onClick: () => openProdutoDialogForm({ onSaved: () => buscar({ recarregarMapa: true, manterVista: true }) }),
  }, [svgIcon(ICONS.add, 16), 'Novo produto']);

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

  // Exportar fica na MESMA linha dos filtros, depois do espacador, e nao num
  // cabecalho separado. O que se exporta e o resultado dos
  // filtros que estao ali do lado, entao a acao pertence a essa linha; alem
  // disso, uma faixa a menos no topo e altura a mais para a lista e o mapa, que
  // e onde esta o conteudo.
  const acoesTopo = el('div', { className: 'busca__acoes' }, [
    limparBtn, exportarSelecaoBtn, exportarTudoBtn,
  ]);

  const filtros = el('div', { className: 'busca-filtros' }, [
    tipoFiltro.element,
    subtipoFiltro.element,
    escalaFiltro.element,
    estadoFiltro.element,
    municipioFiltro.element,
    projetoFiltro.element,
    loteFiltro.element,
    campoPalavra.element,
    el('label', { className: 'busca-filtros__area' }, [
      areaCheck,
      el('span', { textContent: 'Só na área do mapa' }),
    ]),
    chipArea,
    el('span', { className: 'busca-filtros__espaco' }),
    acoesTopo,
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
    onVerFichas: (produtos, indice) => abrirProdutoDialog(produtos, indice, {
      onAlterado: () => buscar({ recarregarMapa: true, manterVista: true }),
    }),
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
    onAlternarSelecao: (produtoIds) => {
      // Chega a PILHA inteira sob o cursor, porque a mesma folha tem varios
      // produtos com a moldura identica. Aceita id solto tambem, para nao
      // depender de quem chama.
      const ids = Array.isArray(produtoIds) ? produtoIds : [produtoIds];
      // O produto clicado no mapa pode nao estar na pagina atual da lista. A
      // camada do mapa guarda o basico (id, nome, mi, escala), que e o
      // suficiente para a barra de selecao e para abrir a ficha.
      const produtos = ids.map(id => geometriasPorId.get(Number(id))
        || cartoesPorId.get(Number(id))
        || { id: Number(id) });
      // Tudo ou nada: ver `alternarVarios` em selecao.js.
      selecao.alternarVarios(produtos);
      destacarNaLista(Number(ids[0]));
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

  /**
   * Pinta no mapa o contorno do lugar filtrado e leva a camera ate ele.
   *
   * O municipio ganha do estado quando os dois estao escolhidos: e o recorte
   * mais estreito, e e o que a busca esta aplicando.
   *
   * Substitui o enquadramento no `extent` do resultado, e isto conserta um
   * problema antigo: existem produtos de cobertura NACIONAL no acervo, e eles
   * intersectam qualquer recorte, entao o extent de uma busca por um municipio
   * podia ser o Brasil inteiro. O contorno do lugar nao tem esse defeito.
   *
   * Falha em silencio de proposito: o destaque e apoio visual, o filtro funciona
   * sem ele, e um alerta a cada troca de estado seria pior do que a borda
   * faltando.
   *
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.enquadrar=true]
   */
  async function destacarLugar({ enquadrar = true } = {}) {
    // O municipio manda quando ha algum marcado, e nao a soma dos dois: ele e o
    // recorte mais fino, e desenhar o contorno do estado por cima diria que a
    // busca cobre o estado inteiro.
    const municipios = municipioFiltro.valores();
    const estados = estadoFiltro.valores();
    const tipo = municipios.length ? 'municipio' : (estados.length ? 'estado' : '');
    const ids = municipios.length ? municipios : estados;
    const chave = tipo ? `${tipo}:${ids.join(',')}` : '';

    if (chave === chaveLugar) return;
    chaveLugar = chave;

    if (!chave) {
      lugarComandaCamera = false;
      mapa.limparLimite();
      return;
    }

    // Marcado ANTES da espera, e nao depois: quem chama nao aguarda esta funcao,
    // e a busca que vem logo em seguida pinta o resultado antes de a geometria
    // chegar. Marcando depois, essa pintura enquadraria no `extent` e a camera
    // saltaria duas vezes, para dois lugares diferentes.
    lugarComandaCamera = enquadrar;

    try {
      // `allSettled`: um limite que falha nao pode apagar os que vieram. Com
      // tres estados marcados, dois contornos valem mais que nenhum.
      const respostas = await Promise.allSettled(ids.map(id => getLimite(tipo, id)));
      // Trocar de lugar duas vezes seguidas: a primeira resposta pode chegar
      // depois da segunda, e pintaria o estado que a pessoa ja abandonou.
      if (disposed || chaveLugar !== chave) return;

      const limites = respostas
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      if (!limites.length) {
        chaveLugar = '';
        lugarComandaCamera = false;
        mapa.limparLimite();
        return;
      }
      mapa.destacarLimite(limites, { enquadrar });
    } catch {
      if (chaveLugar !== chave) return;
      chaveLugar = '';
      lugarComandaCamera = false;
    }
  }

  const page = el('div', { className: 'busca' }, [
    el('div', { className: 'busca__topo' }, [
      // Só a identidade: as ações que dizem respeito ao RESULTADO desceram para
      // a linha dos filtros. "Novo produto" fica aqui porque não é ação sobre o
      // resultado: é o cadastro, e ele não depende de filtro nenhum.
      //
      // Não há tela separada de "lista de produtos", e não deve haver: a busca
      // JÁ é a lista, com filtro facetado, mapa e exportação. Uma segunda lista
      // seria outra régua do que existe no acervo.
      el('div', { className: 'busca__identidade' }, [
        el('h1', { className: 'busca__titulo', textContent: 'Busca no Acervo' }),
        contador,
        pode.operador ? novoProdutoBtn : null,
      ].filter(Boolean)),
      campoBusca,
      filtros,
    ]),
    el('div', { className: 'busca__corpo' }, [painel, mapa.element]),
  ]);
  // Esta tela ocupa a altura da janela e rola POR DENTRO (a lista de um lado, o
  // mapa do outro). Quem sabe descontar a barra de navegacao e o proprio padding
  // e a area de conteudo, entao a marca vai nela; a pagina so declara que
  // precisa. O cleanup desfaz, senao a proxima rota herda a altura travada e
  // perde o rolamento normal.
  container.classList.add('main-content--altura-fixa');

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
    if (modoArea === 'mapa') return { geometria: null, bbox: mapa.areaVisivel() || bboxDoLink };
    return { geometria: null, bbox: null };
  }

  // ---------------------------------------------------------------------------
  // Busca
  // ---------------------------------------------------------------------------
  function filtrosAtuais() {
    const recorte = recorteAtual();
    return {
      termo: termoInput.value.trim(),
      // Arrays: o servico junta com virgula, e o servidor aceita a lista. Array
      // vazio some no `queryString`, que e o filtro nao aplicado.
      tipo_produto_id: tipoFiltro.valores(),
      subtipo_produto_id: subtipoFiltro.valores(),
      tipo_escala_id: escalaFiltro.valores(),
      estado_id: estadoFiltro.valores(),
      municipio_id: municipioFiltro.valores(),
      projeto_id: projetoFiltro.valores(),
      lote_id: loteFiltro.valores(),
      palavra_chave: campoPalavra.valor(),
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
    // Lista some quando vazia, e vira '1,3' quando tem marcacao. E a MESMA
    // forma que o servico manda para a API, entao o link colado da barra de
    // endereco e o que a tela consultou.
    const lista = (campo, valores) => {
      if (Array.isArray(valores) && valores.length) params.set(campo, valores.join(','));
    };

    if (f.termo) params.set('termo', f.termo);
    lista('tipo_produto_id', f.tipo_produto_id);
    lista('subtipo_produto_id', f.subtipo_produto_id);
    lista('estado_id', f.estado_id);
    lista('municipio_id', f.municipio_id);
    lista('tipo_escala_id', f.tipo_escala_id);
    lista('projeto_id', f.projeto_id);
    lista('lote_id', f.lote_id);
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

  /**
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.manterVista=false] - recarga que NAO e uma pergunta
   *   nova: veio de uma gravacao feita na ficha. Preserva a rolagem da lista e
   *   nao pinta esqueleto. Ver `mostrarEsqueleto`.
   */
  async function buscar({
    reiniciarPagina = false, enquadrar = true, recarregarMapa = true, manterVista = false,
  } = {}) {
    if (disposed) return;
    if (reiniciarPagina) pagina = 1;

    const meuToken = ++requisicao;
    const f = filtrosAtuais();
    sincronizarUrl(f);

    contador.textContent = 'Buscando...';
    lista.setAttribute('aria-busy', 'true');
    mostrarEsqueleto();

    try {
      // A lista, o mapa e as opcoes dos filtros saem juntos: sao a MESMA
      // pergunta, e esperar uma para pedir a outra multiplicaria o tempo ate a
      // tela ficar pronta. As facetas nao derrubam a busca se falharem: os
      // filtros so ficam sem quantitativo.
      const [resposta, camada, facetas] = await Promise.all([
        buscarProdutos({ ...f, com_geometria: false, page: pagina, limit: POR_PAGINA }),
        recarregarMapa ? buscarGeometrias(f) : Promise.resolve(null),
        getBuscaFacetas(f).catch(() => null),
      ]);
      if (disposed || meuToken !== requisicao) return;

      // PAGINA FORA DO INTERVALO. Dois caminhos chegam aqui: o link guardado com
      // `page=7` que envelheceu, e a exclusao da ultima linha feita na propria
      // ficha (`onAlterado` recarrega SEM reiniciar a pagina, de proposito).
      // Sem o corte, o contador anuncia "41 produtos encontrados" ao lado de uma
      // lista que diz "Nenhum produto encontrado com estes filtros", e a
      // paginacao mostra "Página 7 de 2" com "Próxima" desabilitado: tres frases
      // que se contradizem, e nenhuma delas diz o que fazer.
      //
      // Cair para a ULTIMA pagina valida e o que o `data-table` ja faz na
      // chegada das linhas; aqui quem pagina e o servidor, e o corte tem de
      // refazer a pergunta.
      const paginasDoTotal = Math.max(1, Math.ceil((resposta.total || 0) / POR_PAGINA));
      if (pagina > paginasDoTotal) {
        pagina = paginasDoTotal;
        return buscar({ enquadrar, recarregarMapa, manterVista });
      }

      renderResultados(resposta.dados || []);
      // Pergunta NOVA volta ao topo; recarga depois de uma gravacao, nao. Quem
      // salvou na ficha estava lendo o resultado, e devolver a lista ao topo
      // custaria a rolagem que ele ja tinha feito.
      if (!manterVista) lista.scrollTop = 0;
      primeiraCarga = false;
      atualizarContador(resposta, camada);
      if (facetas) aplicarFacetas(facetas);

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
      // inteiro.
      // Com lugar destacado, quem manda na camera e o contorno dele: o extent
      // por cima tiraria a borda vermelha da vista logo depois de ela aparecer.
      if (enquadrar && modoArea === 'nenhum' && !lugarComandaCamera && resposta.extent) {
        mapa.enquadrar(resposta.extent);
      }
    } catch (err) {
      if (disposed || meuToken !== requisicao) return;
      // Estado de ERRO, e nao a frase do resultado vazio. "Nenhum produto
      // encontrado" e "nao consegui perguntar" pedem acoes opostas: a primeira
      // manda afrouxar o filtro, a segunda manda tentar de novo. Pintadas
      // iguais, quem olha conclui que o acervo nao tem a carta.
      cartoes.clear();
      cartoesPorId.clear();
      lista.replaceChildren(estadoErro(err, () => buscar({ recarregarMapa })));
      contador.textContent = 'Não foi possível buscar';
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
  /**
   * Esqueleto SO na primeira carga.
   *
   * Ele existe para o vao entre a montagem da tela e a primeira resposta. Da
   * segunda busca em diante ja ha resultado na tela, e troca-lo por barras
   * cinzentas apaga o que a pessoa estava lendo, joga a rolagem para o topo e
   * mata o foco. Quem avisa que a busca esta correndo e o contador ("Buscando
   * ...") mais o `aria-busy` da lista, que o leitor de tela anuncia.
   */
  function mostrarEsqueleto() {
    if (!primeiraCarga) return;
    lista.replaceChildren(
      ...Array.from({ length: 4 }, () => el('div', { className: 'busca-esqueleto' }))
    );
  }

  function cartaoProduto(p) {
    const identificacao = [p.mi, p.inom].filter(Boolean).join(' · ');
    const palavras = (p.palavras_chave || []).slice(0, 3);

    // Clicar no cartao ABRE A FICHA. O cartao mostra um
    // resumo, e o gesto natural sobre um resumo e "quero ver o resto", nao
    // "marque isto". Selecionar virou o botao do rodape, que diz o que faz.
    //
    // O mapa continua indo ate a carta: quando a ficha fecha, o poligono ja
    // esta enquadrado atras dela.
    const abrirFicha = () => {
      mapa.enquadrarProduto(p.id);
      // Editar ou excluir na ficha muda o que a lista mostra: a busca refaz o
      // resultado e a camada do mapa junto, senão o cartão continuaria anunciando
      // a última edição de um produto que acabou de ganhar outra.
      abrirProdutoDialog(p, 0, { onAlterado: () => buscar({ recarregarMapa: true, manterVista: true }) });
    };

    const alternarSelecao = () => {
      selecao.alternar(p);
      mapa.setSelecionados(selecao.ids());
    };

    return el('article', {
      className: 'busca-cartao',
      tabIndex: 0,
      dataset: { id: String(p.id) },
      onClick: abrirFicha,
      onKeyDown: (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        abrirFicha();
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
      // O subtipo entra quando ele DEFINE o produto. Sem ele, a mesma folha
      // aparecia duas vezes com cartoes identicos (a carta padrao e a Carta
      // Topografica Militar sao produtos distintos no SCA), e a lista parecia
      // estar mostrando versoes em vez de produtos.
      el('p', {
        className: 'busca-cartao__id',
        textContent: p.subtipo_produto
          ? `${p.tipo_produto || '-'} · ${p.subtipo_produto}`
          : (p.tipo_produto || '-'),
      }),
      palavras.length
        ? el('div', { className: 'busca-chips' }, palavras.map(t => chip(t, 'secondary')))
        : null,
      el('div', { className: 'busca-cartao__rodape' }, [
        el('span', {
          textContent: p.ultima_versao
            ? `${p.ultima_versao} · ${formatDate(p.ultima_data_edicao)} · ${plural(p.num_versoes, 'versão', 'versões')}`
            : 'Sem versão cadastrada',
        }),
        // O botao que era "Ficha" virou o de SELECAO, agora
        // que o cartao inteiro abre a ficha. Ele carrega `aria-pressed` porque e
        // um botao de estado: sem isso o leitor de tela anuncia "Selecionar" tanto
        // no item marcado quanto no desmarcado. O rotulo e o icone saem de
        // `pintarBotaoSelecao`, que tambem roda quando a selecao muda por fora
        // (pelo mapa, pelo chip da barra ou pelo Limpar).
        el('button', {
          className: 'btn btn--text btn--sm busca-cartao__selecionar',
          type: 'button',
          dataset: { selecionar: String(p.id) },
          onClick: (e) => {
            // Sem isto o clique subiria para o cartao e abriria a ficha.
            e.stopPropagation();
            alternarSelecao();
          },
        }),
      ]),
    ]);
  }

  /**
   * O que o cartao MOSTRA, como texto.
   *
   * Serve para decidir se o cartao precisa ser refeito. Sem isto, toda recarga
   * trocaria os vinte nos e levaria junto o foco de quem navega pelo teclado,
   * mesmo quando nada mudou na linha.
   */
  function assinaturaCartao(p) {
    return JSON.stringify([
      p.nome, p.mi, p.inom, p.escala, p.tipo_produto, p.subtipo_produto,
      p.palavras_chave, p.ultima_versao, p.ultima_data_edicao, p.num_versoes,
    ]);
  }

  /** no -> assinatura com que ele foi pintado. Fora do DOM, como no reconciliar. */
  const assinaturas = new WeakMap();

  function montarCartao(p) {
    const cartao = cartaoProduto(p);
    assinaturas.set(cartao, assinaturaCartao(p));
    return cartao;
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

    for (const p of produtos) cartoesPorId.set(Number(p.id), p);

    // Reconciliacao por id, e nao `replaceChildren`. Esvaziar a lista zera a
    // altura rolavel, e o navegador prende a rolagem no topo: salvar uma versao
    // na ficha devolvia a busca ao primeiro cartao. Aqui o no que nao mudou nao
    // e tocado, entao a rolagem e o foco sobrevivem.
    const montados = reconciliar(lista, produtos, {
      chave: (p) => Number(p.id),
      criar: montarCartao,
      atualizar: (no, p) => {
        if (assinaturas.get(no) === assinaturaCartao(p)) return undefined;
        return montarCartao(p);
      },
    });

    for (const [id, no] of montados) cartoes.set(Number(id), no);
    marcarCartoes();
  }

  /** Repinta a marca de selecao em todos os cartoes da pagina. */
  function marcarCartoes() {
    for (const [id, cartao] of cartoes) {
      cartao.classList.toggle('busca-cartao--selecionado', selecao.tem(id));
      // O botao acompanha a marca do cartao: a selecao muda por varios caminhos
      // (mapa, chip da barra, Limpar), e todos passam por aqui.
      pintarBotaoSelecao(cartao, selecao.tem(id));
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
    // `limpar` nao dispara `onMudar`: limpar a tela busca UMA vez, no fim, e
    // nao seis vezes, uma por filtro.
    tipoFiltro.limpar();
    estadoFiltro.limpar();
    municipioFiltro.limpar();
    destacarLugar();
    subtipoFiltro.limpar();
    atualizarSubtipos();
    escalaFiltro.limpar();
    projetoFiltro.limpar();
    loteFiltro.limpar();
    atualizarLotes([]);
    campoPalavra.limpar();
    areaCheck.checked = false;
    modoArea = 'nenhum';
    areaDesenhada = null;
    bboxDoLink = null;
    mapa.limparArea();
    atualizarChipArea();
    buscar({ reiniciarPagina: true });
  }

  // ---------------------------------------------------------------------------
  // Carga inicial
  // ---------------------------------------------------------------------------
  // O quantitativo ao lado de cada opcao e o total que a busca devolveria ao
  // marca-la, e ele vem do servidor CRUZADO pelos outros filtros: marcar "Carta
  // Topografica" muda o numero ao lado de cada escala. A regra que faz isso
  // funcionar e a lista nunca aplicar o proprio filtro (`exceto`, no servidor).
  // Quem desenha a lista e o `filtro-multiplo`, que guarda a regra do "(0)".

  /** code -> produtos, para a lista de opcoes. */
  function mapaDeContagem(linhas) {
    return new Map((linhas || []).map(l => [String(l.code), l.produtos]));
  }

  let todosSubtipos = [];
  let tiposDominio = [];
  let escalasDominio = [];
  let todosLotes = [];
  /** Ultimo quantitativo por opcao. Null ate a primeira resposta chegar. */
  let contagens = { tipos: null, escalas: null, subtipos: null };

  /**
   * Repinta os tres filtros com o quantitativo cruzado.
   *
   * Nao dispara busca nenhuma, e nao pode: nenhuma escolha muda aqui (a que
   * zerou fica com "(0)"), entao repintar e so informacao nova sobre o mesmo
   * recorte. Se mudasse a escolha, cada busca provocaria outra.
   */
  function aplicarFacetas(f) {
    contagens = {
      tipos: mapaDeContagem(f.tipos_produto),
      escalas: mapaDeContagem(f.tipos_escala),
      subtipos: mapaDeContagem(f.subtipos_produto),
    };
    tipoFiltro.preencher(tiposDominio, null, contagens.tipos);
    escalaFiltro.preencher(escalasDominio, null, contagens.escalas);

    // Estado e municipio vem PRONTOS do servidor, com a contagem, e nao de um
    // dominio local: sao 5.572 municipios, e mandar a lista inteira ao
    // navegador para filtrar aqui seria pagar 25 MB por combo.
    //
    // A CONTAGEM VAI JUNTO, como nos tres de cima. O servidor sempre mandou o
    // `produtos` de cada estado e de cada municipio, e a tela jogava fora: as
    // duas listas eram as unicas sem numero ao lado, e o estado que o
    // cruzamento zerou deixava de aparecer com "(0)", que e como esta tela
    // avisa que o filtro marcado nao cruza com o resto.
    const comCodigo = itens => (itens || []).map(i => ({ ...i, code: i.id }));
    estadoFiltro.preencher(
      comCodigo(f.estados).map(e => ({ ...e, nome: `${e.nome} (${e.sigla})` })),
      'Todos os estados',
      mapaDeContagem(comCodigo(f.estados))
    );
    municipioFiltro.preencher(
      comCodigo(f.municipios),
      estadoFiltro.valores().length ? 'Todos os municípios' : 'Escolha o estado',
      mapaDeContagem(comCodigo(f.municipios))
    );

    atualizarSubtipos();
  }

  /**
   * @param {Array<string>} [preferidos] - subtipos a manter. Sem isto, os que ja
   *   estao marcados. Existe por causa da carga inicial: o dominio dos subtipos
   *   chega depois da montagem, e sem a semente o que veio no link se perdia.
   */
  function atualizarSubtipos(preferidos = subtipoFiltro.valores()) {
    const tipos = tipoFiltro.valores();
    const visiveis = tipos.length
      ? todosSubtipos.filter(s => tipos.includes(String(s.tipo_id)))
      : todosSubtipos;

    // Subtipo que nao pertence a nenhum tipo marcado e DESCARTADO, e nao mantido
    // com "(0)": ele nao cruzou a zero, ele deixou de fazer sentido. Manter
    // deixaria a busca com dois filtros que nunca se cruzam, devolvendo zero sem
    // dizer por que. Vale so aqui; nas outras listas o cruzamento manda.
    const manter = preferidos.filter(p => visiveis.some(s => String(s.code) === p));
    subtipoFiltro.preencher(visiveis, null, contagens.subtipos, manter);
    subtipoFiltro.definirVisivel(visiveis.length > 0);
  }

  /**
   * Lotes do projeto escolhido, ou todos quando nenhum esta marcado.
   *
   * Mesma regra do subtipo: lote de outro projeto e DESCARTADO, e nao mantido
   * com "(0)". Mantido, a busca ficaria com dois filtros que nunca se cruzam.
   *
   * O rotulo leva o projeto na frente: "Lote 3" sozinho nao distingue os lotes
   * de dois projetos, e e o par que quem trabalha conhece.
   *
   * @param {Array<string>} [preferidos] - marcacao a manter. Sem isto, a atual.
   */
  function atualizarLotes(preferidos = loteFiltro.valores()) {
    const projetos = projetoFiltro.valores();
    const visiveis = projetos.length
      ? todosLotes.filter(l => projetos.includes(String(l.projeto_id)))
      : todosLotes;

    const manter = preferidos.filter(p => visiveis.some(l => String(l.code) === p));
    loteFiltro.preencher(visiveis, null, null, manter);
  }

  // Os dominios nao bloqueiam a busca: se um deles falhar, o filtro fica so com
  // "Todos", e procurar por texto continua funcionando. Eles dao o CONJUNTO de
  // opcoes; o quantitativo de cada uma vem depois, com a primeira busca.
  const [tipos, escalas, subtipos, projetos, lotes] = await Promise.allSettled([
    getTiposProduto(), getTiposEscala(), getSubtiposProduto(), getProjetos(), getLotes(),
  ]);
  if (disposed) return () => {};

  if (tipos.status === 'fulfilled') {
    tiposDominio = tipos.value || [];
    tipoFiltro.preencher(tiposDominio, null, null, daUrl('tipo_produto_id'));
  }
  if (subtipos.status === 'fulfilled') {
    todosSubtipos = subtipos.value || [];
    atualizarSubtipos(daUrl('subtipo_produto_id'));
  }
  if (escalas.status === 'fulfilled') {
    escalasDominio = escalas.value || [];
    escalaFiltro.preencher(escalasDominio, null, null, daUrl('tipo_escala_id'));
  }
  // Projeto e lote vem de `/projetos/*`, e nao das facetas: a rota de facetas
  // devolve tipo, escala, subtipo, estado e municipio. O `code` e montado aqui
  // porque as duas listas usam `id`, e o filtro trabalha com `code`.
  if (projetos.status === 'fulfilled') {
    projetoFiltro.preencher(
      (projetos.value || []).map(p => ({ code: p.id, nome: p.nome })),
      null, null, daUrl('projeto_id')
    );
  }
  if (lotes.status === 'fulfilled') {
    const nomeProjeto = new Map(
      (projetos.status === 'fulfilled' ? projetos.value || [] : [])
        .map(p => [Number(p.id), p.nome])
    );
    todosLotes = (lotes.value || []).map(l => ({
      code: l.id,
      projeto_id: l.projeto_id,
      nome: nomeProjeto.has(Number(l.projeto_id))
        ? `${nomeProjeto.get(Number(l.projeto_id))} · ${l.nome}`
        : l.nome,
    }));
    atualizarLotes(daUrl('lote_id'));
  }

  // Estado e municipio do link ja nasceram marcados no `valorInicial`, e por
  // isso a PRIMEIRA busca ja os aplica. O nome de cada um chega com as facetas,
  // e ate la o botao mostra o codigo. O filtro guarda a marcacao sozinho, ao
  // contrario do <select>, que descartava em silencio o valor sem opcao.

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

  // Caixa que veio no link, quando ele NAO trouxe area desenhada. Os dois modos
  // sao exclusivos (ver a decisao 3 no topo), e o desenho e o mais especifico:
  // com os dois no endereco, ganha o poligono.
  if (modoArea === 'nenhum' && query.get('bbox')) {
    const numeros = query.get('bbox').split(',').map(Number);
    // A FORMA da caixa se confere AQUI, e nao no servidor. Quatro numeros
    // finitos nao bastam: `bbox=,,,` vira [0,0,0,0] e um link truncado ou
    // editado troca os cantos. Os dois passavam, marcavam "So na area do mapa" e
    // iam para o servidor, que respondia 400 ("bbox precisa ter minLon < maxLon
    // e minLat < maxLat"); a tela mostrava essa frase com o interruptor marcado,
    // sugerindo que o recorte era o problema sem dizer que ele veio do link.
    const valida = numeros.length === 4
      && numeros.every(Number.isFinite)
      && numeros[0] < numeros[2] && numeros[1] < numeros[3]
      && numeros[0] >= -180 && numeros[2] <= 180
      && numeros[1] >= -90 && numeros[3] <= 90;
    if (valida) {
      bboxDoLink = numeros;
      modoArea = 'mapa';
      areaCheck.checked = true;
      // Leva a camera ate a caixa do link, senao o mapa abriria no
      // enquadramento padrao ao lado de uma lista recortada por outra area.
      // `enquadrar` marca o movimento como programatico, entao ele nao dispara
      // uma busca por conta propria.
      mapa.enquadrar(numeros);
    } else {
      // O mesmo aviso da tela de ponto de controle, palavra por palavra: as duas
      // andam juntas, e ate esta linha so uma delas dizia alguma coisa.
      showError('A área do link não pôde ser lida. A busca seguiu sem ela.');
    }
  }

  // Lugar que veio no link. So enquadra quando o link NAO trouxe recorte
  // proprio: quem mandou um link com area desenhada ou com "so na area do mapa"
  // ja escolheu onde a camera devia parar, e o zoom no estado a tiraria de la.
  destacarLugar({ enquadrar: modoArea === 'nenhum' });

  const paginaUrl = parseInt(query.get('page'), 10);
  if (Number.isFinite(paginaUrl) && paginaUrl > 1) pagina = paginaUrl;

  await buscar();

  // PRODUTO QUE VEIO NO LINK. A ficha do produto e um DIALOGO
  // aberto de dentro desta busca, e nao uma rota: sem isto, a varredura de
  // rastreabilidade so conseguia escrever "produto #170" como texto morto, e
  // esse agregado sozinho responde por 388 eventos em 170 fichas.
  //
  // Abre depois da busca, e nao no lugar dela: quando o dialogo fechar, a
  // lista e o mapa ja estao atras dele, que e o mesmo comportamento de quem
  // chegou clicando num cartao.
  //
  // Falha em silencio quando o id nao existe mais. O produto pode ter sido
  // apagado depois do evento que trouxe a pessoa ate aqui, e nesse caso a
  // busca e o que ela vai usar para procurar o que sobrou.
  const produtoDoLink = parseInt(query.get('produto_id'), 10);
  if (Number.isFinite(produtoDoLink) && produtoDoLink > 0) {
    try {
      const detalhado = await getProdutoDetalhado(produtoDoLink);
      if (!disposed && detalhado) {
        mapa.enquadrarProduto(produtoDoLink);
        abrirProdutoDialog(detalhado, 0, {
          onAlterado: () => buscar({ recarregarMapa: true, manterVista: true }),
        });
      }
    } catch {
      // Produto inexistente: a busca fica aberta, sem dialogo.
    }
  }

  return () => {
    disposed = true;
    container.classList.remove('main-content--altura-fixa');
    document.removeEventListener('keydown', aoTeclar);
    buscarComEspera.cancelar();
    buscarPorMapa.cancelar();
    campoPalavra._cleanup();
    // Os filtros ouvem o DOCUMENTO (clique fora, Escape). Sem isto, a tela
    // seguinte herdaria o ouvinte de uma tela que ja morreu.
    for (const f of [
      tipoFiltro, subtipoFiltro, escalaFiltro, estadoFiltro, municipioFiltro,
      projetoFiltro, loteFiltro,
    ]) {
      f._cleanup();
    }
    mapa._cleanup();
  };
}
