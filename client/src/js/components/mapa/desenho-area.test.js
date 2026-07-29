import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Desenho de área sobre o mapa.
 *
 * O código saiu do mapa da busca em 2026-07-29 para ser usado também no ponto de
 * controle, e saiu SEM prova nenhuma: as duas telas testam o mapa por dublê, e
 * o desenho ficava de fora. Estas provas guardam o contrato da extração, que é o
 * que as duas telas passaram a depender.
 */

import { criarDesenhoDeArea } from './desenho-area.js';

let fontes = {};
let camadas = [];
let ouvintes = {};
let dados = null;

function mapaFalso() {
  fontes = {};
  camadas = [];
  ouvintes = {};
  dados = null;
  return {
    addSource: vi.fn((nome, opcoes) => { fontes[nome] = opcoes; }),
    addLayer: vi.fn(l => camadas.push(l)),
    getSource: vi.fn(() => ({ setData: vi.fn(d => { dados = d; }) })),
    getCanvas: vi.fn(() => ({ style: {} })),
    on: vi.fn((evento, alvoOuFn, talvezFn) => {
      const chave = talvezFn ? `${evento}:${alvoOuFn}` : evento;
      ouvintes[chave] = talvezFn || alvoOuFn;
    }),
    // Projeção de brinquedo: 1 grau = 10 px. Basta para o "clique perto do
    // primeiro vértice fecha a área".
    project: vi.fn(([lng, lat]) => ({ x: lng * 10, y: lat * 10 })),
    doubleClickZoom: { isEnabled: () => true, disable: vi.fn(), enable: vi.fn() },
    dragPan: { disable: vi.fn(), enable: vi.fn() },
  };
}

const clique = (lng, lat) => ({
  lngLat: { lng, lat },
  point: { x: lng * 10, y: lat * 10 },
});

/** Monta o desenho já ligado a um mapa. */
function montar() {
  const desenhadas = [];
  const canceladas = [];
  const desenho = criarDesenhoDeArea({
    onAreaDesenhada: g => desenhadas.push(g),
    onAreaCancelada: () => canceladas.push(true),
  });
  const mapa = mapaFalso();
  desenho.montar(mapa);
  return { desenho, mapa, desenhadas, canceladas };
}

/** Marca um triângulo e fecha pelo botão "Concluir área". */
function desenharTriangulo(desenho) {
  ouvintes.click(clique(-53, -31));
  ouvintes.click(clique(-50, -31));
  ouvintes.click(clique(-50, -29));
  botao(desenho.controles, 'Concluir área').click();
}

const botao = (raiz, texto) =>
  [...raiz.querySelectorAll('button')].find(b => b.textContent === texto);

beforeEach(() => {
  global.requestAnimationFrame = fn => { fn(); return 1; };
  global.cancelAnimationFrame = () => {};
});

