import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { ESTILO_OSM, BRASIL, carregarMapLibre, caixaDeVarias } from '@components/mapa/base.js';
import './mapa-entregas.css';

/**
 * Mapa das entregas da mapoteca.
 *
 * Uma feição por PRODUTO do acervo, pintada pela quantidade de exemplares que
 * saiu no ano. É a pergunta "onde a gente entregou", que nenhum dos gráficos
 * respondia: eles somam por tipo, por mídia e por operação, todos sem lugar.
 *
 * As faixas saem da distribuição real de 2026 (banco de produção, 2026-07-28):
 * mediana 4, p75 13, p90 25, máximo 81. Faixas iguais espremeriam quase tudo na
 * primeira cor, porque a cauda é longa e a base é enorme (99 produtos com um
 * exemplar só).
 */

const FONTE = 'entregas';
/**
 * Os rótulos saem de uma fonte de PONTOS, separada dos polígonos.
 *
 * Rotulando o polígono, a mesma carta aparecia duas vezes: o MapLibre corta o
 * GeoJSON em ladrilhos e escolhe a âncora do texto por pedaço, então a folha
 * que cruza a borda de um ladrilho ganha um rótulo de cada lado. A deduplicação
 * entre ladrilhos não pega esse caso, porque as duas âncoras ficam longe uma da
 * outra. Um ponto cabe num ladrilho só.
 */
const FONTE_ROTULO = 'entregas-pontos';

const FAIXAS = [
  { ate: 1, cor: '#bbdefb', rotulo: '1 exemplar' },
  { ate: 5, cor: '#90caf9', rotulo: '2 a 5' },
  { ate: 20, cor: '#42a5f5', rotulo: '6 a 20' },
  { ate: 50, cor: '#1976d2', rotulo: '21 a 50' },
  { ate: Infinity, cor: '#0d47a1', rotulo: '51 ou mais' },
];

/** Expressao `step` do MapLibre a partir das faixas. */
function corPorQuantidade() {
  const expr = ['step', ['get', 'total_produtos'], FAIXAS[0].cor];
  for (let i = 1; i < FAIXAS.length; i += 1) {
    expr.push(FAIXAS[i - 1].ate + 1, FAIXAS[i].cor);
  }
  return expr;
}

/**
 * @returns {{element:HTMLElement, iniciar:Function, setEntregas:Function, redimensionar:Function, _cleanup:Function}}
 */
