import { describe, it, expect } from 'vitest';
import { lerGeojson, resumirGeometria } from './campo-geojson.js';

// A LEITURA DO ARQUIVO DE ÁREA.
//
// Ela substituiu o desenho no mapa em 2026-08-09. O que este arquivo prende são
// as duas coisas que separam "importou" de "importou a coisa certa": a
// EMBALAGEM, que varia por ferramenta, e a CONTAGEM, que é onde o engano mora.
//
// A validação daqui NÃO é a guarda: quem recusa de verdade é o `campo_schema.js`
// no servidor. Ela existe para a pessoa saber o que há de errado com o arquivo
// antes de preencher o resto do formulário.

const ANEL = [[-53, -29], [-52, -29], [-52, -28], [-53, -28], [-53, -29]];
const OUTRO = [[-51, -27], [-50, -27], [-50, -26], [-51, -26], [-51, -27]];

const poligono = { type: 'Polygon', coordinates: [ANEL] };

describe('lerGeojson: as embalagens que as ferramentas produzem', () => {
  // O QGIS exporta FeatureCollection, e é o caso mais comum.
  it('aceita FeatureCollection de uma feição', () => {
    const { geometria, erro } = lerGeojson(JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: poligono }],
    }));
    expect(erro).toBeUndefined();
    expect(geometria).toEqual(poligono);
  });

  it('aceita Feature solta', () => {
    const { geometria } = lerGeojson(JSON.stringify({
      type: 'Feature', properties: {}, geometry: poligono,
    }));
    expect(geometria).toEqual(poligono);
  });

  it('aceita a geometria crua', () => {
    const { geometria } = lerGeojson(JSON.stringify(poligono));
    expect(geometria).toEqual(poligono);
  });

  it('aceita GeometryCollection de uma geometria', () => {
    const { geometria } = lerGeojson(JSON.stringify({
      type: 'GeometryCollection', geometries: [poligono],
    }));
    expect(geometria).toEqual(poligono);
  });

  // MultiPolygon DE UMA PARTE é a mesma coisa que Polygon, e é o que o banco
  // guarda: a coluna é MULTIPOLYGON.
  it('aceita MultiPolygon de UMA parte, e o desembrulha', () => {
    const { geometria } = lerGeojson(JSON.stringify({
      type: 'MultiPolygon', coordinates: [[ANEL]],
    }));
    expect(geometria).toEqual(poligono);
  });
});

describe('lerGeojson: UM polígono só', () => {
  // MEDIDO ANTES DE DECIDIDO: dos 47 polígonos do dump de produção do SAP, os 47
  // têm UMA parte. O multipolígono de várias partes era defesa contra um caso
  // que não existe.
  it('recusa FeatureCollection com duas feições, e diz quantas', () => {
    const { erro, geometria } = lerGeojson(JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: poligono },
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [OUTRO] } },
      ],
    }));
    expect(geometria).toBeUndefined();
    expect(erro).toMatch(/2 geometrias/);
    expect(erro).toMatch(/precisa de UMA/);
  });

  // PEGAR A PRIMEIRA gravaria em silêncio a área errada, e o arquivo com várias
  // feições é exatamente o engano que esta leitura existe para pegar.
  it('recusa MultiPolygon de duas partes, e diz quantos', () => {
    const { erro } = lerGeojson(JSON.stringify({
      type: 'MultiPolygon', coordinates: [[ANEL], [OUTRO]],
    }));
    expect(erro).toMatch(/2 polígonos/);
  });

  // UM POLÍGONO COM ILHA AINDA É UM POLÍGONO. Nenhum campo do SAP tem, e
  // recusá-lo seria inventar uma restrição que nem os dados nem o chefe pediram.
  it('aceita polígono com ilha interna', () => {
    const buraco = [[-52.8, -28.8], [-52.6, -28.8], [-52.6, -28.6], [-52.8, -28.6], [-52.8, -28.8]];
    const { geometria, erro } = lerGeojson(JSON.stringify({
      type: 'Polygon', coordinates: [ANEL, buraco],
    }));
    expect(erro).toBeUndefined();
    expect(geometria.coordinates).toHaveLength(2);
  });
});

describe('lerGeojson: o que o arquivo pode trazer de errado', () => {
  it('recusa texto que não é JSON', () => {
    expect(lerGeojson('nada disso').erro).toMatch(/não é um JSON válido/);
  });

  it('recusa arquivo sem geometria nenhuma', () => {
    const { erro } = lerGeojson(JSON.stringify({ type: 'FeatureCollection', features: [] }));
    expect(erro).toMatch(/nenhuma geometria/);
  });

  it('recusa geometria que não é polígono, e diz qual é', () => {
    const { erro } = lerGeojson(JSON.stringify({ type: 'Point', coordinates: [-53, -29] }));
    expect(erro).toMatch(/tipo Point/);
  });

  // O ENGANO MAIS CARO é o arquivo em METROS (UTM), que parece válido e cai do
  // outro lado do mundo. A mensagem nomeia a causa em vez de dizer só "inválida".
  it('recusa coordenada fora de graus decimais, e explica', () => {
    const utm = [[233000, 6700000], [234000, 6700000], [234000, 6701000], [233000, 6701000], [233000, 6700000]];
    const { erro } = lerGeojson(JSON.stringify({ type: 'Polygon', coordinates: [utm] }));
    expect(erro).toMatch(/graus decimais/);
  });

  it('recusa anel aberto', () => {
    const aberto = [[-53, -29], [-52, -29], [-52, -28], [-53, -28]];
    const { erro } = lerGeojson(JSON.stringify({ type: 'Polygon', coordinates: [aberto] }));
    expect(erro).toMatch(/não está fechado/);
  });

  it('recusa anel com menos de três vértices', () => {
    const curto = [[-53, -29], [-52, -29], [-53, -29]];
    const { erro } = lerGeojson(JSON.stringify({ type: 'Polygon', coordinates: [curto] }));
    expect(erro).toMatch(/três vértices/);
  });

  // ARQUIVO COM Z (altitude) é comum -- todo GPX convertido traz --, e a terceira
  // ordenada não vai para a coluna. Recusá-lo faria a importação falhar por uma
  // dimensão que ninguém pediu.
  it('aceita coordenada com Z, e descarta a altitude', () => {
    const comZ = ANEL.map(([x, y]) => [x, y, 120]);
    const { geometria, erro } = lerGeojson(JSON.stringify({ type: 'Polygon', coordinates: [comZ] }));
    expect(erro).toBeUndefined();
    expect(geometria.coordinates[0][0]).toEqual([-53, -29]);
  });
});

describe('resumirGeometria', () => {
  it('conta os vértices', () => {
    expect(resumirGeometria(poligono)).toBe('Área definida: 5 vértices');
  });

  it('conta as ilhas quando há', () => {
    const buraco = [[-52.8, -28.8], [-52.6, -28.8], [-52.6, -28.6], [-52.8, -28.6], [-52.8, -28.8]];
    expect(resumirGeometria({ type: 'Polygon', coordinates: [ANEL, buraco] }))
      .toMatch(/1 ilha/);
  });
});
