import { describe, it, expect } from 'vitest';
import { lerTrajeto } from './campo-trajetos.js';

// A LEITURA DO ARQUIVO DE TRAJETO.
//
// Dois formatos, e os dois porque a origem varia: o GPS Garmin da viatura
// exporta GPX, e quem já passou pelo QGIS tem GeoJSON. Converter fora do sistema
// seria mais um passo manual entre o campo e o cadastro.
//
// A validação daqui NÃO é a guarda: quem recusa de verdade é o `campo_schema.js`
// no servidor. Ela existe para a pessoa não esperar a subida de um arquivo que
// vai ser recusado do outro lado.

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="Garmin">
  <trk><name>Dia 1</name><trkseg>
    <trkpt lat="-29.10" lon="-53.10"><ele>120.5</ele><time>2026-07-28T13:00:00Z</time></trkpt>
    <trkpt lat="-29.20" lon="-53.20"><ele>131.0</ele><time>2026-07-28T13:10:00Z</time></trkpt>
    <trkpt lat="-29.30" lon="-53.30"><ele>142.0</ele><time>2026-07-28T13:20:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

describe('lerTrajeto: GPX', () => {
  it('lê os pontos, a elevação e a hora', () => {
    const { pontos, erro } = lerTrajeto(GPX, 'dia1.gpx');
    expect(erro).toBeUndefined();
    expect(pontos).toHaveLength(3);
    expect(pontos[0]).toEqual({
      longitude: -53.1, latitude: -29.1, elevacao: 120.5, momento: '2026-07-28T13:00:00Z',
    });
  });

  // O FORMATO SE RECONHECE PELO CONTEÚDO, e não só pela extensão: arquivo que
  // veio por e-mail chega com nome trocado o tempo todo.
  it('reconhece GPX mesmo sem a extensão', () => {
    const { pontos } = lerTrajeto(GPX, 'trajeto.txt');
    expect(pontos).toHaveLength(3);
  });

  // `rtept` e `wpt` são ROTA e ponto de interesse, e não o caminho percorrido.
  // Aceitá-los desenharia uma linha que a viatura não fez.
  it('recusa GPX que só tem waypoint', () => {
    const so_wpt = '<?xml version="1.0"?><gpx><wpt lat="-29" lon="-53"></wpt></gpx>';
    expect(lerTrajeto(so_wpt, 'x.gpx').erro).toMatch(/nenhum ponto de trajeto/);
  });

  it('recusa GPX malformado', () => {
    expect(lerTrajeto('<gpx><trkpt', 'x.gpx').erro).toMatch(/malformado/);
  });
});

describe('lerTrajeto: GeoJSON', () => {
  const linha = {
    type: 'LineString',
    coordinates: [[-53.1, -29.1, 120], [-53.2, -29.2, 131]],
  };

  it('lê LineString e usa a terceira ordenada como elevação', () => {
    const { pontos, erro } = lerTrajeto(JSON.stringify(linha), 'x.geojson');
    expect(erro).toBeUndefined();
    expect(pontos[0]).toEqual({
      longitude: -53.1, latitude: -29.1, elevacao: 120, momento: null,
    });
  });

  it('achata MultiLineString', () => {
    const { pontos } = lerTrajeto(JSON.stringify({
      type: 'MultiLineString',
      coordinates: [[[-53.1, -29.1], [-53.2, -29.2]], [[-53.3, -29.3], [-53.4, -29.4]]],
    }), 'x.geojson');
    expect(pontos).toHaveLength(4);
  });

  it('aceita Feature e FeatureCollection de uma feição', () => {
    expect(lerTrajeto(JSON.stringify({
      type: 'Feature', properties: {}, geometry: linha,
    }), 'x.geojson').pontos).toHaveLength(2);
    expect(lerTrajeto(JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: linha }],
    }), 'x.geojson').pontos).toHaveLength(2);
  });

  it('recusa FeatureCollection com duas feições, e diz quantas', () => {
    const { erro } = lerTrajeto(JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: linha },
        { type: 'Feature', properties: {}, geometry: linha },
      ],
    }), 'x.geojson');
    expect(erro).toMatch(/2 feições/);
  });

  it('recusa geometria que não é linha, e diz qual é', () => {
    const { erro } = lerTrajeto(JSON.stringify({
      type: 'Polygon', coordinates: [[[-53, -29], [-52, -29], [-52, -28], [-53, -29]]],
    }), 'x.geojson');
    expect(erro).toMatch(/é Polygon/);
  });
});

describe('lerTrajeto: o que os dois formatos recusam juntos', () => {
  it('recusa trajeto de um ponto só', () => {
    const { erro } = lerTrajeto(JSON.stringify({
      type: 'LineString', coordinates: [[-53.1, -29.1]],
    }), 'x.geojson');
    expect(erro).toMatch(/ao menos dois pontos/);
  });

  // O TETO ESPELHA O DO Joi (`campo_schema.track`, 50.000). A mensagem nomeia a
  // causa provável em vez de dizer só "grande demais": o maior track do acervo
  // do SAP tem cerca de 6.500 pontos, então 50.000 é GPX de mês inteiro.
  it('recusa acima de 50.000 pontos, e explica o que provavelmente é', () => {
    const muitos = Array.from({ length: 50001 }, (_, i) => [-53 + i / 1e6, -29]);
    const { erro } = lerTrajeto(JSON.stringify({
      type: 'LineString', coordinates: muitos,
    }), 'x.geojson');
    expect(erro).toMatch(/50\.000/);
    expect(erro).toMatch(/mês inteiro/);
  });

  // O ENGANO MAIS CARO é o arquivo em METROS (UTM), que parece válido e cai do
  // outro lado do mundo.
  it('recusa coordenada fora de graus decimais, e explica', () => {
    const { erro } = lerTrajeto(JSON.stringify({
      type: 'LineString', coordinates: [[233000, 6700000], [234000, 6701000]],
    }), 'x.geojson');
    expect(erro).toMatch(/graus decimais/);
  });

  it('recusa arquivo que não é nem GPX nem JSON', () => {
    expect(lerTrajeto('isto nao e nada', 'x.txt').erro).toMatch(/não é um GPX nem um JSON/);
  });
});
