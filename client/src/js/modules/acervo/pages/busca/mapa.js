import { el, svgIcon, ICONS } from '@utils/dom.js';
import { ESTILO_OSM, BRASIL, carregarMapLibre, caixaDe } from '@components/mapa/base.js';
import { criarDesenhoDeArea } from '@components/mapa/desenho-area.js';
import { criarDestaqueDeLimite } from '@components/mapa/limite-destaque.js';

/**
 * Mapa da busca do acervo, sobre MapLibre GL.
 *
 * O modulo isola TODO o contato com a biblioteca: a pagina fala em "mostre
 * estes produtos", "estes estao selecionados" e "me avise quando desenharem uma
 * area". Trocar de biblioteca, ou testar a pagina sem mapa nenhum, nao deveria
 * exigir mexer na busca.
 *
 * O desenho da area vive em @components/mapa/desenho-area.js, compartilhado com
 * a tela de ponto de controle. Aqui fica so o que e do
 * ACERVO: os poligonos dos produtos, o realce e o enquadramento.
 *
 * Fundo OSM porque a rede e interna mas TEM internet. Sem
 * internet os poligonos continuam aparecendo: eles vem da nossa API, e o que
 * falta e so a imagem de fundo.
 */

const FONTE = 'produtos';

/**
 * Fonte SO do rotulo, com um PONTO por produto.
 *
 * Rotular o poligono faz a mesma carta aparecer duas vezes: o MapLibre corta o
 * GeoJSON em ladrilhos e ancora o texto por pedaco, entao a folha que cruza a
 * borda de um ladrilho ganha um rotulo de cada lado. Um ponto cabe num ladrilho
 * so. O ponto vem do SERVIDOR, por `ST_PointOnSurface` (e nao `ST_Centroid`, que
 * cai fora de uma folha em L).
 *
 * E a mesma solucao que o mapa da mapoteca ja usava, e pelo mesmo motivo.
 */
const FONTE_ROTULO = 'produtos-pontos';

/** Coleção vazia, para a fonte nascer válida antes do primeiro resultado. */
const VAZIO = { type: 'FeatureCollection', features: [] };

/**
 * @param {Object} opts
 * @param {(produtoId:number)=>void} opts.onAlternarSelecao - clique num produto
 * @param {(produtoId:number|null)=>void} [opts.onApontar] - mouse sobre o poligono
 * @param {(geometria:Object)=>void} opts.onAreaDesenhada - poligono concluido
 * @param {()=>void} [opts.onAreaCancelada]
 * @returns {Object} controle do mapa
 */