export function criarMapaEntregas() {
  let maplibregl = null;
  let mapa = null;
  let pronto = false;
  let destruido = false;
  let observador = null;
  let popup = null;
  let apontado = null;
  let colecao = { type: 'FeatureCollection', features: [] };
  let rotulos = { type: 'FeatureCollection', features: [] };
  let enquadramentoPendente = true;

  const container = el('div', { className: 'mapa-entregas__canvas' });
  const aviso = el('div', { className: 'mapa-entregas__aviso hidden' });

  const legenda = el('div', { className: 'mapa-entregas__legenda hidden' }, [
    el('span', { className: 'mapa-entregas__legenda-titulo', textContent: 'Exemplares entregues' }),
    ...FAIXAS.map(f => el('div', { className: 'mapa-entregas__legenda-item' }, [
      el('span', {
        className: 'mapa-entregas__amostra',
        style: { background: f.cor },
      }),
      el('span', { textContent: f.rotulo }),
    ])),
  ]);

  const element = el('div', { className: 'mapa-entregas' }, [container, legenda, aviso]);

  function falhar(mensagem) {
    aviso.replaceChildren(svgIcon(ICONS.warning, 18), el('span', { textContent: mensagem }));
    aviso.classList.remove('hidden');
  }

  async function iniciar() {
    if (mapa || destruido) return;

    maplibregl = await carregarMapLibre();
    if (!maplibregl) {
      falhar('Não foi possível carregar o mapa. Os números do painel continuam valendo.');
      return;
    }
    if (destruido) return;

    // O MapLibre le o tamanho do contêiner UMA vez, na construcao, e nao volta a
    // conferir sozinho. Contêiner ainda sem layout produz canvas 0x0 permanente,
    // e aqui ele nasce dentro de uma aba que pode estar escondida.
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

    popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: '280px',
      className: 'mapa-entregas__popup',
    });

    mapa.on('load', () => {
      mapa.addSource(FONTE, { type: 'geojson', data: colecao });

      // Translucido: com cartas sobrepostas, opaco esconderia o que esta embaixo
      // e o fundo que da o contexto geografico.
      mapa.addLayer({
        id: 'entregas-preenchimento',
        type: 'fill',
        source: FONTE,
        layout: {
          // O mapeamento e ANINHADO por escala: a folha 1:25.000 fica dentro da
          // 1:100.000, que fica dentro da 1:250.000. Sem ordem explicita, a
          // folha grande podia cair por cima da pequena e engoli-la, inclusive
          // para o clique. Chave maior desenha por cima, entao a area negativa
          // poe sempre a MENOR no topo.
          'fill-sort-key': ['-', 0, ['get', 'area']],
        },
        paint: {
          'fill-color': corPorQuantidade(),
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'apontado'], false], 0.85,
            0.55,
          ],
        },
      });

      mapa.addLayer({
        id: 'entregas-contorno',
        type: 'line',
        source: FONTE,
        paint: {
          'line-color': '#0d47a1',
          'line-width': ['case', ['boolean', ['feature-state', 'apontado'], false], 2.5, 0.6],
        },
      });

      // O rotulo e o MI, que e como a carta e pedida e conferida. Produto
      // ESPECIAL (campo de instrucao, carta de OM) nao tem MI, e ai o nome e a
      // unica identificacao que existe. So a partir do zoom 8: mais longe, os
      // rotulos viram uma mancha.
      mapa.addSource(FONTE_ROTULO, { type: 'geojson', data: rotulos });
      mapa.addLayer({
        id: 'entregas-rotulo',
        type: 'symbol',
        source: FONTE_ROTULO,
        minzoom: 8,
        layout: {
          'text-field': ['coalesce', ['get', 'mi'], ['get', 'nome']],
          'text-font': ['Open Sans Regular'],
          'text-size': 12,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#212121',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        },
      });

      pronto = true;
      legenda.classList.remove('hidden');
      mapa.resize();
      aplicar();
    });

    ligarInteracoes();
  }

  function ligarInteracoes() {
    mapa.on('mousemove', 'entregas-preenchimento', (e) => {
      if (!e.features.length) return;
      const feature = e.features[0];
      if (apontado !== feature.id) {
        marcar(apontado, false);
        apontado = feature.id;
        marcar(apontado, true);
      }
      mapa.getCanvas().style.cursor = 'pointer';
      popup.setLngLat(e.lngLat).setDOMContent(conteudoPopup(feature.properties)).addTo(mapa);
    });

    mapa.on('mouseleave', 'entregas-preenchimento', () => {
      marcar(apontado, false);
      apontado = null;
      mapa.getCanvas().style.cursor = '';
      popup.remove();
    });
  }

  function marcar(id, valor) {
    if (id === null || id === undefined || !pronto) return;
    mapa.setFeatureState({ source: FONTE, id }, { apontado: valor });
  }

  function conteudoPopup(props) {
    const linha = (rotulo, valor) => el('div', { className: 'mapa-entregas__popup-linha' }, [
      el('span', { className: 'mapa-entregas__popup-rotulo', textContent: rotulo }),
      el('span', { textContent: valor }),
    ]);

    return el('div', {}, [
      el('strong', { textContent: props.nome || 'Produto sem nome' }),
      props.mi ? el('div', { className: 'mapa-entregas__popup-mi', textContent: props.mi }) : null,
      el('div', { className: 'mapa-entregas__popup-corpo' }, [
        linha('Exemplares', formatNumber(props.total_produtos)),
        linha('Pedidos', formatNumber(props.total_pedidos)),
        linha('OMs atendidas', formatNumber(props.total_clientes)),
        linha('Tipo', props.tipo_produto || '-'),
        linha('Escala', props.escala || '-'),
      ]),
    ].filter(Boolean));
  }

  function aplicar() {
    if (!pronto) return;
    mapa.getSource(FONTE).setData(colecao);
    mapa.getSource(FONTE_ROTULO).setData(rotulos);
    if (enquadramentoPendente) {
      enquadramentoPendente = false;
      enquadrar();
    }
  }

  function enquadrar() {
    const caixa = caixaDeVarias(colecao.features.map(f => f.geometry));
    if (!caixa || !mapa) return;
    const [x1, y1, x2, y2] = caixa;
    mapa.fitBounds([[x1, y1], [x2, y2]], { padding: 40, maxZoom: 11, duration: 600 });
  }

  /**
   * @param {Array<Object>} entregas - com `geom` (GeoJSON), `id` e os totais
   * @param {{reenquadrar?:boolean}} [opcoes]
   */
  function setEntregas(entregas, { reenquadrar = true } = {}) {
    const comGeometria = (entregas || []).filter(e => e.geom);

    colecao = {
      type: 'FeatureCollection',
      // O `id` no topo da feature (e nao so em properties) e o que permite
      // setFeatureState: sem ele nao ha realce nenhum ao passar o mouse.
      features: comGeometria.map(e => ({
        type: 'Feature',
        id: e.id,
        properties: {
          id: e.id,
          nome: e.nome,
          mi: e.mi || null,
          tipo_produto: e.tipo_produto,
          escala: e.escala,
          total_pedidos: e.total_pedidos,
          total_clientes: e.total_clientes,
          total_produtos: e.total_produtos,
          area: e.area || 0,
        },
        geometry: e.geom,
      })),
    };

    // Um ponto por produto, so com o texto do rotulo. Ver o comentario de
    // FONTE_ROTULO: e isto que impede a mesma carta de ser rotulada duas vezes.
    rotulos = {
      type: 'FeatureCollection',
      features: comGeometria
        .filter(e => e.ponto)
        .map(e => ({
          type: 'Feature',
          id: e.id,
          properties: { mi: e.mi || null, nome: e.nome },
          geometry: e.ponto,
        })),
    };
    // Trocar o ano reenquadra; o refresh de 60 s, nao: puxar o mapa de volta
    // enquanto a pessoa esta olhando uma regiao seria tirar a tela da mao dela.
    if (reenquadrar) enquadramentoPendente = true;
    aplicar();
  }

  function redimensionar() {
    if (mapa) mapa.resize();
  }

  function _cleanup() {
    destruido = true;
    if (observador) { observador.disconnect(); observador = null; }
    if (popup) { popup.remove(); popup = null; }
    if (mapa) { mapa.remove(); mapa = null; pronto = false; }
  }

  return { element, iniciar, setEntregas, redimensionar, _cleanup };
}
