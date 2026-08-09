import { el } from '@utils/dom.js';
import { ESTILO_OSM, BRASIL, carregarMapLibre, caixaDeVarias } from '@components/mapa/base.js';
import './campo.css';

/**
 * Mapa das atividades de campo.
 *
 * Um polígono por campo, pintado pela SITUAÇÃO, mais as linhas dos trajetos do
 * campo selecionado. É a visão que a tabela não dá: "onde a Divisão esteve".
 *
 * A COR SAI DA SITUAÇÃO, e não da finalidade, porque um campo tem VÁRIAS
 * finalidades (a soma das categorias dos 54 campos do SAP dá 90) e uma feição
 * tem uma cor. Situação é única por campo e é o que muda com o tempo.
 *
 * AS CORES SÃO AS DO SAP, de propósito: quem vem da tela de lá reconhece azul
 * como previsto e verde como finalizado sem reaprender nada.
 */

const FONTE = 'campos';
const FONTE_TRACK = 'campo-tracks';

/** campo.situacao: 1 Previsto, 2 Em execução, 3 Finalizado, 4 Cancelado. */
const COR_POR_SITUACAO = [
  'match', ['get', 'situacao_id'],
  1, '#2196f3',
  2, '#f9a825',
  3, '#43a047',
  4, '#e53935',
  '#43a047',
];

export const LEGENDA = [
  { id: 1, cor: '#2196f3', rotulo: 'Previsto' },
  { id: 2, cor: '#f9a825', rotulo: 'Em execução' },
  { id: 3, cor: '#43a047', rotulo: 'Finalizado' },
  { id: 4, cor: '#e53935', rotulo: 'Cancelado' },
];

/**
 * @param {Object} opts
 * @param {(id:number)=>void} [opts.onSelecionar] - clique num campo
 * @returns {{element:HTMLElement, iniciar:Function, setCampos:Function,
 *            setTracks:Function, focar:Function, redimensionar:Function,
 *            _cleanup:Function}}
 */
