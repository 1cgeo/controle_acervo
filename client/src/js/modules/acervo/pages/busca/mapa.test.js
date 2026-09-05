import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * O clique no mapa da busca precisa devolver TODOS os poligonos sob o cursor.
 *
 * Existe por um defeito real. Neste acervo a sobreposicao e a regra: a mesma
 * folha tem Carta Topografica, CDGV, Ortoimagem, MDS e MDT, e os cinco gravam a
 * MESMA moldura por INOM. O clique lia so `features[0]`, entao escolhia um deles
 * por um criterio que nao aparece na tela (a ordem de desenho) e deixava os
 * outros quatro inalcancaveis: nao havia onde clicar para chegar neles.
 *
 * O MapLibre tambem repete a mesma feicao quando ela cai em mais de um ladrilho,
 * e sem deduplicar o mesmo produto voltaria varias vezes.
 */

let ouvintes = {};
let camadas = [];

// Dados que cada fonte recebeu, por nome: e o que permite provar que o rotulo
// le PONTOS e nao os poligonos.
let dadosPorFonte = {};

const mapaFalso = {
  addControl: vi.fn(),
  addSource: vi.fn((nome, opcoes) => { dadosPorFonte[nome] = opcoes.data; }),
  addLayer: vi.fn(l => camadas.push(l)),
  getSource: vi.fn(nome => ({ setData: dados => { dadosPorFonte[nome] = dados; } })),
  getCanvas: vi.fn(() => ({ style: {} })),
  getLayer: vi.fn(() => true),
  setFeatureState: vi.fn(),
  removeFeatureState: vi.fn(),
  on: vi.fn((evento, alvoOuFn, talvezFn) => {
    const chave = talvezFn ? `${evento}:${alvoOuFn}` : evento;
    ouvintes[chave] = talvezFn || alvoOuFn;
  }),
  resize: vi.fn(),
  remove: vi.fn(),
  getBounds: vi.fn(),
  easeTo: vi.fn(),
  fitBounds: vi.fn(),
  queryRenderedFeatures: vi.fn(() => []),
};

vi.mock('@components/mapa/base.js', () => ({
  ESTILO_OSM: { version: 8, sources: {}, layers: [] },
  BRASIL: [[-74, -34], [-34, 6]],
  caixaDe: vi.fn(() => [[-51, -31], [-50, -29]]),
  carregarMapLibre: vi.fn(() => Promise.resolve({
    Map: vi.fn(() => mapaFalso),
    NavigationControl: vi.fn(),
    ScaleControl: vi.fn(),
  })),
}));

// Os dublês espelham a API REAL dos dois componentes (o `return` de cada um).
// Um dublê com nomes inventados passaria a montagem e quebraria na primeira
// chamada, que foi o que aconteceu ao escrever este arquivo.
vi.mock('@components/mapa/desenho-area.js', () => ({
  criarDesenhoDeArea: () => ({
    botao: document.createElement('button'),
    controles: document.createElement('div'),
    montar: () => {},
    tratarTecla: () => false,
    mostrarArea: () => {},
    limparArea: () => {},
    // `ocupado()` falso: o modo de desenho nao esta ativo, entao o clique no
    // produto vale. Com ele verdadeiro o mapa ignora o clique de proposito.
    ocupado: () => false,
    desabilitar: () => {},
    destruir: () => {},
  }),
}));

vi.mock('@components/mapa/limite-destaque.js', () => ({
  criarDestaqueDeLimite: () => ({
    montar: () => {},
    mostrar: () => {},
    limpar: () => {},
    montado: () => true,
  }),
}));

import { criarMapa } from './mapa.js';

// Duas folhas com a MESMA moldura: e o caso real do Convenio RS, onde
// Ortoimagem, MDS e MDT cobrem exatamente a celula da Carta Topografica.
const MOLDURA = {
  type: 'Polygon',
  coordinates: [[[-51, -30], [-51, -29], [-50, -29], [-50, -30], [-51, -30]]],
};

