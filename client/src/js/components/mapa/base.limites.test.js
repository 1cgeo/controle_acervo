/**
 * OS LIMITES DO MAPA, e o pedido que eles impedem.
 *
 * Em 2026-09-11 a OSM passou a devolver o tile de "Access blocked", 403, nas
 * telas com mapa. A politica de uso dela (osm.wiki/Blocked) lista quatro
 * motivos, e o SAP dava causa a tres:
 *
 *   Misidentification  o `Referrer-Policy: no-referrer` do helmet apagava o
 *                      Referer (conserto e regua no `server/`).
 *   Scraping           sem `maxBounds` e sem `renderWorldCopies: false`, afastar
 *                      o zoom pedia copias do MUNDO, e o acervo e sul-americano.
 *   Rate-limiting      sem `maxzoom`, o MapLibre assume 22 e pede z20, z21 e
 *                      z22, que a OSM nao serve e tem de recusar um a um.
 *
 * O QUE ESTA SUITE PROTEGE e a configuracao, e nao a tela: e ela que decide
 * quantos pedidos saem por gesto. Os sete mapas da casa herdam do mesmo lugar, e
 * o ultimo teste cobra que continuem herdando.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';

import { ESTILO_OSM, LIMITES_MAPA, BRASIL } from './base.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_JS = join(AQUI, '..', '..');

describe('a fonte OSM se comporta como a politica pede', () => {
  test('declara maxzoom 19, que e ate onde a OSM serve', () => {
    // Sem isto o MapLibre assume 22. Cada z20+ e um pedido que so pode ser
    // recusado, e e assim que um aplicativo entra no perfil de mal-comportado.
    expect(ESTILO_OSM.sources.osm.maxzoom).toBe(19);
  });

  test('mantem a atribuicao, que a licenca exige', () => {
    expect(ESTILO_OSM.sources.osm.attribution).toMatch(/OpenStreetMap/);
  });
});

describe('os limites impedem o pedido do mundo', () => {
  test('nao repete o globo na horizontal', () => {
    expect(LIMITES_MAPA.renderWorldCopies).toBe(false);
  });

  test('tem piso de zoom, entao nao da para pedir o planeta inteiro', () => {
    expect(LIMITES_MAPA.minZoom).toBeGreaterThanOrEqual(3);
  });

  test('a caixa contem o Brasil do enquadramento inicial', () => {
    const [[oeste, sul], [leste, norte]] = LIMITES_MAPA.maxBounds;
    const [[bOeste, bSul], [bLeste, bNorte]] = BRASIL;

    // Se a caixa nao contivesse o `bounds: BRASIL` que todo mapa usa para
    // abrir, o MapLibre brigaria com o proprio enquadramento de partida.
    expect(oeste).toBeLessThanOrEqual(bOeste);
    expect(sul).toBeLessThanOrEqual(bSul);
    expect(leste).toBeGreaterThanOrEqual(bLeste);
    expect(norte).toBeGreaterThanOrEqual(bNorte);
  });

  test('a caixa contem o bloco W058N06 do MGCP, que e trabalho nosso', () => {
    // A Meta 2 do PIT produz este bloco, a 58 W e 6 N. Uma caixa so do Brasil
    // deixaria a folha do MGCP fora do alcance do mapa.
    const [[oeste, sul], [leste, norte]] = LIMITES_MAPA.maxBounds;
    expect(oeste).toBeLessThanOrEqual(-58);
    expect(leste).toBeGreaterThanOrEqual(-58);
    expect(sul).toBeLessThanOrEqual(6);
    expect(norte).toBeGreaterThanOrEqual(6);
  });

  test('a caixa NAO cobre o mundo, senao ela nao limita nada', () => {
    const [[oeste, sul], [leste, norte]] = LIMITES_MAPA.maxBounds;
    expect(leste - oeste).toBeLessThan(180);
    expect(norte - sul).toBeLessThan(120);
  });
});

describe('todo mapa da casa herda os limites', () => {
  /** Varre o client atras de quem constroi um mapa. */
  const arquivosComMapa = (dir) => {
    const achados = [];
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) {
        achados.push(...arquivosComMapa(caminho));
        continue;
      }
      if (!nome.endsWith('.js') || nome.includes('.test.')) continue;
      const fonte = readFileSync(caminho, 'utf8');
      if (/new maplibre(gl)?\.Map\(\{/.test(fonte)) achados.push([caminho, fonte]);
    }
    return achados;
  };

  const mapas = arquivosComMapa(RAIZ_JS);

  test('a varredura acha os sete mapas conhecidos', () => {
    // Se este numero cair, a varredura quebrou e os testes abaixo passariam por
    // omissao, que e o jeito de uma regua mentir.
    expect(mapas.length).toBe(7);
  });

  test.each(mapas.map(([c]) => c))('%s espalha LIMITES_MAPA', (caminho) => {
    const fonte = mapas.find(([c]) => c === caminho)[1];
    expect(fonte).toMatch(/\.\.\.LIMITES_MAPA/);
    expect(fonte).toMatch(/LIMITES_MAPA[^}]*\}\s*from\s*'[^']*base/);
  });
});
