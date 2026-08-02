import { describe, test, expect } from 'vitest';

/**
 * Conversao entre o anel de vertices do desenho e o EWKT que o acervo grava.
 *
 * Estas funcoes existem porque o editor de geometria do produto precisa ir e
 * voltar: a ficha devolve `ST_AsEWKT(geom)` e o PUT reescreve com
 * `ST_GeomFromEWKT`. O que se prova aqui e o CONTRATO dessa ida e volta, que e
 * onde um erro passa despercebido: um anel aberto gravado como fechado, ou uma
 * coordenada em notacao de expoente, sao aceitos pelo JavaScript e recusados
 * pelo PostGIS longe daqui.
 */

import {
  paraEwkt,
  deEwkt,
  retanguloDeCantos,
  criarModeloDesenho,
  SRID_ACERVO,
} from './poligono.js';

// Quadrado de 1 grau, anel ABERTO, no sentido anti-horario.
const QUADRADO = [[-50, -25], [-49, -25], [-49, -24], [-50, -24]];

describe('paraEwkt', () => {
  test('fecha o anel e prefixa o SRID do acervo', () => {
    expect(paraEwkt(QUADRADO)).toBe(
      'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
    );
  });

  test('o SRID e o 4674 de acervo.produto.geom', () => {
    expect(SRID_ACERVO).toBe(4674);
  });

  test('nao devolve coordenada em notacao de expoente', () => {
    // Coordenada muito perto de zero e o caso em que `String()` produz "1e-7",
    // que o PostGIS nao le como WKT.
    const perto = [[0.0000001, 0.0000001], [1, 0], [1, 1], [0, 1]];
    expect(paraEwkt(perto)).not.toMatch(/e-/i);
  });

  test('corta o ruido binario do double em vez de grava-lo', () => {
    const ewkt = paraEwkt([[-50.1, -25.1], [-49, -25], [-49, -24]]);
    expect(ewkt).toContain('-50.1 -25.1');
  });

  test('geometria invalida devolve null, e nao um EWKT que o banco recusaria', () => {
    expect(paraEwkt([[-50, -25], [-49, -25]])).toBeNull();           // dois vertices
    expect(paraEwkt([[-50, -25], [-49, -25], [-48, -25]])).toBeNull(); // area nula
    expect(paraEwkt([])).toBeNull();
  });
});

describe('deEwkt', () => {
  test('le o que ST_AsEWKT devolve e abre o anel', () => {
    const vertices = deEwkt('SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))');
    expect(vertices).toEqual(QUADRADO);
  });

  test('aceita WKT sem SRID, porque colar de outra ferramenta e caso real', () => {
    expect(deEwkt('POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))')).toEqual(QUADRADO);
  });

  test('ida e volta preserva o anel', () => {
    expect(deEwkt(paraEwkt(QUADRADO))).toEqual(QUADRADO);
  });

  test('MULTIPOLYGON e recusado: a coluna e geometry(POLYGON, 4674)', () => {
    expect(deEwkt(
      'SRID=4674;MULTIPOLYGON(((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25)))'
    )).toBeNull();
  });

  test('poligono com buraco e recusado em vez de perder area em silencio', () => {
    expect(deEwkt(
      'POLYGON((-50 -25, -45 -25, -45 -20, -50 -20, -50 -25),' +
      '(-49 -24, -48 -24, -48 -23, -49 -23, -49 -24))'
    )).toBeNull();
  });

  test('coordenada fora do intervalo de grau e recusada', () => {
    expect(deEwkt('POLYGON((-500 -25, -49 -25, -49 -24, -500 -24, -500 -25))')).toBeNull();
  });

  test('entrada que nao e WKT devolve null', () => {
    expect(deEwkt('')).toBeNull();
    expect(deEwkt(null)).toBeNull();
    expect(deEwkt('nao e geometria')).toBeNull();
    expect(deEwkt('POINT(-50 -25)')).toBeNull();
  });
});

describe('retanguloDeCantos', () => {
  test('monta o anel a partir de dois cantos opostos', () => {
    expect(retanguloDeCantos([-50, -25], [-49, -24])).toEqual(QUADRADO);
  });

  test('trocar os cantos na digitacao nao inverte a orientacao do anel', () => {
    // Nordeste primeiro, sudoeste depois: o resultado tem de ser o MESMO anel.
    expect(retanguloDeCantos([-49, -24], [-50, -25])).toEqual(QUADRADO);
  });

  test('cantos que nao formam area devolvem null', () => {
    expect(retanguloDeCantos([-50, -25], [-50, -24])).toBeNull(); // largura zero
    expect(retanguloDeCantos([-50, -25], [-50, -25])).toBeNull(); // mesmo ponto
  });
});

describe('modelo: carregar', () => {
  test('parte de um poligono ja gravado e ja fica pronto para editar', () => {
    const modelo = criarModeloDesenho();
    const resultado = modelo.carregar(QUADRADO);

    expect(resultado.valid).toBe(true);
    expect(modelo.estado).toBe('concluido');
    expect(modelo.vertices).toEqual(QUADRADO);
    // 'concluido' e o estado em que `iniciarEdicao` funciona: quem abre a ficha
    // de um produto pode arrastar um vertice sem redesenhar o quadro inteiro.
    expect(modelo.iniciarEdicao()).toBe(true);
  });

  test('recusa geometria invalida em vez de carregar pela metade', () => {
    const modelo = criarModeloDesenho();
    const resultado = modelo.carregar([[-50, -25], [-49, -25]]);

    expect(resultado.valid).toBe(false);
    expect(modelo.estado).toBe('pronto');
    expect(modelo.vertices).toEqual([]);
  });

  test('carregar nao guarda referencia para o array de quem chamou', () => {
    const modelo = criarModeloDesenho();
    const original = QUADRADO.map(v => [...v]);
    modelo.carregar(original);
    original[0][0] = 999;

    expect(modelo.vertices[0][0]).toBe(-50);
  });
});
