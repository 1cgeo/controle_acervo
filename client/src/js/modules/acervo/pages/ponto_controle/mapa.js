import { el } from '@utils/dom.js';
import { ESTILO_OSM, BRASIL, carregarMapLibre } from '@components/mapa/base.js';
import { criarDesenhoDeArea } from '@components/mapa/desenho-area.js';
import { criarDestaqueDeLimite } from '@components/mapa/limite-destaque.js';

/**
 * Mapa dos pontos de controle, sobre a base comum do SCA
 * (@components/mapa/base.js).
 *
 * Espelha o mapa da busca do acervo em comportamento: mostra o resultado
 * inteiro, realca o que a lista aponta, marca o que esta selecionado e enquadra
 * um item quando a lista pede. A diferenca e a geometria, e ela muda o desenho:
 * o produto do acervo tem AREA e o ponto de controle e uma coordenada. Onde a
 * busca pinta poligono, aqui se pinta circulo, e o "enquadrar" vira um zoom com
 * nivel fixo, porque um ponto nao tem extensao para caber na tela.
 *
 * O desenho de area chegou em 2026-07-29 (chefe), pelo mesmo modulo da busca
 * (@components/mapa/desenho-area.js). Antes so havia o recorte pela area
 * VISIVEL, que e um retangulo. A pergunta de campo raramente e retangular: e
 * "que pontos existem NESTE vale", "nesta faixa de fronteira", "nesta area de
 * trabalho". O retangulo continua, para quem so quer o que esta na tela.
 */

const FONTE = 'pontos';
/**
 * Fonte separada, com o ponto SELECIONADO e o APONTADO.
 *
 * O realce saiu do `feature-state` quando a fonte principal virou clusterizada.
 * O supercluster refaz as feicoes a cada mudanca de zoom, e o estado preso ao id
 * nao sobrevive a isso. Com uma fonte propria o realce e DADO, e nao estado: ela
 * tem no maximo algumas dezenas de feicoes, entao redesenha-la a cada clique ou
 * a cada passagem do mouse custa nada.
 */
const FONTE_REALCE = 'pontos-realce';
/** Zoom ao enquadrar UM ponto. Perto o bastante para ver o entorno do marco. */
const ZOOM_DO_PONTO = 15;
/**
 * Agrupamento. Acima de `CLUSTER_ZOOM_MAX` cada ponto aparece sozinho.
 *
 * O acervo tem mais de tres mil pontos, e boa parte deles a poucos quilometros
 * um do outro. Sem agrupar, o Rio Grande do Sul vira uma mancha unica em que
 * nao se distingue ponto nenhum, e o navegador desenha tres mil circulos a cada
 * quadro.
 */
const CLUSTER_RAIO = 45;
const CLUSTER_ZOOM_MAX = 13;

/**
 * Cor do ponto: UMA so, e nao uma por situacao.
 *
 * Desde 2026-07-29 so ponto APROVADO entra no acervo (o `prepare-upload` recusa
 * o resto). Pintar por `tipo_situacao` daria um mapa de uma cor so com uma
 * legenda de cinco, ou seja, a tela prometeria uma distincao que o dado nao tem.
 *
 * O verde e o mesmo que ja significava aprovado, entao quem conhece a tela nao
 * reaprende nada.
 */
const COR_PONTO = '#22c55e';

/**
 * @param {Object} opts
 * @param {(id:number)=>void} opts.onAlternarSelecao - clique num ponto
 * @param {(id:number|null)=>void} [opts.onApontar] - mouse sobre o ponto
 * @param {()=>void} [opts.onMover] - fim de um movimento feito pela PESSOA
 * @param {(geometria:Object)=>void} [opts.onAreaDesenhada] - poligono concluido
 * @param {()=>void} [opts.onAreaCancelada] - area removida
 * @returns {Object} controle do mapa
 */
