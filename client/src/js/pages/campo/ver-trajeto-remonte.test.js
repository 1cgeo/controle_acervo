import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A REPRODUCAO DO CHEFE, 2026-08-13: "quando eu parto da tabela SEM ter
// inicializado o mapa funciona, mas se eu inicializar o mapa antes da erro".
//
// Este arquivo usa o mapa DE VERDADE (`campo-mapa.js`), e nao um duble dele: o
// defeito esta na conversa entre a pagina, as abas e o MapLibre, e um duble do
// mapa apagaria justamente a conversa. Quem e dublado e o MapLibre, e o duble
// REPRODUZ A REGRA QUE ENVENENA: dimensao 0 deixa a matriz nula, e dai todo
// `unproject` devolve NaN -- que e o "Invalid LngLat object: (NaN, NaN)" do
// console.
//
// O jsdom nao faz layout, entao `clientWidth` e sempre 0. Aqui ele e definido
// por uma funcao que devolve 0 QUANDO O ELEMENTO ESTA FORA DO DOCUMENTO, que e
// exatamente o que o navegador faz -- e e o que acontece ao trocar de aba,
// porque `createTabs` LIMPA o painel e destaca o conteiner.

const mapLibre = vi.hoisted(() => ({
  instancias: [],
}));

vi.mock('@components/mapa/base.js', async (importarOriginal) => {
  const original = await importarOriginal();

  class MapaFalso {
    constructor (opcoes) {
      this.container = opcoes.container;
      this._ouvintes = {};
      this._envenenado = false;
      this.chamadas = [];
      mapLibre.instancias.push(this);
      // O construtor do MapLibre faz um `fitBounds` proprio por causa do
      // `bounds` mais `fitBoundsOptions`.
      this._medir('construcao', opcoes.fitBoundsOptions.padding);
    }

    // A REGRA QUE ENVENENA. `_calcMatrices` do MapLibre desiste quando a altura
    // e 0 e as matrizes ficam nulas; e o espaco util negativo faz o zoom sair
    // NaN. Nos dois casos o transform nao se recupera.
    _medir (origem, padding = 0) {
      const l = this.container.clientWidth;
      const a = this.container.clientHeight;
      this.chamadas.push({ origem, l, a, padding });
      if (l <= 0 || a <= 0 || (l - 2 * padding) <= 0 || (a - 2 * padding) <= 0) {
        this._envenenado = true;
      }
    }

    addControl () {}

    on (evento, a, b) {
      const fn = typeof a === 'function' ? a : b;
      (this._ouvintes[evento] = this._ouvintes[evento] || []).push(fn);
    }

    disparar (evento) { for (const fn of this._ouvintes[evento] || []) fn(); }

    addSource (id) { (this._fontes = this._fontes || {})[id] = { setData () {} }; }

    getSource (id) { return (this._fontes || {})[id]; }

    addLayer () {}

    setFeatureState () {}

    getCanvas () { return { style: {} }; }

    resize () { this._medir('resize'); }

    fitBounds (limites, opcoes) { this._medir('fitBounds', opcoes.padding); }

    remove () { this._removido = true; }
  }

  return {
    ...original,
    carregarMapLibre: async () => ({
      Map: MapaFalso,
      NavigationControl: class {},
      ScaleControl: class {},
    }),
  };
});

vi.mock('@services/campo-service.js', () => ({
  getDominioCampo: vi.fn(),
  listarCampos: vi.fn(),
  getCamposGeojson: vi.fn(),
  getCampo: vi.fn(),
  excluirCampo: vi.fn(),
  listarTracksCampo: vi.fn(),
  criarTrackCampo: vi.fn(),
  excluirTrackCampo: vi.fn(),
  listarImagensCampo: vi.fn(() => Promise.resolve([])),
  urlDaImagemCampo: vi.fn(),
}));

vi.mock('@services/plataforma-service.js', () => ({
  getUsuarios: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@store/auth-store.js', () => ({
  temPerfil: () => false,
  isAdmin: () => false,
  getToken: () => 'x',
}));

import { renderCampo } from '@/js/pages/campo/list.js';
import {
  getDominioCampo, listarCampos, getCamposGeojson, getCampo, listarTracksCampo,
} from '@services/campo-service.js';

const CAMPO = {
  id: 45,
  nome: 'Reambulação (EBGeo) Cascavel 2026',
  ano: 2026,
  situacao_id: 3,
  situacao: 'Finalizado',
  data_inicio: '2026-07-26',
  data_fim: '2026-08-04',
  categorias: [],
  militares: [],
  versoes: [],
  total_imagens: 0,
  total_tracks: 1,
};

