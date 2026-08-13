import { el } from '@utils/dom.js';
import { ESTILO_OSM, BRASIL, carregarMapLibre, caixaDeVarias } from '@components/mapa/base.js';
import './campo.css';

/**
 * Mapa das atividades de campo.
 *
 * Um polígono por campo, pintado pela SITUAÇÃO, um MARCADOR no meio dele, mais
 * as linhas dos trajetos do campo selecionado. É a visão que a tabela não dá:
 * "onde a Divisão esteve".
 *
 * A COR SAI DA SITUAÇÃO, e não da finalidade, porque um campo tem VÁRIAS
 * finalidades (a soma das categorias dos 54 campos do SAP dá 90) e uma feição
 * tem uma cor. Situação é única por campo e é o que muda com o tempo.
 *
 * AS CORES SÃO AS DO SAP, de propósito: quem vem da tela de lá reconhece azul
 * como previsto e verde como finalizado sem reaprender nada.
 *
 * O MARCADOR NÃO É ENFEITE, E SEM ELE O MAPA MENTE. Medido em 2026-08-13 contra
 * o banco de produção: os 54 campos vão de 0,010 km2 (MGCP TG 35, uns 180 m de
 * lado) a 12.595 km2 (Cascavel 2026), e DEZ deles ficam fora do Brasil (Europa,
 * Abu Dhabi, Auckland). O enquadramento que cabe os 54 abre quase o mundo
 * inteiro, e nesse zoom o polígono do maior tem poucos pixels e o do menor é
 * sub-pixel: a camada de preenchimento não desenha nada, e a tela parece dizer
 * que os campos não existem. O círculo é desenhado em pixels de TELA e não
 * encolhe com a escala, então ele aparece em qualquer zoom.
 *
 * O PONTO VEM DO SERVIDOR (`ponto_lon`/`ponto_lat`, por `ST_PointOnSurface`), e
 * não do centro da caixa envolvente: o centro da caixa de um polígono em C ou em
 * U cai FORA dele. O centro da caixa fica só como plano B, para o caso de a
 * resposta vir de um servidor sem as duas propriedades.
 */

const FONTE = 'campos';
// O IDENTIFICADOR DIZ "ponto", e a prosa continua dizendo "marcador":
// `modules/orcamento/poda-do-orcamento.test.js` varre TODO o fonte do client
// atras da palavra `marcador` em CODIGO, que morreu junto com a coluna
// `nota_credito.marcador` em 2026-08-08. A colisao e so de palavra.
const FONTE_PONTO = 'campos-ponto';
const FONTE_TRACK = 'campo-tracks';

/**
 * As cores dos trajetos, quando há mais de um na tela.
 *
 * A LINHA CARREGA A PRÓPRIA COR numa propriedade, e a camada só a lê: um campo
 * pode ter até 14 trajetos (medido no acervo: 76 trajetos em 12 campos), e uma
 * cor só faria os dias de viatura diferentes virarem um rabisco único.
 */
const CORES_TRAJETO = [
  '#6a1b9a', '#ef6c00', '#00838f', '#c2185b',
  '#2e7d32', '#4527a0', '#5d4037', '#0277bd',
];

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
 *            setTracks:Function, focar:Function, enquadrar:Function,
 *            selecionar:Function, redimensionar:Function, _cleanup:Function}}
 */
