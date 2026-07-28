import { el, svgIcon, ICONS } from '@utils/dom.js';
import { ESTILO_OSM, BRASIL, carregarMapLibre, caixaDe } from '@components/mapa/base.js';
import { criarModeloDesenho, colecaoDoDesenho } from './poligono.js';

/**
 * Mapa da busca do acervo, sobre MapLibre GL (chefe, 2026-07-25).
 *
 * O modulo isola TODO o contato com a biblioteca: a pagina fala em "mostre
 * estes produtos", "estes estao selecionados" e "me avise quando desenharem uma
 * area". Trocar de biblioteca, ou testar a pagina sem mapa nenhum, nao deveria
 * exigir mexer na busca.
 *
 * Fundo OSM porque a rede e interna mas TEM internet (chefe, 2026-07-25). Sem
 * internet os poligonos continuam aparecendo: eles vem da nossa API, e o que
 * falta e so a imagem de fundo.
 */

const FONTE = 'produtos';
const DESENHO = 'desenho';
/** Distancia em pixels para o clique "fechar no primeiro vertice". */
const RAIO_FECHAMENTO = 12;

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

  const modelo = criarModeloDesenho();
  let desenhando = false;
  let previa = null;
  let quadro = null;
  let verticeArrastado = null;

  let ultimoResultado = { type: 'FeatureCollection', features: [] };
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

  const botaoDesenhar = el('button', {
    className: 'btn btn--secondary btn--sm busca-mapa__btn',
    type: 'button',
    title: 'Desenhar uma área para filtrar a busca',
    onClick: () => (desenhando ? cancelarDesenho() : ativarDesenho()),
  }, [svgIcon(ICONS.layers, 16), 'Desenhar área']);

  // ---------------------------------------------------------------------------
  // Controles do desenho, no mesmo formato do fotos_aereas: estado em texto,
  // desfazer, concluir e cancelar. O texto e `aria-live` porque a validacao
  // ("as bordas nao podem se cruzar") precisa chegar a quem usa leitor de tela.
  // ---------------------------------------------------------------------------
  const estadoDesenho = el('p', {
    className: 'desenho-controles__estado',
    'aria-live': 'polite',
  });

  const btnDesfazer = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => { modelo.desfazer(); previa = null; pintarDesenho(); },
  }, ['Desfazer vértice']);

  const btnConcluir = el('button', {
    className: 'btn btn--primary btn--sm',
    type: 'button',
    onClick: () => concluirDesenho(),
  }, ['Concluir área']);

  const btnCancelar = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => cancelarDesenho(),
  }, ['Cancelar']);

  const controlesDesenho = el('div', {
    className: 'desenho-controles hidden',
    role: 'group',
    'aria-label': 'Controles do desenho de área',
  }, [estadoDesenho, el('div', { className: 'desenho-controles__botoes' }, [
    btnDesfazer, btnConcluir, btnCancelar,
  ])]);

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
    el('div', { className: 'busca-mapa__controles' }, [botaoDesenhar]),
    legenda,
    controlesDesenho,
    aviso,
  ]);

  // ---------------------------------------------------------------------------
  // Montagem
  // ---------------------------------------------------------------------------
  function falhar(mensagem) {
    aviso.replaceChildren(svgIcon(ICONS.warning, 18), el('span', { textContent: mensagem }));
    aviso.classList.remove('hidden');
    botaoDesenhar.disabled = true;
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

      // Preenchimento translucido: com cartas sobrepostas, opaco esconderia o
      // que esta embaixo e o fundo que da o contexto geografico.
      mapa.addLayer({
        id: 'produtos-preenchimento',
        type: 'fill',
        source: FONTE,
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
        source: FONTE,
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

      mapa.addSource(DESENHO, { type: 'geojson', data: colecaoDoDesenho([]) });
      mapa.addLayer({
        id: 'desenho-area',
        type: 'fill',
        source: DESENHO,
        filter: ['==', ['get', 'kind'], 'area'],
        paint: { 'fill-color': '#ed6c02', 'fill-opacity': 0.12 },
      });
      mapa.addLayer({
        id: 'desenho-linha',
        type: 'line',
        source: DESENHO,
        filter: ['in', ['get', 'kind'], ['literal', ['area', 'linha']]],
        paint: { 'line-color': '#ed6c02', 'line-width': 2, 'line-dasharray': [2, 1] },
      });
      mapa.addLayer({
        id: 'desenho-vertices',
        type: 'circle',
        source: DESENHO,
        filter: ['==', ['get', 'kind'], 'vertice'],
        paint: {
          // O primeiro vertice e maior e colorido: e o alvo de "clique aqui
          // para fechar a area", e precisa se distinguir dos demais.
          'circle-radius': ['case', ['get', 'primeiro'], 7, 5],
          'circle-color': ['case', ['get', 'primeiro'], '#d32f2f', '#ffffff'],
          'circle-stroke-color': '#ed6c02',
          'circle-stroke-width': 2,
        },
      });

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
    // setData zera o feature-state, entao a selecao e repintada em seguida.
    for (const id of selecionados) marcar(id, 'selecionado', true);
  }

  function ligarInteracoes() {
    mapa.on('mousemove', 'produtos-preenchimento', (e) => {
      if (desenhando || !e.features.length) return;
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
      mapa.getCanvas().style.cursor = desenhando ? 'crosshair' : '';
      if (onApontar) onApontar(null);
    });

    // O clique no produto ALTERNA a selecao: clicar de novo tira. Sem isso nao
    // havia como desmarcar o que se marcou por engano.
    mapa.on('click', 'produtos-preenchimento', (e) => {
      if (desenhando || !e.features.length) return;
      if (onAlternarSelecao) onAlternarSelecao(e.features[0].id);
    });

    mapa.on('click', (e) => { if (desenhando) cliqueDesenho(e); });
    mapa.on('mousemove', (e) => moverDesenho(e));
    mapa.on('mouseup', () => soltarVertice());
    mapa.on('mousedown', 'desenho-vertices', (e) => pegarVertice(e));
  }

  // ---------------------------------------------------------------------------
  // Desenho da area
  // ---------------------------------------------------------------------------
  function coordenadaDe(evento) {
    const { lng, lat } = evento.lngLat || {};
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }

  function pintarDesenho(mensagem = '') {
    const concluido = modelo.estado === 'concluido' || modelo.estado === 'editando';
    if (pronto) {
      mapa.getSource(DESENHO).setData(colecaoDoDesenho(modelo.vertices, previa, concluido));
    }

    const total = modelo.vertices.length;
    btnDesfazer.disabled = modelo.estado !== 'desenhando' || total === 0;
    btnConcluir.disabled = modelo.estado !== 'desenhando' || total < 3;
    btnDesfazer.classList.toggle('hidden', concluido);
    btnConcluir.classList.toggle('hidden', concluido);
    btnCancelar.textContent = concluido ? 'Remover área' : 'Cancelar';

    estadoDesenho.textContent = mensagem || (concluido
      ? 'Área concluída. Arraste os vértices para ajustar.'
      : total === 0
        ? 'Clique no mapa para marcar o primeiro vértice.'
        : `${total} vértice(s). Clique no primeiro para fechar, ou tecle Enter.`);
  }

  function ativarDesenho() {
    desenhando = true;
    modelo.limpar();
    previa = null;
    botaoDesenhar.classList.replace('btn--secondary', 'btn--primary');
    controlesDesenho.classList.remove('hidden');
    if (mapa) {
      mapa.getCanvas().style.cursor = 'crosshair';
      if (mapa.doubleClickZoom.isEnabled()) mapa.doubleClickZoom.disable();
    }
    pintarDesenho();
  }

  function desativarDesenho() {
    desenhando = false;
    previa = null;
    botaoDesenhar.classList.replace('btn--primary', 'btn--secondary');
    controlesDesenho.classList.add('hidden');
    if (mapa) {
      mapa.getCanvas().style.cursor = '';
      mapa.doubleClickZoom.enable();
    }
  }

  function cancelarDesenho() {
    const tinhaArea = modelo.estado === 'concluido';
    modelo.limpar();
    desativarDesenho();
    pintarDesenho();
    // So avisa a pagina quando havia area VALENDO: cancelar um desenho pela
    // metade nao deve refazer a busca.
    if (tinhaArea && onAreaCancelada) onAreaCancelada();
  }

  function concluirDesenho() {
    const r = modelo.concluir();
    if (!r.valid) {
      pintarDesenho(r.message);
      return false;
    }
    previa = null;
    desativarDesenho();
    // Os controles seguem visiveis com a area concluida, para dar o "Remover".
    controlesDesenho.classList.remove('hidden');
    pintarDesenho();
    if (onAreaDesenhada) onAreaDesenhada(r.geometria);
    return true;
  }

  function cliqueDesenho(evento) {
    if (modelo.estado === 'editando') return;
    const coordenada = coordenadaDe(evento);
    if (!coordenada) return;

    // Area ja concluida: o clique comeca OUTRA, em vez de nao fazer nada.
    if (modelo.estado === 'concluido') {
      modelo.limpar();
      modelo.acrescentar(coordenada);
      previa = null;
      pintarDesenho();
      return;
    }

    // Perto do primeiro vertice: fecha. E o gesto do fotos_aereas.
    if (modelo.vertices.length >= 3) {
      const primeiro = mapa.project(modelo.vertices[0]);
      const distancia = Math.hypot(evento.point.x - primeiro.x, evento.point.y - primeiro.y);
      if (distancia <= RAIO_FECHAMENTO) {
        concluirDesenho();
        return;
      }
    }

    const r = modelo.acrescentar(coordenada);
    previa = null;
    pintarDesenho(r.valid ? '' : r.message);
  }

  function moverDesenho(evento) {
    if (verticeArrastado !== null) {
      const coordenada = coordenadaDe(evento);
      if (coordenada) {
        modelo.moverVertice(verticeArrastado, coordenada);
        pintarDesenho('Solte para validar a nova área.');
      }
      return;
    }
    if (!desenhando || modelo.estado !== 'desenhando') return;
    previa = coordenadaDe(evento);
    // Uma repintura por quadro: sem isto o mousemove redesenha a fonte dezenas
    // de vezes por segundo e o mapa engasga.
    if (quadro !== null) return;
    quadro = requestAnimationFrame(() => { quadro = null; pintarDesenho(); });
  }

  function pegarVertice(evento) {
    const indice = Number(evento.features?.[0]?.properties?.indice);
    if (!Number.isInteger(indice) || !modelo.vertices[indice]) return;
    evento.preventDefault();
    if (!modelo.iniciarEdicao()) return;
    verticeArrastado = indice;
    mapa.dragPan.disable();
    mapa.getCanvas().style.cursor = 'grabbing';
  }

  function soltarVertice() {
    if (verticeArrastado === null) return;
    const r = modelo.confirmarEdicao();
    verticeArrastado = null;
    mapa.dragPan.enable();
    mapa.getCanvas().style.cursor = '';
    if (r.valid) {
      pintarDesenho();
      if (onAreaDesenhada) onAreaDesenhada(r.geometria);
    } else {
      pintarDesenho(`${r.message} A alteração foi desfeita.`);
    }
  }

  /** Teclado do desenho. A pagina repassa o keydown do documento. */
  function tratarTecla(evento) {
    if (!desenhando && modelo.estado !== 'editando') return false;
    if (evento.key === 'Backspace' && modelo.estado === 'desenhando') {
      evento.preventDefault();
      modelo.desfazer();
      previa = null;
      pintarDesenho();
      return true;
    }
    if (evento.key === 'Enter' && modelo.estado === 'desenhando') {
      evento.preventDefault();
      concluirDesenho();
      return true;
    }
    if (evento.key === 'Escape') {
      evento.preventDefault();
      if (modelo.estado === 'editando') {
        modelo.cancelarEdicao();
        verticeArrastado = null;
        if (mapa) mapa.dragPan.enable();
        pintarDesenho('Edição cancelada.');
      } else {
        cancelarDesenho();
      }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // API para a pagina
  // ---------------------------------------------------------------------------
  /** @param {Array<Object>} produtos - com `geom` (GeoJSON) e `id` */
  function setProdutos(produtos) {
    ultimoResultado = {
      type: 'FeatureCollection',
      features: (produtos || [])
        .filter(p => p.geom)
        // O `id` no topo da feature (e nao so em properties) e o que permite
        // setFeatureState: sem ele nao ha realce de apontado nem de selecao.
        .map(p => ({
          type: 'Feature',
          id: p.id,
          properties: { id: p.id, nome: p.nome, mi: p.mi || null },
          geometry: p.geom,
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
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  function ligarMovimento(callback) {
    mapa.on('moveend', () => {
      if (movimentoProgramatico) {
        movimentoProgramatico = false;
        return;
      }
      if (desenhando || verticeArrastado !== null) return;
      callback(areaVisivel());
    });
  }

  function aoMover(callback) {
    if (mapa) ligarMovimento(callback);
    else aoMoverPendente = callback;
  }

  /** Restaura uma area que veio pela URL, para ela ficar visivel no mapa. */
  function mostrarArea(geometria) {
    if (!geometria || !geometria.coordinates) return;
    const anel = geometria.coordinates[0] || [];
    // Sem o ultimo ponto: o modelo fecha o anel sozinho.
    const vertices = anel.slice(0, -1);
    modelo.limpar();
    for (const v of vertices) modelo.acrescentar(v);
    modelo.concluir();
    controlesDesenho.classList.remove('hidden');
    pintarDesenho();
  }

  function limparArea() {
    modelo.limpar();
    desativarDesenho();
    pintarDesenho();
  }

  function redimensionar() {
    if (mapa) mapa.resize();
  }

  function _cleanup() {
    destruido = true;
    if (quadro !== null) cancelAnimationFrame(quadro);
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
    mostrarArea,
    limparArea,
    tratarTecla,
    redimensionar,
    _cleanup,
  };
}