const PONTO = { type: 'Point', coordinates: [-50.5, -29.5] };

async function montar() {
  ouvintes = {};
  camadas = [];
  dadosPorFonte = {};
  const recebido = [];
  const mapa = criarMapa({
    onAlternarSelecao: ids => recebido.push(ids),
    onApontar: () => {},
    onAreaDesenhada: () => {},
    onAreaCancelada: () => {},
  });
  await mapa.iniciar();
  ouvintes.load();
  mapa.setProdutos([
    { id: 10, nome: 'Garibaldi (CT)', mi: '2952-1-SO', geom: MOLDURA, ponto: PONTO, area: 1 },
    { id: 11, nome: 'Garibaldi (Orto)', mi: '2952-1-SO', geom: MOLDURA, ponto: PONTO, area: 1 },
    { id: 12, nome: 'Garibaldi (MDS)', mi: '2952-1-SO', geom: MOLDURA, ponto: PONTO, area: 1 },
  ]);
  return { mapa, recebido };
}

beforeEach(() => {
  global.ResizeObserver = class { observe() {} disconnect() {} };
});

describe('mapa da busca: clique sobre poligonos sobrepostos', () => {
  test('devolve TODOS os poligonos sob o cursor, na ordem de cima para baixo', async () => {
    const { recebido } = await montar();
    const clique = ouvintes['click:produtos-preenchimento'];
    expect(clique).toBeTypeOf('function');

    // Entram com o de cima primeiro, e os três ids são distintos: a comparação
    // abaixo reprova tanto perder feição quanto embaralhar a pilha.
    clique({
      features: [
        { id: 12, properties: { id: 12 } },
        { id: 11, properties: { id: 11 } },
        { id: 10, properties: { id: 10 } },
      ],
    });

    // A ordem não é detalhe: a página usa a PRIMEIRA para decidir que cartão
    // destacar na lista.
    expect(recebido).toEqual([[12, 11, 10]]);
  });

  test('deduplica a feicao que aparece em mais de um ladrilho', async () => {
    const { recebido } = await montar();

    ouvintes['click:produtos-preenchimento']({
      features: [
        { id: 10, properties: {} },
        { id: 10, properties: {} },
        { id: 11, properties: {} },
        { id: 10, properties: {} },
      ],
    });

    expect(recebido).toEqual([[10, 11]]);
  });

  test('descarta feicao sem id em vez de mandar NaN', async () => {
    const { recebido } = await montar();

    ouvintes['click:produtos-preenchimento']({
      features: [{ properties: {} }, { id: 10, properties: {} }],
    });

    expect(recebido).toEqual([[10]]);
  });

  test('clique sem feicao nenhuma nao avisa a pagina', async () => {
    const { recebido } = await montar();

    ouvintes['click:produtos-preenchimento']({ features: [] });

    expect(recebido).toEqual([]);
  });
});

describe('mapa da busca: rotulo em fonte de PONTOS', () => {
  // O defeito: rotulando o POLIGONO, o MapLibre corta o GeoJSON em ladrilhos e
  // ancora o texto por pedaco, entao a folha que cruza a borda de um ladrilho
  // aparece rotulada DUAS vezes. Foi visto na tela, com um produto
  // so no mapa. Um ponto cabe num ladrilho so.
  test('a camada de rotulo nao le a fonte dos poligonos', async () => {
    await montar();
    const rotulo = camadas.find(c => c.id === 'produtos-rotulo');

    expect(rotulo).toBeTruthy();
    expect(rotulo.type).toBe('symbol');
    expect(rotulo.source).toBe('produtos-pontos');
    expect(rotulo.source).not.toBe('produtos');
  });

  test('a fonte de rotulo recebe um PONTO por produto', async () => {
    await montar();
    const pontos = dadosPorFonte['produtos-pontos'];

    expect(pontos.features).toHaveLength(3);
    for (const f of pontos.features) {
      expect(f.geometry.type).toBe('Point');
    }
    // E o texto que o rotulo desenha continua vindo junto.
    expect(pontos.features[0].properties.mi).toBe('2952-1-SO');
  });

  test('produto sem ponto perde o rotulo, e nao o poligono', async () => {
    // Resposta de servidor mais antigo, sem o campo `ponto`. Sumir com a carta
    // do mapa seria pior do que ela ficar sem nome.
    const mapa = criarMapa({
      onAlternarSelecao: () => {}, onApontar: () => {},
      onAreaDesenhada: () => {}, onAreaCancelada: () => {},
    });
    ouvintes = {}; camadas = []; dadosPorFonte = {};
    await mapa.iniciar();
    ouvintes.load();
    mapa.setProdutos([{ id: 7, nome: 'Sem ponto', geom: MOLDURA }]);

    expect(dadosPorFonte['produtos'].features).toHaveLength(1);
    expect(dadosPorFonte['produtos-pontos'].features).toHaveLength(0);
  });
});