export function criarMapaCampos({ onSelecionar } = {}) {
  let maplibregl = null;
  let mapa = null;
  let pronto = false;
  let destruido = false;
  let observador = null;
  let colecao = { type: 'FeatureCollection', features: [] };
  let marcadores = { type: 'FeatureCollection', features: [] };
  let tracks = { type: 'FeatureCollection', features: [] };
  let enquadramentoPendente = true;
  // O alvo que alguém pediu e o mapa ainda não pôde atender por não ter
  // carregado. Ver `aplicar()`.
  let alvoPendente = null;

  const container = el('div', { className: 'campo-mapa__canvas' });
  const aviso = el('p', { className: 'campo-mapa__aviso hidden' });

  const legenda = el('div', { className: 'campo-mapa__legenda hidden' }, [
    ...LEGENDA.map(f => el('span', { className: 'campo-mapa__legenda-item' }, [
      el('i', { className: 'campo-mapa__legenda-cor', style: `background:${f.cor}` }),
      f.rotulo,
    ])),
    // A FRASE EXISTE PORQUE O CÍRCULO NÃO SE EXPLICA SOZINHO: sem ela, quem vê
    // 54 pontos e nenhuma área conclui que o cadastro não tem polígono.
    el('span', {
      className: 'campo-mapa__legenda-nota',
      textContent: 'O círculo marca o campo em qualquer escala. A área aparece ao aproximar.',
    }),
  ]);

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

    // O OBSERVADOR ENTRA ANTES DA CONSTRUÇÃO, e essa ordem é o conserto de
    // 2026-08-13. Ele não serve só para redimensionar: é ele que CONSTRÓI o
    // mapa quando o contêiner ganha tamanho.
    if (typeof ResizeObserver === 'function') {
      observador = new ResizeObserver(aoTerTamanho);
      observador.observe(element);
    }

    // Já tem tamanho? Constrói agora. Sem `ResizeObserver` não há como esperar,
    // e aí vale mais tentar do que nunca desenhar.
    if (typeof ResizeObserver !== 'function' || !semTamanho()) aoTerTamanho();
  }

  /**
   * O único lugar que constrói e que redimensiona, e nenhum dos dois acontece
   * com o contêiner em 0x0.
   *
   * O CONSTRUTOR DO MapLibre JÁ FAZ UM `fitBounds`, por causa do `bounds` mais
   * `fitBoundsOptions` abaixo, e ele o faz com o tamanho do contêiner NAQUELE
   * instante. Construir num contêiner sem layout nasce com o `transform`
   * envenenado: `_calcMatrices` desiste quando a altura é 0, as matrizes ficam
   * nulas, e a partir daí todo `unproject` devolve NaN. O sintoma é uma chuva de
   * "Invalid LngLat object: (NaN, NaN)" a cada movimento do mouse, sem nenhuma
   * linha nossa na pilha -- foi o que sobreviveu à primeira leva de travas, que
   * cobria o `resize` e o `fitBounds` e deixava a CONSTRUÇÃO de fora.
   *
   * Por que o contêiner estaria em 0x0 aqui, eu não observei: a aba é montada e
   * o elemento é anexado antes de `iniciar()`. Esta trava fecha a classe inteira
   * em vez de apostar numa causa -- o mapa passa a nascer quando houver tamanho,
   * seja qual for a razão de não haver antes.
   */
  function aoTerTamanho() {
    if (destruido || !maplibregl || semTamanho()) return;

    if (!mapa) {
      try {
        montarMapa();
      } catch (err) {
        falhar(err && err.message
          ? `Não foi possível desenhar o mapa: ${err.message}`
          : 'Não foi possível desenhar o mapa nesta máquina.');
      }
      return;
    }

    mapa.resize();
    // O tamanho voltou: o alvo que ficou esperando pode ser aplicado agora.
    soltarAlvoPendente();
  }

  function montarMapa() {
    mapa = new maplibregl.Map({
      container,
      style: ESTILO_OSM,
      bounds: BRASIL,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
      // O MapLibre TAMBÉM observa o contêiner, por conta própria, e o dele é o
      // observador que não obedece às travas desta casa. Dois problemas nascem
      // dele, e os dois só aparecem com a aba fora de foco:
      //
      //   1. Ele é ATRASADO em 50 ms. O redimensionamento cai depois de a tela
      //      já ter mudado, e pode aterrissar no meio de um `fitBounds`.
      //   2. Ele INVENTA tamanho. `_containerDimensions()` faz
      //      `clientWidth || 400` e `clientHeight || 300`: com o contêiner
      //      DESTACADO do documento -- que é o estado normal ao sair da aba,
      //      porque `createTabs` limpa o painel -- ele redimensiona o
      //      `transform` para 400x300, um tamanho que ninguém pediu e que não é
      //      o da tela.
      //
      // Quem redimensiona aqui é o observador desta casa, que recusa 0x0 e usa
      // o tamanho REAL. Ter os dois é ter dois donos do mesmo `transform`.
      trackResize: false,
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
          // A COR VEM DA FEIÇÃO, e o literal é só o que sobra quando ela falta.
          // `to-color` NÃO é enfeite: `get` devolve o tipo genérico `value`, e
          // sem a conversão explícita o MapLibre recusa a expressão inteira na
          // validação do estilo, dizendo que esperava uma cor.
          'line-color': ['to-color', ['coalesce', ['get', 'cor'], '#6a1b9a']],
          'line-width': 2.5,
          'line-opacity': 0.9,
        },
      });

      // O MARCADOR É A ÚLTIMA CAMADA, e a ordem é deliberada: ele é o que a
      // pessoa mira quando o polígono é pequeno demais para ser mirado, e ficar
      // por baixo da linha do trajeto o tornaria inalcançável ao clique
      // justamente no campo que tem trajeto.
      mapa.addSource(FONTE_PONTO, { type: 'geojson', data: marcadores });
      mapa.addLayer({
        id: 'campos-ponto',
        type: 'circle',
        source: FONTE_PONTO,
        paint: {
          'circle-color': COR_POR_SITUACAO,
          // O RAIO ENCOLHE AO SE APROXIMAR, e não o contrário. De longe o
          // marcador é a única coisa visível e precisa ser mirável; de perto o
          // polígono já mostra a área de verdade, e um círculo grande em cima
          // dele esconderia o que a pessoa foi ver.
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            2, ['case', ['boolean', ['feature-state', 'selecionado'], false], 9, 6],
            8, ['case', ['boolean', ['feature-state', 'selecionado'], false], 8, 5.5],
            13, ['case', ['boolean', ['feature-state', 'selecionado'], false], 6, 4],
          ],
          // O CONTORNO BRANCO É O QUE SEPARA O MARCADOR DO FUNDO: sem ele, o
          // verde de "finalizado" some sobre a mancha verde da vegetação no OSM.
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': [
            'case', ['boolean', ['feature-state', 'selecionado'], false], 2.5, 1.5,
          ],
          'circle-opacity': 0.95,
        },
      });

      pronto = true;
      legenda.classList.remove('hidden');
      // PELO PORTÃO, e não `mapa.resize()` direto: entre a construção e o
      // `load` o contêiner pode ter perdido o tamanho (trocar de aba basta), e
      // redimensionar para 0 aqui envenenaria o mapa recém-nascido.
      if (!semTamanho()) mapa.resize();
      aplicar();
    });

    // O MARCADOR CLICA COMO O POLÍGONO, e as duas camadas mandam para o mesmo
    // lugar: quem enxerga só o ponto (que é o caso de longe) tem de conseguir
    // abrir a ficha sem antes adivinhar onde ampliar.
    for (const camada of ['campos-preenchimento', 'campos-ponto']) {
      mapa.on('click', camada, (e) => {
        if (!e.features.length) return;
        // A feição de CIMA é a primeira da lista, e é a menor pelo
        // `fill-sort-key` acima: é a que a pessoa mirou.
        const id = e.features[0].id ?? e.features[0].properties.id;
        selecionar(Number(id));
        if (onSelecionar) onSelecionar(Number(id));
      });

      mapa.on('mouseenter', camada, () => {
        mapa.getCanvas().style.cursor = 'pointer';
      });
      mapa.on('mouseleave', camada, () => {
        mapa.getCanvas().style.cursor = '';
      });
    }
  }

  let selecionado = null;

  // O DESTAQUE VALE NAS DUAS FONTES. O `feature-state` é por FONTE, e marcar só
  // a do polígono deixaria o marcador do campo escolhido igual aos outros 53 --
  // que é o único aviso visível quando o polígono não cabe num pixel.
  function marcar(id, valor) {
    if (id == null || !pronto) return;
    for (const fonte of [FONTE, FONTE_PONTO]) {
      if (mapa.getSource(fonte)) {
        mapa.setFeatureState({ source: fonte, id }, { selecionado: valor });
      }
    }
  }

  function selecionar(id) {
    marcar(selecionado, false);
    selecionado = id;
    marcar(selecionado, true);
  }

  /**
   * O contêiner tem tamanho utilizável?
   *
   * SAI ZERO O TEMPO TODO, e não é caso raro. As abas montam o conteúdo sob
   * demanda: ao sair da aba Mapa, `createTabs` LIMPA o painel e o contêiner é
   * DESTACADO do documento, enquanto o mapa continua vivo para não repagar meio
   * megabyte de MapLibre na volta. Destacado, `clientWidth` é 0.
   */
  const semTamanho = () => !(container.clientWidth > 0 && container.clientHeight > 0);

  /**
   * O `fitBounds`, com as duas travas que faltavam em 2026-08-13.
   *
   * CONTEINER SEM TAMANHO ENVENENA O MAPA PARA SEMPRE. O `fitBounds` divide o
   * espaço disponível pela extensão da caixa, e com largura 0 o disponível é
   * `0 - 2*padding`, um NEGATIVO: o zoom sai NaN, o centro vira NaN e o
   * `transform` não se recupera. O sintoma aparece longe daqui -- todo movimento
   * do mouse passa a lançar "Invalid LngLat object: (NaN, NaN)", e o
   * `_calcMatrices` quebra em cima de matriz nula. Por isso o alvo é GUARDADO em
   * vez de aplicado, e o `ResizeObserver` o solta quando o tamanho voltar.
   *
   * A FOLGA NUNCA COME O CONTEINER INTEIRO. Medido: com 120px de largura, o
   * padding de 60 zera o espaço disponível e o zoom sai -Infinity, com o mesmo
   * estrago. A folga cede ao tamanho da tela, porque a alternativa é não
   * desenhar.
   *
   * A folga pedida é maior no alvo explícito (60) que no enquadramento de todos
   * (40): ali importa a feição não encostar na borda, aqui importa caber.
   */
  function ajustar(caixa, opcoes) {
    if (destruido) return false;
    if (semTamanho()) {
      alvoPendente = { caixa, opcoes };
      return false;
    }
    const menorLado = Math.min(container.clientWidth, container.clientHeight);
    const folga = Math.max(0, Math.min(opcoes.padding, Math.floor(menorLado / 2) - 1));
    mapa.fitBounds([[caixa[0], caixa[1]], [caixa[2], caixa[3]]], {
      padding: folga,
      maxZoom: opcoes.maxZoom,
      duration: opcoes.duration,
    });
    return true;
  }

  /** Solta o alvo que ficou esperando tamanho. */
  function soltarAlvoPendente() {
    if (!alvoPendente || !pronto || destruido) return;
    const alvo = alvoPendente;
    alvoPendente = null;
    // `ajustar` guarda de novo sozinho se o tamanho ainda não voltou.
    ajustar(alvo.caixa, alvo.opcoes);
  }

  function aplicar() {
    if (!pronto || destruido) return;
    mapa.getSource(FONTE).setData(colecao);
    mapa.getSource(FONTE_PONTO).setData(marcadores);
    mapa.getSource(FONTE_TRACK).setData(tracks);

    // O ALVO EXPLÍCITO GANHA DO AUTOMÁTICO, e a ordem aqui é a correção de
    // 2026-08-13. `enquadrar` pode ser chamado ANTES de o mapa carregar: quem
    // abre a aba do mapa pela primeira vez espera o `iniciar()`, que só termina
    // de CONSTRUIR o mapa -- o evento `load` vem depois. Sem guardar o alvo, o
    // pedido caía no vazio e o `load` enquadrava o mundo todo, que é o que se
    // via ao mandar "Ver no mapa" a partir da tabela.
    if (alvoPendente) {
      soltarAlvoPendente();
      enquadramentoPendente = false;
      return;
    }

    if (enquadramentoPendente && colecao.features.length) {
      const caixa = caixaDeVarias(colecao.features.map(f => f.geometry));
      if (caixa) ajustar(caixa, { maxZoom: 12, padding: 40, duration: 0 });
      enquadramentoPendente = false;
    }
  }

  /**
   * Troca os campos do mapa.
   *
   * O `area_ordem` é calculado AQUI, e não no servidor: é só a caixa
   * envolvente, serve para ordenar o desenho e não tem uso fora do mapa.
   * Mandá-lo pelo GeoJSON engordaria a resposta que a tabela também consome.
   *
   * `manterEnquadramento` EXISTE PARA O "Ver no mapa", e ele conserta o pulo de
   * 2026-08-13: a troca de campos re-enquadra TUDO por padrão, e com a aba do
   * mapa já aberta isso dava um zoom out no mundo inteiro um instante antes do
   * zoom in no trajeto. Quem já sabe para onde vai pede para o automático não
   * disparar, e o mapa vai direto ao alvo.
   *
   * @param {Object} featureCollection
   * @param {{manterEnquadramento?:boolean}} [opcoes]
   */
  function setCampos(featureCollection, opcoes = {}) {
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
    marcadores = {
      type: 'FeatureCollection',
      features: colecao.features.map(pontoDoCampo).filter(Boolean),
    };
    // O enquadramento se refaz a cada troca de FILTRO: mudar de ano e continuar
    // olhando o Rio Grande do Sul quando os campos daquele ano foram no Acre
    // deixaria a tela vazia sem dizer por quê.
    if (!opcoes.manterEnquadramento) enquadramentoPendente = true;
    aplicar();
  }

  /**
   * O marcador de um campo: o ponto do servidor, com o centro da caixa de plano B.
   *
   * `ponto_lon`/`ponto_lat` vêm de `ST_PointOnSurface`, que garante um ponto
   * DENTRO do polígono. O centro da caixa envolvente não garante nada disso, e é
   * por isso que ele fica só como o que sobra quando a resposta não traz o par.
   */
  function pontoDoCampo(feature) {
    const props = feature.properties || {};
    let lon = Number(props.ponto_lon);
    let lat = Number(props.ponto_lat);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      const caixa = caixaDeVarias([feature.geometry]);
      if (!caixa) return null;
      lon = (caixa[0] + caixa[2]) / 2;
      lat = (caixa[1] + caixa[3]) / 2;
    }

    return {
      type: 'Feature',
      id: feature.id,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        id: props.id,
        nome: props.nome,
        situacao_id: props.situacao_id,
      },
    };
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
        .map((t, i) => ({
          type: 'Feature',
          geometry: t.geometria,
          properties: {
            id: t.id,
            placa_vtr: t.placa_vtr,
            dia: t.dia,
            cor: CORES_TRAJETO[i % CORES_TRAJETO.length],
          },
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
    enquadrar(feature.geometry, 14);
  }

  /**
   * Enquadra UMA geometria qualquer. É o que o botão "Ver no mapa" do trajeto usa.
   *
   * O TETO DE ZOOM É PARÂMETRO porque o alvo muda de tamanho por ordens de
   * grandeza: a área de um campo vai de 0,010 km2 a 12.595 km2, e um trajeto de
   * viatura de um dia é uma linha fina e comprida. Sem teto, o polígono de 180 m
   * de lado levaria a tela ao zoom máximo e a pessoa perderia toda referência
   * ao redor.
   *
   * ELE ACEITA SER CHAMADO ANTES DE O MAPA CARREGAR, e isso não é conveniência.
   * `iniciar()` só termina de CONSTRUIR o mapa: o evento `load`, que é quando as
   * fontes existem, vem depois. Quem abre a aba do mapa pela primeira vez e
   * manda enquadrar chega exatamente nessa janela, e antes de 2026-08-13 o
   * pedido caía no vazio -- o `load` então enquadrava todos os campos, e o
   * "Ver no mapa" a partir da tabela terminava mostrando o mundo.
   *
   * @param {Object} geometria - GeoJSON de qualquer tipo
   * @param {number} [maxZoom]
   * @returns {boolean} falso quando não havia o que enquadrar
   */
  function enquadrar(geometria, maxZoom = 14) {
    if (destruido) return false;
    const caixa = caixaDeVarias([geometria]);
    if (!caixa) return false;

    // O enquadramento automático não pode desfazer o que a pessoa acabou de
    // pedir para ver, nem antes nem depois do `load`.
    enquadramentoPendente = false;

    // SEM ANIMAÇÃO, e nos dois caminhos. Quem clicou "Ver no mapa" quer VER o
    // trajeto, e não sobrevoar o país até ele. Animar também deixava o mapa num
    // estado transitório por meio segundo, aberto a redimensionamento e a
    // clique no meio do voo -- e este mapa acabava de ser remontado numa aba.
    const opcoes = { maxZoom, padding: 60, duration: 0 };
    if (!pronto) {
      alvoPendente = { caixa, opcoes };
      return true;
    }
    ajustar(caixa, opcoes);
    return true;
  }

  // A ABA CHAMA ISTO AO (RE)MONTAR, e nesse instante o contêiner pode ainda não
  // ter layout. Passa pelo mesmo portão do observador, que também CONSTRÓI o
  // mapa se ele ainda não existir por falta de tamanho.
  function redimensionar() {
    aoTerTamanho();
  }

  function _cleanup() {
    destruido = true;
    if (observador) observador.disconnect();
    if (mapa) mapa.remove();
    mapa = null;
  }

  return {
    element, iniciar, setCampos, setTracks, focar, enquadrar, selecionar,
    redimensionar, _cleanup,
  };
}
