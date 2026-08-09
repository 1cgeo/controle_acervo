import { el } from '@utils/dom.js';
import { ESTILO_OSM, BRASIL, carregarMapLibre, caixaDeVarias } from '@components/mapa/base.js';
import { urlTileLinhaProducao, camadaDaTile } from '@services/producao-service.js';

/**
 * O mapa dos acompanhamentos da produção.
 *
 * DUAS FONTES, E ELAS NÃO SÃO ALTERNATIVAS UMA DA OUTRA:
 *
 *   GeoJSON  a view materializada escolhida, com TODAS as colunas dela. É o que
 *            pinta a situação da folha, porque as colunas de fase só existem
 *            aqui.
 *   TILE     a camada vetorial da LINHA DE PRODUÇÃO inteira, sobre todos os
 *            lotes que a executam. Ela carrega só as oito colunas fixas do
 *            gerador (`id`, `uuid`, `nome`, `mi`, `inom`, `escala`,
 *            `subtipo_produto`, `geom`) -- as de fase são DINÂMICAS, mudam
 *            quando a linha ganha fase, e uma tile que as carregasse mudaria de
 *            esquema sozinha. Por isso ela entra como CONTORNO, e não como
 *            preenchimento: ela responde "onde a linha de produção alcança", e
 *            não "como está indo".
 *
 * O TOKEN DA TILE VAI NA URL, e é o único lugar do sistema onde isso acontece.
 * Ver `urlTileLinhaProducao` em `services/producao-service.js`.
 *
 * TILE VAZIA NÃO É ERRO. O servidor responde 204 em dois casos normais: a linha
 * de produção ainda não tem view materializada nenhuma (nenhum lote com etapa
 * nela), ou a tile pedida não cobre feição alguma. O MapLibre entende 204 como
 * "aqui não há nada" e segue; um 404 é que o faria marcar a camada como
 * quebrada. Nada nesta tela pinta de vermelho por causa de um 204.
 */

const FONTE_GEOJSON = 'acompanhamento';
const FONTE_TILE = 'linha-producao-tile';
const CAMADA_TILE = 'linha-producao-contorno';

/**
 * As cores da SITUAÇÃO da folha, e elas são as do SAP de propósito: quem vem da
 * tela de lá reconhece o verde escuro como concluído sem reaprender nada.
 */
export const LEGENDA = [
  { id: 'concluido', cor: 'rgb(26,152,80)', rotulo: 'Concluída' },
  { id: 'em_execucao', cor: 'rgb(252,141,89)', rotulo: 'Em execução' },
  { id: 'nao_iniciado', cor: '#607d8b', rotulo: 'Não iniciada' },
];

const COR_POR_SITUACAO = [
  'match', ['get', 'situacao_acompanhamento'],
  'concluido', 'rgb(26,152,80)',
  'em_execucao', 'rgb(252,141,89)',
  '#607d8b',
];

/** O valor que o gerador escreve numa fase PULADA por aquele produto. */
const PULADA = '-';

const PADRAO_FASE = /^f_(\d+)_(.+)_data_(inicio|fim)$/;

/**
 * As fases de uma feição da view de acompanhamento.
 *
 * AS COLUNAS SÃO DINÂMICAS: o gerador cria duas por fase da linha de produção
 * (`f_1_preparo_data_inicio`, `f_1_preparo_data_fim`, `f_2_extracao_...`), e o
 * conjunto muda quando a linha ganha fase. Por isso elas se descobrem lendo as
 * chaves, e não por uma lista escrita aqui: uma lista fixa deixaria a fase nova
 * invisível, sem erro nenhum.
 *
 * @param {Object} propriedades
 * @returns {Array<{ordem:number, nome:string, inicio:*, fim:*, pulada:boolean}>}
 */
export function fasesDaFeicao(propriedades) {
  const porFase = new Map();

  for (const [chave, valor] of Object.entries(propriedades || {})) {
    const achado = PADRAO_FASE.exec(chave);
    if (!achado) continue;
    const id = `${achado[1]}_${achado[2]}`;
    if (!porFase.has(id)) {
      porFase.set(id, {
        ordem: Number(achado[1]),
        nome: achado[2].replace(/_/g, ' '),
        inicio: null,
        fim: null,
      });
    }
    porFase.get(id)[achado[3] === 'inicio' ? 'inicio' : 'fim'] = valor;
  }

  return [...porFase.values()]
    .map(f => ({ ...f, pulada: f.inicio === PULADA && f.fim === PULADA }))
    .sort((a, b) => a.ordem - b.ordem);
}

const preenchida = (valor) => valor != null && valor !== PULADA && valor !== '';