describe('mapa da busca: folha pequena por cima da grande', () => {
  // O mapeamento do SCN e ANINHADO: a 2952-1-SO esta dentro da 2952, que esta
  // dentro da 535. Sem ordenar, a ordem de desenho e a da fonte (por id), e a
  // folha grande cai por cima da pequena e a engole.
  test('o preenchimento ordena pela area NEGATIVA', async () => {
    await montar();
    const fill = camadas.find(c => c.id === 'produtos-preenchimento');

    // `fill-sort-key` desenha do MENOR para o maior; a area negativa faz a folha
    // de menor area ter a maior chave, e portanto ficar por cima.
    expect(fill.layout['fill-sort-key']).toEqual(['-', 0, ['get', 'area']]);
  });

  test('a area viaja em properties, que e de onde o sort-key le', async () => {
    await montar();
    expect(dadosPorFonte['produtos'].features[0].properties.area).toBe(1);
  });

  test('produto sem area nao quebra a ordenacao', async () => {
    const mapa = criarMapa({
      onAlternarSelecao: () => {}, onApontar: () => {},
      onAreaDesenhada: () => {}, onAreaCancelada: () => {},
    });
    ouvintes = {}; camadas = []; dadosPorFonte = {};
    await mapa.iniciar();
    ouvintes.load();
    mapa.setProdutos([{ id: 7, nome: 'Sem area', geom: MOLDURA, ponto: PONTO }]);

    expect(dadosPorFonte['produtos'].features[0].properties.area).toBe(0);
  });
});

/**
 * A CAIXA DA AREA VISIVEL SAI RECORTADA AO MUNDO.
 *
 * O MapLibre repete o globo na horizontal, e o mapa da busca nasce sem `minZoom`
 * e sem `maxBounds`. Afastado o bastante numa tela larga, `getBounds()` devolve
 * oeste menor que -180 e leste maior que 180; o `bboxSchema` do servidor recusa
 * a caixa com 400 e a busca INTEIRA virava estado de erro, com uma frase que nao
 * dizia a pessoa que bastava aproximar o zoom.
 */
describe('mapa da busca: a caixa da area visivel', () => {
  const limites = (o, s, l, n) => ({
    getWest: () => o, getSouth: () => s, getEast: () => l, getNorth: () => n,
  });

  test('recorta a caixa que passa de -180/180 e de -90/90', async () => {
    const { mapa } = await montar();
    mapaFalso.getBounds.mockReturnValue(limites(-241.03, -95.4, 190.7, 92.1));

    expect(mapa.areaVisivel()).toEqual([-180, -90, 180, 90]);
  });

  test('a caixa que ja cabe no mundo passa intacta', async () => {
    const { mapa } = await montar();
    mapaFalso.getBounds.mockReturnValue(limites(-53.2, -31.4, -50.1, -29.6));

    expect(mapa.areaVisivel()).toEqual([-53.2, -31.4, -50.1, -29.6]);
  });
});
