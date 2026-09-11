// O CSS entra estatico (poucos KB) para o mapa nascer ja com os controles no
// lugar. O JS, nao: a biblioteca passa de meio megabyte, e um import de topo a
// colocaria no pacote de TODA a interface, inclusive das telas que nao tem mapa
// nenhum. Com o import() dinamico ela vira um pedaco proprio, buscado quando
// alguem abre uma tela com mapa.
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Base comum dos mapas do SCA (busca do acervo e entregas da mapoteca).
 *
 * Existe para que a decisao do fundo, das fontes e do carregamento sob demanda
 * viva em UM lugar. Cada tela monta as proprias camadas e interacoes, que sao
 * diferentes de verdade: uma desenha area e seleciona, a outra pinta um
 * coropletico de quantidade.
 */

/**
 * Fundo OSM porque a rede e interna mas TEM internet. Sem
 * internet os poligonos continuam aparecendo: eles vem da nossa API, e o que
 * falta e so a imagem de fundo.
 */
export const ESTILO_OSM = {
  version: 8,
  // Sem `glyphs` o MapLibre nao desenha TEXTO: camada de simbolo com
  // text-field simplesmente nao aparece, sem erro nenhum. O estilo OSM e so
  // raster e nao traz fonte, entao ela vem deste servidor publico de glifos, o
  // mesmo caminho da internet que ja serve os tiles.
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      // A OSM SERVE ATE O ZOOM 19, e sem declarar isto o MapLibre assume 22 e
      // pede z20, z21 e z22, que nao existem. Sao pedidos que os servidores
      // deles tem de recusar um a um, e e assim que um aplicativo entra no
      // perfil de mal-comportado da politica de uso. Com `maxzoom`, o MapLibre
      // AMPLIA o tile do 19 em vez de pedir o que nao ha.
      maxzoom: 19,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Brasil inteiro: o enquadramento de partida, antes de haver dado na tela. */
export const BRASIL = [[-74, -34], [-34, 6]];

/**
 * Os LIMITES que todo mapa da casa carrega, e por que eles existem.
 *
 * Em 2026-09-11 a OSM passou a devolver o tile de "Access blocked", 403, nas
 * telas com mapa. A politica de uso dela (osm.wiki/Blocked) cobra identificacao
 * e comportamento, e o SAP falhava nos dois: o `Referrer-Policy: no-referrer`
 * do helmet apagava o Referer de TODO pedido (corrigido no `server/app.js`), e
 * o mapa nascia sem limite nenhum.
 *
 * SEM LIMITE, afastar o zoom pede o MUNDO. O MapLibre repete o globo na
 * horizontal (`renderWorldCopies`), entao uma tela larga em z0 pedia varias
 * copias do planeta inteiro, e o acervo da Divisao e sul-americano: nenhuma
 * dessas imagens tinha para que ser buscada.
 *
 * A CAIXA E A AMERICA DO SUL, e nao o Brasil: ela precisa conter o bloco
 * W058N06 do MGCP e a faixa de fronteira, que sao trabalho nosso.
 */
export const LIMITES_MAPA = {
  minZoom: 3,
  maxBounds: [[-100, -60], [-10, 20]],
  renderWorldCopies: false,
};

/**
 * Carrega o MapLibre sob demanda.
 * @returns {Promise<Object|null>} o modulo, ou null se a busca falhar
 */
export async function carregarMapLibre() {
  try {
    const modulo = await import('maplibre-gl');
    return modulo.default || modulo;
  } catch {
    return null;
  }
}

/**
 * Caixa envolvente de um GeoJSON Polygon ou MultiPolygon.
 * @param {Object} geometria
 * @returns {[number,number,number,number]|null} [minLon, minLat, maxLon, maxLat]
 */
export function caixaDe(geometria) {
  if (!geometria || !Array.isArray(geometria.coordinates)) return null;
  let minLon = Infinity; let minLat = Infinity;
  let maxLon = -Infinity; let maxLat = -Infinity;

  const visitar = (no) => {
    if (!Array.isArray(no)) return;
    // Chegou num par [lon, lat]: os dois primeiros itens sao numeros.
    if (typeof no[0] === 'number' && typeof no[1] === 'number') {
      const [lon, lat] = no;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const filho of no) visitar(filho);
  };
  visitar(geometria.coordinates);

  return Number.isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null;
}

/**
 * Caixa envolvente de uma colecao de geometrias.
 * @param {Array<Object>} geometrias
 * @returns {[number,number,number,number]|null}
 */
export function caixaDeVarias(geometrias) {
  let caixa = null;
  for (const g of geometrias || []) {
    const c = caixaDe(g);
    if (!c) continue;
    caixa = caixa
      ? [Math.min(caixa[0], c[0]), Math.min(caixa[1], c[1]),
         Math.max(caixa[2], c[2]), Math.max(caixa[3], c[3])]
      : c;
  }
  return caixa;
}