/**
 * A situação da folha, a partir das fases que ela tem.
 *
 * A FASE PULADA NÃO CONTA. O gerador escreve `'-'` nas duas datas da fase que
 * aquele produto não percorre, e tratá-la como pendente deixaria eternamente "em
 * execução" toda folha que pula uma fase -- que é a maioria delas.
 *
 * @param {Object} propriedades
 * @returns {'concluido'|'em_execucao'|'nao_iniciado'|'sem_fase'}
 */
export function situacaoDaFeicao(propriedades) {
  const fases = fasesDaFeicao(propriedades).filter(f => !f.pulada);
  if (!fases.length) return 'sem_fase';

  const todasFechadas = fases.every(f => preenchida(f.inicio) && preenchida(f.fim));
  if (todasFechadas) return 'concluido';
  if (fases.some(f => preenchida(f.inicio))) return 'em_execucao';
  return 'nao_iniciado';
}

/**
 * @returns {{element:HTMLElement, iniciar:Function, setFeicoes:Function,
 *            setTile:Function, redimensionar:Function, _cleanup:Function}}
 */
export function criarMapaAcompanhamento() {
  let maplibregl = null;
  let mapa = null;
  let pronto = false;
  let destruido = false;
  let observador = null;
  let colecao = { type: 'FeatureCollection', features: [] };
  let linhaTile = null;
  let enquadramentoPendente = true;

  const container = el('div', { className: 'producao-mapa__canvas' });
  const aviso = el('p', { className: 'producao-mapa__aviso hidden' });

  const legenda = el('div', { className: 'producao-mapa__legenda hidden' }, [
    ...LEGENDA.map(f => el('span', { className: 'producao-mapa__legenda-item' }, [
      el('i', { className: 'producao-mapa__legenda-cor', style: `background:${f.cor}` }),
      f.rotulo,
    ])),
    el('span', { className: 'producao-mapa__legenda-item producao-mapa__legenda-item--tile hidden' }, [
      el('i', { className: 'producao-mapa__legenda-linha' }),
      'Recorte da linha de produção (tiles)',
    ]),
  ]);

  const element = el('div', { className: 'producao-mapa' }, [container, legenda, aviso]);

  const marcaTile = legenda.querySelector('.producao-mapa__legenda-item--tile');

  const falhar = (mensagem) => {
    aviso.textContent = mensagem;
    aviso.classList.remove('hidden');
  };

  const limparAviso = () => {
    aviso.textContent = '';
    aviso.classList.add('hidden');
  };

  async function iniciar() {
    if (mapa || destruido) return;

    maplibregl = await carregarMapLibre();
    if (destruido) return;
    if (!maplibregl) {
      // Sem a biblioteca a tela NÃO morre: o seletor de camada e os avisos
      // continuam servindo, e a falha fica onde ela é.
      falhar('Não foi possível carregar o mapa nesta máquina. O restante da tela continua disponível.');
      container.classList.add('hidden');
      return;
    }

    // O MapLibre lê o tamanho do contêiner UMA vez, na construção, e não volta a
    // conferir sozinho.
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

    // O `load` É ASSÍNCRONO, e a página pode ter sido trocada antes dele. Sem
    // esta guarda, sair da tela enquanto o mapa ainda montava estourava um
    // TypeError DEPOIS do cleanup, fora de qualquer `try`: o `_cleanup` já tinha
    // soltado a instância. Vale para os quatro ouvintes daqui.
    mapa.on('load', () => {
      if (destruido || !mapa) return;
      mapa.addSource(FONTE_GEOJSON, { type: 'geojson', data: colecao });

      mapa.addLayer({
        id: 'acompanhamento-preenchimento',
        type: 'fill',
        source: FONTE_GEOJSON,
        paint: { 'fill-color': COR_POR_SITUACAO, 'fill-opacity': 0.45 },
      });

      mapa.addLayer({
        id: 'acompanhamento-contorno',
        type: 'line',
        source: FONTE_GEOJSON,
        paint: { 'line-color': COR_POR_SITUACAO, 'line-width': 1 },
      });

      pronto = true;
      legenda.classList.remove('hidden');
      mapa.resize();
      aplicar();
      aplicarTile();
    });

    // A FALHA DA TILE FICA NA TILE. O `error` do MapLibre chega com o `sourceId`,
    // e sem esse filtro a falha do fundo do OSM (que vem da internet, e nesta
    // rede cai) seria anunciada como problema da produção.
    mapa.on('error', (evento) => {
      if (destruido) return;
      if (!evento || evento.sourceId !== FONTE_TILE) return;
      falhar('Não foi possível buscar os tiles da linha de produção. '
        + 'A camada de situação, que vem por outra rota, continua na tela.');
    });

    mapa.on('click', 'acompanhamento-preenchimento', (e) => {
      if (destruido || !mapa) return;
      if (!e || !e.features || !e.features.length) return;
      abrirDetalhe(e.lngLat, e.features[0].properties || {});
    });

    mapa.on('mouseenter', 'acompanhamento-preenchimento', () => {
      if (destruido || !mapa) return;
      mapa.getCanvas().style.cursor = 'pointer';
    });
    mapa.on('mouseleave', 'acompanhamento-preenchimento', () => {
      if (destruido || !mapa) return;
      mapa.getCanvas().style.cursor = '';
    });
  }

  function abrirDetalhe(lngLat, propriedades) {
    const fases = fasesDaFeicao(propriedades);
    const conteudo = el('div', { className: 'producao-mapa__popup' }, [
      el('strong', { textContent: propriedades.nome || propriedades.mi || 'Folha' }),
      el('p', { textContent: [propriedades.mi, propriedades.inom].filter(Boolean).join('  ') }),
      el('ul', {}, fases.map(f => el('li', {
        textContent: f.pulada
          ? `${f.nome}: não se aplica`
          : `${f.nome}: ${preenchida(f.inicio) ? f.inicio : 'não iniciada'}`
            + `${preenchida(f.fim) ? ` até ${f.fim}` : ''}`,
      }))),
    ]);

    new maplibregl.Popup({ closeButton: true })
      .setLngLat(lngLat)
      .setDOMContent(conteudo)
      .addTo(mapa);
  }

  function aplicar() {
    if (!pronto || destruido) return;
    mapa.getSource(FONTE_GEOJSON).setData(colecao);

    if (enquadramentoPendente && colecao.features.length) {
      const caixa = caixaDeVarias(colecao.features.map(f => f.geometry));
      if (caixa) {
        mapa.fitBounds([[caixa[0], caixa[1]], [caixa[2], caixa[3]]], {
          padding: 40, maxZoom: 11, duration: 0,
        });
      }
      enquadramentoPendente = false;
    }
  }

  /**
   * Troca a camada de tiles.
   *
   * A FONTE SE REFAZ, e não se esconde: a URL do molde XYZ carrega o id da linha
   * de produção, e MapLibre nenhum troca a URL de uma fonte viva. Esconder a
   * camada deixaria a fonte antiga buscando tiles de uma linha que já saiu da
   * tela.
   */
  function aplicarTile() {
    if (!pronto || destruido) return;

    if (mapa.getLayer && mapa.getLayer(CAMADA_TILE)) mapa.removeLayer(CAMADA_TILE);
    if (mapa.getSource(FONTE_TILE)) mapa.removeSource(FONTE_TILE);

    if (linhaTile == null) {
      marcaTile.classList.add('hidden');
      return;
    }

    mapa.addSource(FONTE_TILE, {
      type: 'vector',
      tiles: [urlTileLinhaProducao(linhaTile)],
      minzoom: 0,
      maxzoom: 14,
    });

    mapa.addLayer({
      id: CAMADA_TILE,
      type: 'line',
      source: FONTE_TILE,
      // O NOME DA CAMADA DENTRO DA TILE é contrato do servidor
      // (`ST_AsMVT(q, 'linha_producao_<id>', ...)`). Errá-lo não dá erro nenhum:
      // a camada simplesmente não desenha.
      'source-layer': camadaDaTile(linhaTile),
      paint: { 'line-color': '#3949ab', 'line-width': 1.5, 'line-dasharray': [2, 1] },
    });

    marcaTile.classList.remove('hidden');
  }

  /** Troca as feições da view escolhida. */
  function setFeicoes(featureCollection) {
    const features = (featureCollection && featureCollection.features) || [];
    colecao = {
      type: 'FeatureCollection',
      features: features.map(f => ({
        ...f,
        // A SITUAÇÃO É CALCULADA AQUI, e não no servidor: ela sai das colunas de
        // fase, que são dinâmicas, e existe só para o MapLibre escolher a cor.
        // Mandá-la pelo GeoJSON obrigaria o servidor a conhecer o esquema
        // variável que ele mesmo gera.
        properties: {
          ...f.properties,
          situacao_acompanhamento: situacaoDaFeicao(f.properties),
        },
      })),
    };
    // O enquadramento se refaz a cada troca de CAMADA: continuar olhando o lote
    // anterior deixaria a tela vazia sem dizer por quê.
    enquadramentoPendente = true;
    limparAviso();
    aplicar();
  }

  /**
   * Liga ou desliga a camada de tiles.
   * @param {number|string|null} linhaProducaoId - null desliga
   */
  function setTile(linhaProducaoId) {
    linhaTile = linhaProducaoId == null ? null : linhaProducaoId;
    aplicarTile();
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

  return { element, iniciar, setFeicoes, setTile, redimensionar, _cleanup };
}