export function criarMapa({ onAlternarSelecao, onApontar, onAreaDesenhada, onAreaCancelada }) {
  let maplibregl = null;
  let mapa = null;
  let pronto = false;
  let destruido = false;
  let observador = null;

  // O desenho de area e um modulo a parte, compartilhado com a tela de ponto de
  // controle: o gesto e o mesmo nas duas, e a pessoa o aprende UMA vez.
  const desenho = criarDesenhoDeArea({ onAreaDesenhada, onAreaCancelada });
  // Contorno do estado ou do municipio filtrado, tambem compartilhado com a
  // tela de ponto de controle.
  const limite = criarDestaqueDeLimite();

  let ultimoResultado = VAZIO;
  // Os pontos de rotulo, na MESMA passada. Ver o comentario de FONTE_ROTULO.
  let ultimosRotulos = VAZIO;
  let selecionados = new Set();
  let apontado = null;
  let extentPendente = null;
  let aoMoverPendente = null;
  // Movimento que o PROGRAMA causou (zoom numa carta, enquadramento) nao pode
  // ser lido como navegacao: no modo "so na area do mapa" ele dispararia uma
  // busca que a pessoa nao pediu, e o resultado mudaria sob os pes dela.
  let movimentoProgramatico = false;

  const container = el('div', { className: 'busca-mapa__canvas' });

  const aviso = el('div', { className: 'busca-mapa__aviso hidden' });

  const legenda = el('div', { className: 'busca-mapa__legenda hidden' }, [
    el('div', { className: 'busca-mapa__legenda-item' }, [
      el('span', { className: 'busca-mapa__amostra' }),
      el('span', { textContent: 'Produto encontrado' }),
    ]),
    el('div', { className: 'busca-mapa__legenda-item' }, [
      el('span', { className: 'busca-mapa__amostra busca-mapa__amostra--selecionado' }),
      el('span', { textContent: 'Selecionado' }),
    ]),
  ]);

  const element = el('div', { className: 'busca-mapa' }, [
    container,
    el('div', { className: 'busca-mapa__controles' }, [desenho.botao]),
    legenda,
    desenho.controles,
    aviso,
  ]);

  // ---------------------------------------------------------------------------
  // Montagem
  // ---------------------------------------------------------------------------
  function falhar(mensagem) {
    aviso.replaceChildren(svgIcon(ICONS.warning, 18), el('span', { textContent: mensagem }));
    aviso.classList.remove('hidden');
    desenho.desabilitar();
  }

  async function iniciar() {
    if (mapa || destruido) return;

    maplibregl = await carregarMapLibre();
    if (!maplibregl) {
      falhar('Não foi possível carregar o mapa. A lista de resultados continua funcionando.');
      return;
    }
    if (destruido) return;

    // O MapLibre le o tamanho do contêiner UMA vez, na construcao, e nao volta a
    // conferir sozinho. Contêiner ainda sem layout produz canvas 0x0 permanente.
    if (typeof ResizeObserver === 'function') {
      observador = new ResizeObserver(() => { if (mapa) mapa.resize(); });
      observador.observe(element);
    }

    try {
      montarMapa();
    } catch (err) {
      falhar(err && err.message
        ? `Não foi possível desenhar o mapa: ${err.message}`
        : 'Não foi possível desenhar o mapa nesta máquina.');
    }
  }

  function montarMapa() {
    mapa = new maplibregl.Map({
      container,
      style: ESTILO_OSM,
      bounds: BRASIL,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });

    mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    mapa.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }));

    mapa.on('load', () => {
      mapa.addSource(FONTE, { type: 'geojson', data: ultimoResultado });
      mapa.addSource(FONTE_ROTULO, { type: 'geojson', data: ultimosRotulos });

      // Preenchimento translucido: com cartas sobrepostas, opaco esconderia o
      // que esta embaixo e o fundo que da o contexto geografico.
      mapa.addLayer({
        id: 'produtos-preenchimento',
        type: 'fill',
        source: FONTE,
        layout: {
          // O mapeamento do SCN e ANINHADO por escala: a 2952-1-SO esta contida
          // na 2952, que esta na 535. Sem ordenar, a ordem de desenho e a da
          // fonte (por id), e a folha grande cai por cima da pequena e a
          // engole. A area entra NEGATIVA porque `fill-sort-key` desenha do
          // MENOR para o maior, e o que tem de ficar por cima e a folha menor.
          'fill-sort-key': ['-', 0, ['get', 'area']],
        },
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selecionado'], false], '#ed6c02',
            '#1976d2',
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selecionado'], false], 0.45,
            ['boolean', ['feature-state', 'apontado'], false], 0.35,
            0.12,
          ],
        },
      });

      mapa.addLayer({
        id: 'produtos-contorno',
        type: 'line',
        source: FONTE,
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selecionado'], false], '#ed6c02',
            '#1976d2',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selecionado'], false], 3,
            0.7,
          ],
        },
      });

      // Rotulo do produto: o MI, que e como a carta e pedida e conferida. O
      // produto ESPECIAL (campo de instrucao, carta de OM) nao tem MI, e nesse
      // caso o nome e a unica identificacao que existe.
      //
      // So a partir do zoom 8: mais longe, os rotulos se sobrepoem e viram uma
      // mancha. O MapLibre ja descarta o que colide, mas descartar cedo demais
      // faria a carta mostrar rotulo em um lugar e nao em outro, sem criterio
      // visivel para quem olha.
      mapa.addLayer({
        id: 'produtos-rotulo',
        type: 'symbol',
        source: FONTE_ROTULO,
        minzoom: 8,
        layout: {
          'text-field': ['coalesce', ['get', 'mi'], ['get', 'nome']],
          'text-font': ['Open Sans Regular'],
          'text-size': 12,
          'text-allow-overlap': false,
          'symbol-placement': 'point',
        },
        paint: {
          'text-color': '#212121',
          // O contorno branco e o que mantem o rotulo legivel sobre imagem de
          // fundo escura ou sobre varias cartas empilhadas.
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        },
      });

      // Ordem das camadas = ordem de insercao. O contorno do lugar entra sobre
      // os produtos, para nao sumir debaixo de uma carta, e o desenho por
      // ULTIMO, porque e o gesto em curso e nada pode cobri-lo.
      limite.montar(mapa);
      desenho.montar(mapa);

      pronto = true;
      legenda.classList.remove('hidden');
      mapa.resize();
      aplicarResultado();
      if (extentPendente) { enquadrar(extentPendente); extentPendente = null; }
      if (aoMoverPendente) { ligarMovimento(aoMoverPendente); aoMoverPendente = null; }
    });

    ligarInteracoes();
  }

  // ---------------------------------------------------------------------------
  // Produtos
  // ---------------------------------------------------------------------------
  function marcar(id, chave, valor) {
    if (id === null || id === undefined || !pronto) return;
    mapa.setFeatureState({ source: FONTE, id }, { [chave]: valor });
  }

  function aplicarResultado() {
    if (!pronto) return;
    mapa.getSource(FONTE).setData(ultimoResultado);
    mapa.getSource(FONTE_ROTULO).setData(ultimosRotulos);
    // setData zera o feature-state, entao a selecao e repintada em seguida.
    for (const id of selecionados) marcar(id, 'selecionado', true);
  }

  function ligarInteracoes() {
    mapa.on('mousemove', 'produtos-preenchimento', (e) => {
      if (desenho.ocupado() || !e.features.length) return;
      const id = e.features[0].id;
      if (apontado === id) return;
      marcar(apontado, 'apontado', false);
      apontado = id;
      marcar(apontado, 'apontado', true);
      mapa.getCanvas().style.cursor = 'pointer';
      // O realce e nos DOIS lados: apontar no mapa acende o cartao na lista.
      if (onApontar) onApontar(id);
    });

    mapa.on('mouseleave', 'produtos-preenchimento', () => {
      marcar(apontado, 'apontado', false);
      apontado = null;
      mapa.getCanvas().style.cursor = desenho.ocupado() ? 'crosshair' : '';
      if (onApontar) onApontar(null);
    });

    // O clique no produto ALTERNA a selecao: clicar de novo tira. Sem isso nao
    // havia como desmarcar o que se marcou por engano.
    //
    // E ele pega TODOS os poligonos sob o cursor, nao o de cima.
    //
    // Neste acervo a sobreposicao e a regra, nao a excecao: a mesma folha tem
    // Carta Topografica, CDGV, Ortoimagem, MDS e MDT, e os cinco gravam a MESMA
    // moldura por INOM. Com `features[0]`, o clique escolhia um deles por um
    // criterio que nao aparece na tela (a ordem de desenho), e os outros quatro
    // ficavam inalcancaveis pelo mapa: nao havia onde clicar para alcanca-los.
    //
    // O MapLibre repete a mesma feicao quando ela cai em mais de um ladrilho,
    // entao o `Set` deduplica. A ordem que ele entrega e de cima para baixo, e
    // ela se preserva: quem consome usa a primeira para decidir o que destacar.
    mapa.on('click', 'produtos-preenchimento', (e) => {
      if (desenho.ocupado() || !e.features.length) return;
      const ids = [...new Set(
        e.features.map(f => Number(f.id)).filter(Number.isFinite)
      )];
      if (ids.length && onAlternarSelecao) onAlternarSelecao(ids);
    });
  }

  // ---------------------------------------------------------------------------
  // API para a pagina
  // ---------------------------------------------------------------------------
  /** @param {Array<Object>} produtos - com `geom` (GeoJSON), `ponto`, `area` e `id` */
  function setProdutos(produtos) {
    const comGeometria = (produtos || []).filter(p => p.geom);

    ultimoResultado = {
      type: 'FeatureCollection',
      // O `id` no topo da feature (e nao so em properties) e o que permite
      // setFeatureState: sem ele nao ha realce de apontado nem de selecao.
      features: comGeometria.map(p => ({
        type: 'Feature',
        id: p.id,
        properties: {
          id: p.id,
          nome: p.nome,
          mi: p.mi || null,
          // Le o `fill-sort-key`. Sem area a folha vai para o fim da ordem, que
          // e onde uma geometria de tamanho desconhecido menos atrapalha.
          area: typeof p.area === 'number' ? p.area : 0,
        },
        geometry: p.geom,
      })),
    };

    // Um ponto por produto, SO com o texto do rotulo. Ver o comentario de
    // FONTE_ROTULO: e isto que impede a carta de aparecer rotulada duas vezes.
    //
    // O produto sem `ponto` fica sem rotulo, e nao sem poligono: a resposta pode
    // vir de um servidor mais antigo, e perder o nome da carta e melhor do que
    // sumir com ela do mapa.
    ultimosRotulos = {
      type: 'FeatureCollection',
      features: comGeometria
        .filter(p => p.ponto)
        .map(p => ({
          type: 'Feature',
          id: p.id,
          properties: { id: p.id, nome: p.nome, mi: p.mi || null },
          geometry: p.ponto,
        })),
    };

    aplicarResultado();
  }

  /** @param {Set<number>} ids */
  function setSelecionados(ids) {
    for (const id of selecionados) marcar(id, 'selecionado', false);
    selecionados = new Set(ids);
    for (const id of selecionados) marcar(id, 'selecionado', true);
  }

  /**
   * Realce vindo da LISTA: o mouse esta sobre um cartao.
   * @param {number|null} produtoId
   */
  function setApontado(produtoId) {
    const id = produtoId === null || produtoId === undefined ? null : Number(produtoId);
    if (apontado === id) return;
    marcar(apontado, 'apontado', false);
    apontado = id;
    marcar(apontado, 'apontado', true);
  }

  /**
   * Leva o mapa ate UMA carta, a partir do que ja esta na camada.
   *
   * O `maxZoom` mais alto que o do enquadramento geral e proposital: aqui a
   * pessoa pediu para ver AQUELA carta, e parar longe demais nao atenderia o
   * pedido. Carta especial pode ser minuscula, e sem teto o mapa mergulharia
   * num zoom onde nao ha mais tile.
   * @param {number} produtoId
   */
  function enquadrarProduto(produtoId) {
    if (!mapa) return false;
    const feature = ultimoResultado.features.find(f => Number(f.id) === Number(produtoId));
    const caixa = feature && caixaDe(feature.geometry);
    if (!caixa) return false;
    const [x1, y1, x2, y2] = caixa;
    movimentoProgramatico = true;
    mapa.fitBounds([[x1, y1], [x2, y2]], { padding: 80, maxZoom: 14, duration: 700 });
    return true;
  }

  function enquadrar(extent) {
    if (!extent) return;
    if (!mapa) { extentPendente = extent; return; }
    const [x1, y1, x2, y2] = extent;
    movimentoProgramatico = true;
    mapa.fitBounds([[x1, y1], [x2, y2]], { padding: 40, maxZoom: 12, duration: 600 });
  }

  function areaVisivel() {
    if (!mapa) return null;
    const b = mapa.getBounds();
    // A CAIXA SAI RECORTADA AO MUNDO. O MapLibre repete o globo na horizontal, e
    // o mapa nasce sem `minZoom` e sem `maxBounds`: afastado o bastante numa tela
    // larga, `getBounds()` devolve oeste menor que -180 e leste maior que 180. O
    // servidor recusa a caixa com 400 ("bbox fora do intervalo de coordenadas
    // geograficas") e a busca INTEIRA vira estado de erro, sem que nada na tela
    // diga que bastava aproximar o zoom.
    return [
      Math.max(-180, b.getWest()),
      Math.max(-90, b.getSouth()),
      Math.min(180, b.getEast()),
      Math.min(90, b.getNorth()),
    ];
  }

  function ligarMovimento(callback) {
    mapa.on('moveend', () => {
      if (movimentoProgramatico) {
        movimentoProgramatico = false;
        return;
      }
      // Desenhar nao e navegar: o `moveend` do arrasto de vertice dispararia
      // uma busca que ninguem pediu.
      if (desenho.ocupado()) return;
      callback(areaVisivel());
    });
  }

  function aoMover(callback) {
    if (mapa) ligarMovimento(callback);
    else aoMoverPendente = callback;
  }

  function redimensionar() {
    if (mapa) mapa.resize();
  }

  function _cleanup() {
    destruido = true;
    desenho.destruir();
    if (observador) { observador.disconnect(); observador = null; }
    if (mapa) { mapa.remove(); mapa = null; pronto = false; }
  }

  return {
    element,
    iniciar,
    setProdutos,
    setSelecionados,
    setApontado,
    enquadrarProduto,
    enquadrar,
    areaVisivel,
    aoMover,
    mostrarArea: desenho.mostrarArea,
    limparArea: desenho.limparArea,
    tratarTecla: desenho.tratarTecla,

    /**
     * Destaque do lugar filtrado.
     *
     * O enquadramento aqui NAO e marcado como programatico de proposito. No
     * modo "so na area do mapa" a camera define o recorte, entao o `moveend`
     * tem de disparar a busca: suprimi-lo deixaria a lista falando de uma area
     * que nao e mais a que esta na tela.
     */
    destacarLimite: limite.mostrar,
    limparLimite: limite.limpar,
    redimensionar,
    _cleanup,
  };
}