export function criarMapaCampos({ onSelecionar } = {}) {
  let maplibregl = null;
  let mapa = null;
  let pronto = false;
  let destruido = false;
  let observador = null;
  let colecao = { type: 'FeatureCollection', features: [] };
  let tracks = { type: 'FeatureCollection', features: [] };
  let enquadramentoPendente = true;

  const container = el('div', { className: 'campo-mapa__canvas' });
  const aviso = el('p', { className: 'campo-mapa__aviso hidden' });

  const legenda = el('div', { className: 'campo-mapa__legenda hidden' },
    LEGENDA.map(f => el('span', { className: 'campo-mapa__legenda-item' }, [
      el('i', { className: 'campo-mapa__legenda-cor', style: `background:${f.cor}` }),
      f.rotulo,
    ])));

  const element = el('div', { className: 'campo-mapa' }, [container, legenda, aviso]);

  const falhar = (mensagem) => {
    aviso.textContent = mensagem;
    aviso.classList.remove('hidden');
    container.classList.add('hidden');
  };

  async function iniciar() {
    if (mapa || destruido) return;

    maplibregl = await carregarMapLibre();
    if (destruido) return;
    if (!maplibregl) {
      // Sem a biblioteca a TABELA continua servindo: a tela não morre por não
      // conseguir desenhar. É a mesma regra do resto da casa -- a chamada que
      // falha carrega sozinha, e a falha fica na seção dela.
      falhar('Não foi possível carregar o mapa. A lista continua disponível na aba Tabela.');
      return;
    }

    // O MapLibre lê o tamanho do contêiner UMA vez, na construção, e não volta a
    // conferir sozinho. Contêiner ainda sem layout produz canvas 0x0
    // permanente, e aqui ele nasce dentro de uma aba que pode estar escondida.
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
    mapa.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

    mapa.on('load', () => {
      mapa.addSource(FONTE, { type: 'geojson', data: colecao });

      // Translúcido: campos de anos diferentes se sobrepõem (a mesma folha
      // reambulada duas vezes), e opaco esconderia o de baixo e o fundo que dá
      // o contexto geográfico.
      mapa.addLayer({
        id: 'campos-preenchimento',
        type: 'fill',
        source: FONTE,
        layout: {
          // O MENOR desenha por cima. Um voo de drone de poucos hectares dentro
          // da área de uma reambulação inteira ficaria inalcançável ao clique
          // se a ordem fosse a de chegada.
          'fill-sort-key': ['-', 0, ['get', 'area_ordem']],
        },
        paint: {
          'fill-color': COR_POR_SITUACAO,
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selecionado'], false], 0.75,
            0.35,
          ],
        },
      });

      mapa.addLayer({
        id: 'campos-contorno',
        type: 'line',
        source: FONTE,
        paint: {
          'line-color': COR_POR_SITUACAO,
          'line-width': ['case', ['boolean', ['feature-state', 'selecionado'], false], 3, 1.2],
        },
      });

      // OS TRAJETOS ENTRAM DEPOIS DOS POLÍGONOS, e a ordem é o desenho: a linha
      // da viatura tem de ficar visível POR CIMA da área do campo que ela
      // percorreu.
      mapa.addSource(FONTE_TRACK, { type: 'geojson', data: tracks });
      mapa.addLayer({
        id: 'tracks-linha',
        type: 'line',
        source: FONTE_TRACK,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#6a1b9a',
          'line-width': 2.5,
          'line-opacity': 0.9,
        },
      });

      pronto = true;
      legenda.classList.remove('hidden');
      mapa.resize();
      aplicar();
    });

    mapa.on('click', 'campos-preenchimento', (e) => {
      if (!e.features.length) return;
      // A feição de CIMA é a primeira da lista, e é a menor pelo `fill-sort-key`
      // acima: é a que a pessoa mirou.
      const id = e.features[0].id ?? e.features[0].properties.id;
      selecionar(Number(id));
      if (onSelecionar) onSelecionar(Number(id));
    });

    mapa.on('mouseenter', 'campos-preenchimento', () => {
      mapa.getCanvas().style.cursor = 'pointer';
    });
    mapa.on('mouseleave', 'campos-preenchimento', () => {
      mapa.getCanvas().style.cursor = '';
    });
  }

  let selecionado = null;

  function marcar(id, valor) {
    if (id == null || !pronto || !mapa.getSource(FONTE)) return;
    mapa.setFeatureState({ source: FONTE, id }, { selecionado: valor });
  }

  function selecionar(id) {
    marcar(selecionado, false);
    selecionado = id;
    marcar(selecionado, true);
  }

  function aplicar() {
    if (!pronto || destruido) return;
    mapa.getSource(FONTE).setData(colecao);
    mapa.getSource(FONTE_TRACK).setData(tracks);

    if (enquadramentoPendente && colecao.features.length) {
      const caixa = caixaDeVarias(colecao.features.map(f => f.geometry));
      if (caixa) {
        mapa.fitBounds([[caixa[0], caixa[1]], [caixa[2], caixa[3]]], {
          padding: 40, maxZoom: 12, duration: 0,
        });
      }
      enquadramentoPendente = false;
    }
  }

  /**
   * Troca os campos do mapa.
   *
   * O `area_ordem` é calculado AQUI, e não no servidor: é só a caixa
   * envolvente, serve para ordenar o desenho e não tem uso fora do mapa.
   * Mandá-lo pelo GeoJSON engordaria a resposta que a tabela também consome.
   */
  function setCampos(featureCollection) {
    const features = (featureCollection && featureCollection.features) || [];
    colecao = {
      type: 'FeatureCollection',
      features: features.map(f => {
        const caixa = caixaDeVarias([f.geometry]);
        const area = caixa ? (caixa[2] - caixa[0]) * (caixa[3] - caixa[1]) : 0;
        return {
          ...f,
          id: f.id ?? f.properties.id,
          properties: { ...f.properties, area_ordem: area },
        };
      }),
    };
    // O enquadramento se refaz a cada troca de FILTRO: mudar de ano e continuar
    // olhando o Rio Grande do Sul quando os campos daquele ano foram no Acre
    // deixaria a tela vazia sem dizer por quê.
    enquadramentoPendente = true;
    aplicar();
  }

  /**
   * Os trajetos do campo SELECIONADO, e não os de todos.
   *
   * São 491.325 pontos no acervo do SAP. Desenhar os 76 trajetos de uma vez
   * levaria megabytes de linha para uma tela onde só um campo está em foco.
   */
  function setTracks(lista) {
    tracks = {
      type: 'FeatureCollection',
      features: (lista || [])
        .filter(t => t.geometria)
        .map(t => ({
          type: 'Feature',
          geometry: t.geometria,
          properties: { id: t.id, placa_vtr: t.placa_vtr, dia: t.dia },
        })),
    };
    if (pronto) mapa.getSource(FONTE_TRACK).setData(tracks);
  }

  /** Enquadra UM campo e o marca. Usado quando a tabela manda "ver no mapa". */
  function focar(id) {
    selecionar(id);
    if (!pronto) return;
    const feature = colecao.features.find(f => Number(f.id) === Number(id));
    if (!feature) return;
    const caixa = caixaDeVarias([feature.geometry]);
    if (caixa) {
      mapa.fitBounds([[caixa[0], caixa[1]], [caixa[2], caixa[3]]], {
        padding: 60, maxZoom: 14,
      });
    }
    enquadramentoPendente = false;
  }

  function redimensionar() {
    if (mapa) mapa.resize();
  }

  function _cleanup() {
    destruido = true;
    if (observador) observador.disconnect();
    if (mapa) mapa.remove();
    mapa = null;
  }

  return { element, iniciar, setCampos, setTracks, focar, redimensionar, _cleanup };
}