const TRACK = {
  id: 77,
  campo_id: 45,
  placa_vtr: 'IXX-5290',
  dia: '2026-07-27',
  chefe_vtr: '3º Sgt Caio Sabadin',
  motorista: 'Cb Bueno',
  pontos: 4105,
  geometria: {
    type: 'LineString',
    coordinates: [[-54.58, -30.06], [-53.0, -27.0], [-51.17, -24.06]],
  },
};

const GEOJSON = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    id: 45,
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[[[-54.5, -25.75], [-53.5, -25.75], [-53.5, -24], [-54.5, -24], [-54.5, -25.75]]]],
    },
    properties: { ...CAMPO, ponto_lon: -54, ponto_lat: -24.8 },
  }],
};

// O TAMANHO SEGUE O DOCUMENTO, como no navegador: elemento destacado mede 0.
function dimensionarPeloDocumento (elemento, largura, altura) {
  Object.defineProperty(elemento, 'clientWidth', {
    configurable: true,
    get: () => (elemento.isConnected ? largura : 0),
  });
  Object.defineProperty(elemento, 'clientHeight', {
    configurable: true,
    get: () => (elemento.isConnected ? altura : 0),
  });
}

const botaoPorTexto = (raiz, texto) => [...raiz.querySelectorAll('button')]
  .find(b => b.textContent.includes(texto));

// O conteiner do mapa so existe depois que a aba Mapa monta uma primeira vez.
function prepararConteiner () {
  const canvas = document.querySelector('.campo-mapa__canvas');
  if (canvas && !Object.getOwnPropertyDescriptor(canvas, 'clientWidth')) {
    dimensionarPeloDocumento(canvas, 1000, 520);
  }
  return canvas;
}

async function montarPagina () {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const desmontar = await renderCampo(container, {});
  await flush();
  return { container, desmontar };
}

const abrirAba = async (container, nome) => {
  botaoPorTexto(container, nome).click();
  await flush();
  prepararConteiner();
  await flush();
};

const envenenados = () => mapLibre.instancias.filter(m => m._envenenado);

beforeEach(() => {
  document.body.innerHTML = '';
  mapLibre.instancias = [];
  global.ResizeObserver = class {
    constructor (fn) { this._fn = fn; mapLibre.observador = this; }

    observe () {}

    disconnect () {}
  };

  getDominioCampo.mockResolvedValue({ situacoes: [], categorias: [], anos: [] });
  listarCampos.mockResolvedValue([CAMPO]);
  getCamposGeojson.mockResolvedValue(GEOJSON);
  getCampo.mockResolvedValue(CAMPO);
  listarTracksCampo.mockResolvedValue([TRACK]);
});

const verNoMapa = async (container) => {
  container.querySelector('[title="Abrir a ficha"]').click();
  await flush();
  botaoPorTexto(document.body, 'Trajetos').click();
  await flush();
  botaoPorTexto(document.body, 'Ver no mapa').click();
  await flush();
  prepararConteiner();
  // O layout do navegador chega depois: e o observador que avisa.
  if (mapLibre.observador) mapLibre.observador._fn();
  await flush();
  // O mapa recem-construido so fica pronto no `load`.
  for (const m of mapLibre.instancias) m.disparar('load');
  await flush();
};

describe('"Ver no mapa" com o mapa JA inicializado', () => {
  // O CAMINHO QUE FUNCIONA, pela palavra do chefe: sem nunca abrir a aba Mapa.
  test('partindo da tabela, sem nunca ter aberto o mapa', async () => {
    const { container } = await montarPagina();
    await verNoMapa(container);

    expect(mapLibre.instancias.length).toBeGreaterThan(0);
    expect(envenenados().map(m => m.chamadas)).toEqual([]);
  });

  // O CAMINHO QUE QUEBRA: abrir a aba Mapa, voltar para a Tabela e so entao
  // mandar ver o trajeto. Entre um e outro o conteiner e DESTACADO.
  test('abrindo a aba Mapa antes, voltando e so entao pedindo o trajeto', async () => {
    const { container } = await montarPagina();

    await abrirAba(container, 'Mapa');
    for (const m of mapLibre.instancias) m.disparar('load');
    await flush();
    expect(envenenados()).toEqual([]);

    // Volta para a Tabela: `createTabs` limpa o painel e destaca o conteiner.
    await abrirAba(container, 'Tabela');
    if (mapLibre.observador) mapLibre.observador._fn();
    await flush();

    await verNoMapa(container);

    const maus = envenenados();
    expect(maus.map(m => m.chamadas.filter(c => c.l <= 0 || c.a <= 0))).toEqual([]);
  });
});
