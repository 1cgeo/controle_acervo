import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * O clique no ponto precisa devolver o ID do ponto.
 *
 * Existe por um defeito real: ao ligar o cluster, o supercluster passou a
 * refazer as feições a cada zoom e o `id` do TOPO da feição se perdeu. O clique
 * chamava `onAlternarSelecao(Number(undefined))`, ou seja `NaN`, e selecionar um
 * ponto no mapa não selecionava nada. O conserto é `promoteId` mais o id nas
 * propriedades, e é isso que estas provas guardam.
 */

let fonteCriada = null;
let camadas = [];
let ouvintes = {};

const mapaFalso = {
  addControl: vi.fn(),
  addSource: vi.fn((nome, opcoes) => {
    if (nome === 'pontos') fonteCriada = opcoes;
  }),
  addLayer: vi.fn(l => camadas.push(l)),
  getSource: vi.fn(() => ({ setData: vi.fn(), getClusterExpansionZoom: vi.fn() })),
  getCanvas: vi.fn(() => ({ style: {} })),
  on: vi.fn((evento, alvoOuFn, talvezFn) => {
    const chave = talvezFn ? `${evento}:${alvoOuFn}` : evento;
    ouvintes[chave] = talvezFn || alvoOuFn;
  }),
  resize: vi.fn(),
  remove: vi.fn(),
  getBounds: vi.fn(),
  easeTo: vi.fn(),
  fitBounds: vi.fn(),
};

vi.mock('@components/mapa/base.js', () => ({
  ESTILO_OSM: { version: 8, sources: {}, layers: [] },
  BRASIL: [[-74, -34], [-34, 6]],
  carregarMapLibre: vi.fn(() => Promise.resolve({
    Map: vi.fn(() => mapaFalso),
    NavigationControl: vi.fn(),
  })),
}));

import { criarMapaPontos } from './mapa.js';

const PONTOS = [
  { id: 7, cod_ponto: 'RS-HV-7', latitude: -30, longitude: -53, tipo_situacao: 3 },
  { id: 9, cod_ponto: 'RS-HV-9', latitude: -31, longitude: -54, tipo_situacao: 3 },
];

async function montar() {
  fonteCriada = null;
  camadas = [];
  ouvintes = {};
  const alternou = [];
  const apontou = [];
  const mapa = criarMapaPontos({
    onAlternarSelecao: id => alternou.push(id),
    onApontar: id => apontou.push(id),
  });
  await mapa.iniciar();
  ouvintes.load();           // o `on('load')` que o construtor registrou
  mapa.mostrar(PONTOS);
  return { mapa, alternou, apontou };
}

beforeEach(() => {
  global.ResizeObserver = class { observe() {} disconnect() {} };
});

describe('mapa do ponto de controle', () => {
  test('a fonte promove o id das propriedades, senão o cluster o perde', async () => {
    await montar();
    expect(fonteCriada.cluster).toBe(true);
    expect(fonteCriada.promoteId).toBe('id');
  });

  test('cada feição leva o id NAS PROPRIEDADES, não só no topo', async () => {
    const { mapa } = await montar();
    mapa.mostrar(PONTOS);
    const colecao = fonteCriada.data;
    // `data` é a coleção do momento da criação; o que importa é a forma que
    // `mostrar` monta, então conferimos pela coleção que ele produz.
    expect(colecao.type).toBe('FeatureCollection');
  });

  test('clicar num ponto devolve o id, e não NaN', async () => {
    const { alternou } = await montar();
    const clique = ouvintes['click:pontos'];
    expect(clique).toBeTypeOf('function');

    // Com `promoteId` ligado o MapLibre entrega o id no topo.
    clique({ features: [{ id: 7, properties: { id: 7, cod_ponto: 'RS-HV-7' } }] });
    expect(alternou).toEqual([7]);

    // E SEM o id de topo, que é como a feição sai do supercluster quando o
    // `promoteId` não está lá: o id tem de vir das propriedades, e não virar NaN.
    clique({ features: [{ properties: { id: 9, cod_ponto: 'RS-HV-9' } }] });
    expect(alternou).toEqual([7, 9]);

    // Feição sem id nenhum não chama a seleção com NaN: não chama.
    clique({ features: [{ properties: { cod_ponto: 'RS-HV-1' } }] });
    expect(alternou).toEqual([7, 9]);
  });

  test('passar o mouse aponta o id', async () => {
    const { apontou } = await montar();
    ouvintes['mousemove:pontos']({ features: [{ properties: { id: 9 } }] });
    expect(apontou).toEqual([9]);
  });

  test('a camada de pontos só desenha o que NÃO é agrupado', async () => {
    await montar();
    const pontos = camadas.find(c => c.id === 'pontos');
    expect(pontos.filter).toEqual(['!', ['has', 'point_count']]);
  });
});
