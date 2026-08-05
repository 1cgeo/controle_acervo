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
// A última coleção que a tela mandou para CADA fonte. `fonteCriada.data` é a
// coleção vazia do momento da criação, e nunca o que `mostrar` monta. A chave
// importa: a camada de realce escreve na fonte dela, e uma variável só guardaria
// o realce vazio no lugar dos pontos.
let dadosPorFonte = {};
const fontesFalsas = {};

const fonteFalsa = (nome) => {
  if (!fontesFalsas[nome]) {
    fontesFalsas[nome] = {
      setData: vi.fn(dados => { dadosPorFonte[nome] = dados; }),
      getClusterExpansionZoom: vi.fn(),
    };
  }
  return fontesFalsas[nome];
};

const mapaFalso = {
  addControl: vi.fn(),
  addSource: vi.fn((nome, opcoes) => {
    if (nome === 'pontos') fonteCriada = opcoes;
  }),
  addLayer: vi.fn(l => camadas.push(l)),
  getSource: vi.fn(nome => fonteFalsa(nome)),
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
  dadosPorFonte = {};
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

    // A prova tem de sair do que `mostrar` MANDA para a fonte 'pontos', e não da
    // coleção vazia com que a fonte nasceu.
    const colecao = dadosPorFonte.pontos;
    expect(colecao.type).toBe('FeatureCollection');
    expect(colecao.features).toHaveLength(PONTOS.length);
    expect(colecao.features.map(f => f.properties.id)).toEqual([7, 9]);
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

  /**
   * A cor do ponto sai da SITUAÇÃO, e não é uma só.
   *
   * O mapa pintava tudo de verde alegando que "só ponto aprovado entra no
   * acervo". A premissa é falsa: `getPosicoes` não filtra por situação, e
   * `er/ponto_controle.sql` declara cinco (1 Não medido, 2 Aguardando revisão,
   * 3 Aprovado, 4 Reprovado, 9999 A SER PREENCHIDO, que é o DEFAULT da coluna).
   * O ponto REPROVADO aparecia na cor que significa aprovado, ao lado de um chip
   * vermelho dizendo "Reprovado".
   *
   * CONTROLE NEGATIVO: no código anterior `circle-color` era a string
   * '#22c55e'. O `Array.isArray` reprova, e a comparação entre 3 e 4 nem chega
   * a existir.
   */
  test('a cor do ponto sai da situação, e aprovado difere de reprovado', async () => {
    await montar();
    const pontos = camadas.find(c => c.id === 'pontos');
    const cor = pontos.paint['circle-color'];

    // Expressão, e não cor fixa. Uma string aqui é o defeito antigo.
    expect(Array.isArray(cor)).toBe(true);
    expect(cor[0]).toBe('match');
    expect(cor[1]).toEqual(['get', 'tipo_situacao']);

    const corDe = (code) => {
      const i = cor.indexOf(code, 2);
      return i > 0 ? cor[i + 1] : null;
    };
    // O que o defeito confundia: os dois eram o MESMO verde.
    expect(corDe(3)).not.toBe(corDe(4));
    // E as quatro situações do domínio têm, cada uma, a sua cor.
    const cores = [corDe(1), corDe(2), corDe(3), corDe(4)];
    expect(cores.every(Boolean)).toBe(true);
    expect(new Set(cores).size).toBe(4);

    // O último item do `match` é o padrão, e cobre o 9999 sem declará-lo.
    const padrao = cor[cor.length - 1];
    expect(cores).not.toContain(padrao);
  });

  test('a legenda nomeia as quatro situações, com a cor de cada uma', async () => {
    const { mapa } = await montar();
    const itens = [...mapa.elemento.querySelectorAll('.pc-mapa__legenda-item')];
    expect(itens.map(i => i.textContent)).toEqual([
      'Não medido', 'Aguardando revisão', 'Aprovado', 'Reprovado',
    ]);

    // A bolinha da legenda tem de repetir a cor que a camada usa, senão a
    // legenda explica um mapa que não existe.
    const pontos = camadas.find(c => c.id === 'pontos');
    const cor = pontos.paint['circle-color'];
    const corDe = (code) => cor[cor.indexOf(code, 2) + 1];
    // O jsdom normaliza cor de `style` para 'rgb(r, g, b)', e nunca devolve o
    // hex que foi escrito. Comparar com o hex cru reprovaria sempre, e por um
    // motivo que não é o defeito. Converter é o que torna a prova honesta.
    const hexParaRgb = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    const daLegenda = itens.map(
      i => i.querySelector('.pc-mapa__legenda-cor').style.background
    );
    expect(daLegenda).toHaveLength(4);
    [1, 2, 3, 4].forEach((code, i) => {
      expect(daLegenda[i]).toBe(hexParaRgb(corDe(code)));
    });
  });
});
