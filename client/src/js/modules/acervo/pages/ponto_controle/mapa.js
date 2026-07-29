import { el } from '@utils/dom.js';
import { ESTILO_OSM, BRASIL, carregarMapLibre } from '@components/mapa/base.js';

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
 * Nao ha desenho de area: o recorte do ponto de controle e a area VISIVEL do
 * mapa, porque a pergunta de campo e "que pontos existem nesta regiao".
 */

const FONTE = 'pontos';
/** Zoom ao enquadrar UM ponto. Perto o bastante para ver o entorno do marco. */
const ZOOM_DO_PONTO = 15;

/**
 * Cor por situacao.
 *
 * Os codigos e os nomes sao os de ponto_controle.tipo_situacao, copiados do
 * er/ponto_controle.sql. NAO invente a ordem: o 3 e APROVADO e o 4 e REPROVADO,
 * e nao o contrario. Trocar os dois pinta o mapa mentindo, e e o unico erro
 * desta tela que ninguem percebe olhando.
 *
 * O verde e o ponto APROVADO, e nao apenas o medido: e a informacao que decide
 * se o dado serve ao ajuste. Situacao desconhecida (9999) fica cinza, e nao
 * invisivel, porque ponto que existe e nao se sabe o estado ainda e um ponto
 * para conferir.
 */
const COR_SITUACAO = [
  'match',
  ['get', 'tipo_situacao'],
  1, '#f59e0b', // Nao medido
  2, '#3b82f6', // Aguardando revisao
  3, '#22c55e', // Aprovado
  4, '#ef4444', // Reprovado
  '#94a3b8', // 9999 (A SER PREENCHIDO) e qualquer codigo novo
];

/**
 * @param {Object} opts
 * @param {(id:number)=>void} opts.onAlternarSelecao - clique num ponto
 * @param {(id:number|null)=>void} [opts.onApontar] - mouse sobre o ponto
 * @param {()=>void} [opts.onMover] - fim de um movimento feito pela PESSOA
 * @returns {Object} controle do mapa
 */
export function criarMapaPontos({ onAlternarSelecao, onApontar, onMover }) {
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

  const container = el('div', { className: 'pc-mapa__canvas' });
  const aviso = el('div', { className: 'pc-mapa__aviso hidden' });

  const legenda = el('div', { className: 'pc-mapa__legenda' }, [
    { cor: '#f59e0b', texto: 'Não medido' },
    { cor: '#3b82f6', texto: 'Aguardando revisão' },
    { cor: '#22c55e', texto: 'Aprovado' },
    { cor: '#ef4444', texto: 'Reprovado' },
    { cor: '#94a3b8', texto: 'Outra' },
  ].map(({ cor, texto }) => el('span', { className: 'pc-mapa__legenda-item' }, [
    el('span', { className: 'pc-mapa__legenda-cor', style: `background:${cor}` }),
    el('span', { textContent: texto }),
  ])));

  const raiz = el('div', { className: 'pc-mapa' }, [container, legenda, aviso]);

  function mostrarAviso(texto) {
    aviso.textContent = texto || '';
    aviso.classList.toggle('hidden', !texto);
  }

  async function iniciar() {
    maplibregl = await carregarMapLibre();
    if (destruido) return;
    if (!maplibregl) {
      mostrarAviso('Não foi possível carregar o mapa. A lista continua funcionando.');
      return;
    }

    mapa = new maplibregl.Map({
      container,
      style: ESTILO_OSM,
      bounds: BRASIL,
      fitBoundsOptions: { padding: 24 },
      attributionControl: true,
    });
    mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    mapa.on('load', () => {
      if (destruido) return;
      pronto = true;

      mapa.addSource(FONTE, { type: 'geojson', data: ultimaColecao });

      // O halo e uma camada propria, e nao um `circle-stroke` do ponto: e ele
      // que engorda no selecionado e no apontado, e mexer no stroke do circulo
      // faria a cor da situacao mudar de tamanho junto.
      mapa.addLayer({
        id: 'pontos-halo',
        type: 'circle',
        source: FONTE,
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['feature-state', 'selecionado'], false], 14,
            ['boolean', ['feature-state', 'apontado'], false], 12,
            9,
          ],
          'circle-color': [
            'case',
            ['boolean', ['feature-state', 'selecionado'], false], '#f97316',
            '#ffffff',
          ],
          'circle-opacity': 0.9,
        },
      });

      mapa.addLayer({
        id: 'pontos',
        type: 'circle',
        source: FONTE,
        paint: {
          'circle-radius': 6,
          'circle-color': COR_SITUACAO,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#1f2937',
        },
      });

      mapa.on('click', 'pontos', (evento) => {
        const feicao = evento.features && evento.features[0];
        if (feicao && onAlternarSelecao) onAlternarSelecao(Number(feicao.id));
      });
      mapa.on('mousemove', 'pontos', (evento) => {
        mapa.getCanvas().style.cursor = 'pointer';
        const feicao = evento.features && evento.features[0];
        if (feicao && onApontar) onApontar(Number(feicao.id));
      });
      mapa.on('mouseleave', 'pontos', () => {
        mapa.getCanvas().style.cursor = '';
        if (onApontar) onApontar(null);
      });

      mapa.on('moveend', () => {
        if (movimentoProgramatico) {
          movimentoProgramatico = false;
          return;
        }
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
      aplicarEstados();
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

  /** Reaplica selecao e realce por `feature-state`, que e barato e nao repinta. */
  function aplicarEstados() {
    if (!pronto || !mapa) return;
    for (const id of porId.keys()) {
      mapa.setFeatureState({ source: FONTE, id }, {
        selecionado: selecionados.has(id),
        apontado: apontado === id,
      });
    }
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
          // O id vai no TOPO da feicao, e nao so nas propriedades: o
          // `setFeatureState` do MapLibre so acha a feicao por ele.
          id,
          geometry: { type: 'Point', coordinates: [Number(p.longitude), Number(p.latitude)] },
          properties: { cod_ponto: p.cod_ponto, tipo_situacao: Number(p.tipo_situacao) },
        });
      }
      ultimaColecao = { type: 'FeatureCollection', features: feicoes };
      aplicarColecao();
      aplicarEstados();
    },

    setSelecionados(ids) {
      selecionados = new Set([...ids].map(Number));
      aplicarEstados();
    },

    setApontado(id) {
      apontado = id === null || id === undefined ? null : Number(id);
      aplicarEstados();
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

    destruir() {
      destruido = true;
      if (observador) observador.disconnect();
      if (mapa) mapa.remove();
      mapa = null;
    },
  };
}