export function criarMapaPontos({
  onAlternarSelecao, onApontar, onMover, onAreaDesenhada, onAreaCancelada,
}) {
  let maplibregl = null;
  let mapa = null;
  let pronto = false;
  let destruido = false;
  let observador = null;

  let ultimaColecao = { type: 'FeatureCollection', features: [] };
  let porId = new Map();
  let selecionados = new Set();
  let apontado = null;
  let enquadramentoPendente = null;
  // Movimento que o PROGRAMA causou (enquadrar o resultado) nao pode virar
  // busca nova: o resultado mudaria sob os pes de quem esta lendo a tela.
  let movimentoProgramatico = false;

  const desenho = criarDesenhoDeArea({ onAreaDesenhada, onAreaCancelada });
  // Contorno do estado ou do municipio filtrado, o mesmo modulo da busca.
  const limite = criarDestaqueDeLimite();

  const container = el('div', { className: 'pc-mapa__canvas' });
  const aviso = el('div', { className: 'pc-mapa__aviso hidden' });

  // Sem legenda: com uma cor so ela nao explicaria nada, e uma legenda de cinco
  // estados sobre um mapa de um estado so seria pior do que legenda nenhuma.
  //
  // As classes do desenho sao as mesmas da busca (`busca-mapa__controles`,
  // `desenho-controles`): mesmo gesto, mesma aparencia, uma folha de estilo so.
  const raiz = el('div', { className: 'pc-mapa' }, [
    container,
    el('div', { className: 'busca-mapa__controles' }, [desenho.botao]),
    desenho.controles,
    aviso,
  ]);

  /**
   * O id do ponto, venha ele no topo da feicao ou nas propriedades.
   *
   * Le os DOIS porque a fonte e clusterizada: o supercluster refaz as feicoes e
   * o id de topo depende do `promoteId` estar ligado. Ler so o topo ja custou um
   * defeito: o clique chamava a selecao com NaN e nao selecionava nada.
   */
  function idDaFeicao(feicao) {
    if (!feicao) return null;
    const bruto = feicao.id != null ? feicao.id : (feicao.properties || {}).id;
    const id = Number(bruto);
    return Number.isFinite(id) ? id : null;
  }

  function mostrarAviso(texto) {
    aviso.textContent = texto || '';
    aviso.classList.toggle('hidden', !texto);
  }

  async function iniciar() {
    maplibregl = await carregarMapLibre();
    if (destruido) return;
    if (!maplibregl) {
      mostrarAviso('Não foi possível carregar o mapa. A lista continua funcionando.');
      desenho.desabilitar();
      return;
    }

    mapa = new maplibregl.Map({
      container,
      style: ESTILO_OSM,
      bounds: BRASIL,
      fitBoundsOptions: { padding: 24 },
      attributionControl: true,
    });
    // A navegacao vai para a ESQUERDA, como na busca: o canto direito de cima e
    // do botao "Desenhar area", e os dois no mesmo canto se sobreporiam.
    mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    mapa.on('load', () => {
      if (destruido) return;
      pronto = true;

      mapa.addSource(FONTE, {
        type: 'geojson',
        data: ultimaColecao,
        cluster: true,
        clusterRadius: CLUSTER_RAIO,
        clusterMaxZoom: CLUSTER_ZOOM_MAX,
        // O id vem das PROPRIEDADES, e nao do topo da feicao. Com `cluster`
        // ligado o supercluster refaz as feicoes e o id de topo se PERDE:
        // `feature.id` chegava indefinido no clique, e selecionar um ponto no
        // mapa nao selecionava nada. O `promoteId` devolve o id a feicao.
        promoteId: 'id',
      });
      mapa.addSource(FONTE_REALCE, { type: 'geojson', data: colecaoRealce() });

      mapa.addLayer({
        id: 'clusters',
        type: 'circle',
        source: FONTE,
        filter: ['has', 'point_count'],
        paint: {
          // O raio cresce por degrau, e nao continuamente: degrau se compara a
          // olho, rampa continua nao.
          'circle-radius': ['step', ['get', 'point_count'], 16, 25, 22, 100, 28, 500, 34],
          'circle-color': '#0f766e',
          'circle-opacity': 0.85,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      mapa.addLayer({
        id: 'clusters-contagem',
        type: 'symbol',
        source: FONTE,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 13,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });

      // O halo e uma camada propria, e nao um `circle-stroke` do ponto: e ele
      // que engorda no selecionado e no apontado, e mexer no stroke do circulo
      // faria a cor do ponto mudar de tamanho junto. Vem ANTES da camada de
      // pontos para ficar por baixo dela.
      mapa.addLayer({
        id: 'pontos-halo',
        type: 'circle',
        source: FONTE_REALCE,
        paint: {
          'circle-radius': ['case', ['get', 'selecionado'], 14, 12],
          'circle-color': ['case', ['get', 'selecionado'], '#f97316', '#ffffff'],
          'circle-opacity': 0.9,
        },
      });

      mapa.addLayer({
        id: 'pontos',
        type: 'circle',
        source: FONTE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 6,
          'circle-color': COR_PONTO,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#1f2937',
        },
      });

      // Ordem das camadas = ordem de insercao. O contorno do lugar entra sobre
      // os pontos e os grupos, e o desenho por ULTIMO, porque e o gesto em
      // curso e nada pode cobri-lo.
      limite.montar(mapa);
      desenho.montar(mapa);

      // Clique no grupo abre o grupo, e nao seleciona nada: e o gesto que todo
      // mapa agrupado tem, e sem ele o grupo seria um obstaculo.
      mapa.on('click', 'clusters', (evento) => {
        if (desenho.ocupado()) return;
        const feicao = evento.features && evento.features[0];
        if (!feicao) return;
        const fonte = mapa.getSource(FONTE);
        fonte.getClusterExpansionZoom(feicao.properties.cluster_id).then((zoom) => {
          movimentoProgramatico = true;
          mapa.easeTo({ center: feicao.geometry.coordinates, zoom, duration: 400 });
        }).catch(() => {});
      });
      mapa.on('mouseenter', 'clusters', () => {
        if (!desenho.ocupado()) mapa.getCanvas().style.cursor = 'pointer';
      });
      mapa.on('mouseleave', 'clusters', () => {
        if (!desenho.ocupado()) mapa.getCanvas().style.cursor = '';
      });

      // Durante o desenho, o clique marca VERTICE: selecionar o ponto que ficou
      // debaixo do cursor faria dois gestos ao mesmo tempo.
      mapa.on('click', 'pontos', (evento) => {
        if (desenho.ocupado()) return;
        const id = idDaFeicao(evento.features && evento.features[0]);
        if (id !== null && onAlternarSelecao) onAlternarSelecao(id);
      });
      mapa.on('mousemove', 'pontos', (evento) => {
        if (desenho.ocupado()) return;
        mapa.getCanvas().style.cursor = 'pointer';
        const id = idDaFeicao(evento.features && evento.features[0]);
        if (id !== null && onApontar) onApontar(id);
      });
      mapa.on('mouseleave', 'pontos', () => {
        if (!desenho.ocupado()) mapa.getCanvas().style.cursor = '';
        if (onApontar) onApontar(null);
      });

      mapa.on('moveend', () => {
        if (movimentoProgramatico) {
          movimentoProgramatico = false;
          return;
        }
        // Desenhar nao e navegar: o arrasto de vertice move o mapa e dispararia
        // uma consulta que ninguem pediu.
        if (desenho.ocupado()) return;
        if (onMover) onMover();
      });

      // O container nasce com altura zero dentro de um layout que ainda esta
      // se montando. Sem isto o mapa fica com um canvas de 0 px e a tela
      // aparece em branco, sem erro nenhum.
      if (typeof ResizeObserver === 'function') {
        observador = new ResizeObserver(() => mapa && mapa.resize());
        observador.observe(container);
      }

      aplicarColecao();
      aplicarRealce();
      if (enquadramentoPendente) {
        enquadrar(enquadramentoPendente);
        enquadramentoPendente = null;
      }
    });
  }

  function aplicarColecao() {
    if (!pronto || !mapa) return;
    const fonte = mapa.getSource(FONTE);
    if (fonte) fonte.setData(ultimaColecao);
  }

  /** O selecionado e o apontado, como colecao propria. */
  function colecaoRealce() {
    const feicoes = [];
    const marcar = (id, selecionado) => {
      const coord = porId.get(id);
      if (!coord) return;
      feicoes.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coord },
        properties: { selecionado },
      });
    };
    for (const id of selecionados) marcar(id, true);
    if (apontado !== null && !selecionados.has(apontado)) marcar(apontado, false);
    return { type: 'FeatureCollection', features: feicoes };
  }

  /** Redesenha so a fonte de realce, que tem poucas feicoes. */
  function aplicarRealce() {
    if (!pronto || !mapa) return;
    const fonte = mapa.getSource(FONTE_REALCE);
    if (fonte) fonte.setData(colecaoRealce());
  }

  function enquadrar(caixa) {
    movimentoProgramatico = true;
    mapa.fitBounds([[caixa[0], caixa[1]], [caixa[2], caixa[3]]], {
      padding: 48, maxZoom: 14, duration: 0,
    });
  }

  return {
    elemento: raiz,

    iniciar,

    /** @param {Array<Object>} pontos - itens com id, cod_ponto, latitude, longitude */
    mostrar(pontos) {
      porId = new Map();
      const feicoes = [];
      for (const p of pontos || []) {
        if (p.longitude == null || p.latitude == null) continue;
        const id = Number(p.id);
        porId.set(id, [Number(p.longitude), Number(p.latitude)]);
        feicoes.push({
          type: 'Feature',
          // O id vai NAS DUAS partes: no topo, para quem le a colecao crua, e
          // nas propriedades, porque e de la que o `promoteId` da fonte
          // clusterizada o recupera depois que o supercluster refaz a feicao.
          id,
          geometry: { type: 'Point', coordinates: [Number(p.longitude), Number(p.latitude)] },
          properties: {
            id,
            cod_ponto: p.cod_ponto,
            tipo_situacao: Number(p.tipo_situacao),
          },
        });
      }
      ultimaColecao = { type: 'FeatureCollection', features: feicoes };
      aplicarColecao();
      aplicarRealce();
    },

    setSelecionados(ids) {
      selecionados = new Set([...ids].map(Number));
      aplicarRealce();
    },

    setApontado(id) {
      apontado = id === null || id === undefined ? null : Number(id);
      aplicarRealce();
    },

    /**
     * Leva o mapa ATE um ponto. Ponto nao tem extensao, entao e voo com zoom
     * fixo, e nao `fitBounds`.
     * @returns {boolean} false quando o ponto nao esta no mapa
     */
    enquadrarPonto(id) {
      const coord = porId.get(Number(id));
      if (!coord || !pronto || !mapa) return false;
      movimentoProgramatico = true;
      mapa.easeTo({
        center: coord,
        zoom: Math.max(mapa.getZoom(), ZOOM_DO_PONTO),
        duration: 600,
      });
      return true;
    },

    /** @param {[number,number,number,number]} caixa - [minLon,minLat,maxLon,maxLat] */
    enquadrar(caixa) {
      if (!caixa) return;
      if (!pronto || !mapa) {
        enquadramentoPendente = caixa;
        return;
      }
      // Caixa degenerada (um ponto so, ou todos na mesma coordenada) faria o
      // fitBounds ir ao zoom maximo do mundo. Vira voo ao centro.
      if (caixa[0] === caixa[2] && caixa[1] === caixa[3]) {
        movimentoProgramatico = true;
        mapa.easeTo({ center: [caixa[0], caixa[1]], zoom: ZOOM_DO_PONTO, duration: 0 });
        return;
      }
      enquadrar(caixa);
    },

    /** @returns {string|null} 'minx,miny,maxx,maxy' da area visivel */
    caixaVisivel() {
      if (!pronto || !mapa) return null;
      const b = mapa.getBounds();
      return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
        .map(n => n.toFixed(6))
        .join(',');
    },

    aviso: mostrarAviso,

    /** Desenho de área: a página repassa o teclado e restaura o que veio na URL. */
    tratarTecla: desenho.tratarTecla,
    mostrarArea: desenho.mostrarArea,
    limparArea: desenho.limparArea,

    /**
     * Destaque do lugar filtrado.
     *
     * O enquadramento NÃO é marcado como programático de propósito: no modo
     * "só na área do mapa" a câmera define o recorte, então o `moveend` tem de
     * disparar a consulta. Suprimi-lo deixaria a lista falando de uma área que
     * não é mais a que está na tela.
     */
    destacarLimite: limite.mostrar,
    limparLimite: limite.limpar,

    destruir() {
      destruido = true;
      desenho.destruir();
      if (observador) observador.disconnect();
      if (mapa) mapa.remove();
      mapa = null;
    },
  };
}