describe('desenho de área', () => {
  test('monta a fonte e as três camadas do desenho', () => {
    montar();
    expect(fontes.desenho).toBeTruthy();
    expect(camadas.map(c => c.id)).toEqual([
      'desenho-area', 'desenho-linha', 'desenho-vertices',
    ]);
  });

  test('só desenha depois de ligar o botão: clique solto não marca vértice', () => {
    const { desenho } = montar();
    ouvintes.click(clique(-53, -31));
    expect(desenho.ocupado()).toBe(false);
    // Sem isto, navegar no mapa começaria um desenho a cada clique.
    expect(dados.features).toHaveLength(0);
  });

  test('marcar três vértices e concluir devolve o polígono FECHADO', () => {
    const { desenho, desenhadas } = montar();
    desenho.botao.click();
    desenharTriangulo(desenho);

    expect(desenhadas).toHaveLength(1);
    const anel = desenhadas[0].coordinates[0];
    expect(desenhadas[0].type).toBe('Polygon');
    // Quatro pontos para três vértices: anel aberto é geometria inválida no
    // PostGIS, e a consulta inteira falharia.
    expect(anel).toHaveLength(4);
    expect(anel[0]).toEqual(anel[3]);
  });

  test('clicar sobre o PRIMEIRO vértice fecha a área, sem passar pelo botão', () => {
    const { desenho, desenhadas } = montar();
    desenho.botao.click();
    ouvintes.click(clique(-53, -31));
    ouvintes.click(clique(-50, -31));
    ouvintes.click(clique(-50, -29));
    // Mesma coordenada do primeiro: a distância em pixels é zero.
    ouvintes.click(clique(-53, -31));

    expect(desenhadas).toHaveLength(1);
  });

  test('`ocupado` é verdadeiro enquanto se desenha, e falso depois', () => {
    const { desenho } = montar();
    expect(desenho.ocupado()).toBe(false);

    desenho.botao.click();
    // É o que faz o mapa não selecionar feição nem reconsultar no meio do gesto.
    expect(desenho.ocupado()).toBe(true);

    desenharTriangulo(desenho);
    expect(desenho.ocupado()).toBe(false);
  });

  test('área que se cruza é RECUSADA, com o motivo na tela', () => {
    const { desenho, desenhadas } = montar();
    desenho.botao.click();

    // O SEGMENTO DE FECHAMENTO é o que cruza: o modelo já recusa vértice cujo
    // segmento cruza uma borda existente, então a auto-interseção que sobra
    // para o "concluir" é sempre a da última borda, a que fecha o anel.
    ouvintes.click(clique(-53, -31));
    ouvintes.click(clique(-50, -31));
    ouvintes.click(clique(-50, -29));
    ouvintes.click(clique(-49, -30));
    botao(desenho.controles, 'Concluir área').click();

    expect(desenhadas).toHaveLength(0);
    expect(desenho.controles.textContent).toContain('cruzar');
  });

  test('cancelar um desenho pela METADE não avisa quem consulta', () => {
    const { desenho, canceladas } = montar();
    desenho.botao.click();
    ouvintes.click(clique(-53, -31));
    botao(desenho.controles, 'Cancelar').click();

    // Refazer a consulta aqui seria trabalho para desfazer nada: não havia
    // recorte valendo.
    expect(canceladas).toHaveLength(0);
  });

  test('remover uma área que VALIA avisa quem consulta', () => {
    const { desenho, canceladas } = montar();
    desenho.botao.click();
    desenharTriangulo(desenho);

    expect(botao(desenho.controles, 'Remover área')).toBeTruthy();
    botao(desenho.controles, 'Remover área').click();
    expect(canceladas).toEqual([true]);
  });

  test('Enter conclui, Escape cancela, e a tecla solta não é tratada', () => {
    const { desenho, desenhadas } = montar();
    const tecla = (key) => {
      const e = { key, preventDefault: vi.fn() };
      return desenho.tratarTecla(e);
    };

    // Fora do desenho, a tecla não é do módulo: tratá-la roubaria o Escape da
    // página, que fecha diálogo.
    expect(tecla('Escape')).toBe(false);

    desenho.botao.click();
    ouvintes.click(clique(-53, -31));
    ouvintes.click(clique(-50, -31));
    ouvintes.click(clique(-50, -29));
    expect(tecla('Enter')).toBe(true);
    expect(desenhadas).toHaveLength(1);
  });

  test('a área que veio pela URL reaparece no mapa, sem reconsultar', () => {
    const { desenho, desenhadas } = montar();
    desenho.mostrarArea({
      type: 'Polygon',
      coordinates: [[[-53, -31], [-50, -31], [-50, -29], [-53, -31]]],
    });

    expect(desenho.controles.classList.contains('hidden')).toBe(false);
    expect(dados.features.some(f => f.properties.kind === 'area')).toBe(true);
    // A consulta já saiu com a área da URL: avisar de novo a repetiria.
    expect(desenhadas).toHaveLength(0);
  });

  test('`limparArea` apaga o desenho e devolve o botão ao estado inicial', () => {
    const { desenho } = montar();
    desenho.botao.click();
    desenharTriangulo(desenho);

    desenho.limparArea();
    expect(dados.features).toHaveLength(0);
    expect(desenho.controles.classList.contains('hidden')).toBe(true);
    expect(desenho.botao.classList.contains('btn--secondary')).toBe(true);
  });
});
