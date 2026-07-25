'use strict'

// Leitura da area de interesse do `acervo cobertura --area`.
//
// O que NAO se testa aqui, de proposito: o predicado espacial. Ele nao mora
// mais neste processo, mora no PostGIS do SCA, e e testado la (server,
// __tests__/routes/integracao.test.js) contra o banco de verdade. Duplicar a
// assercao aqui recriaria a segunda implementacao que a mudanca eliminou.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { geometriasDe, lerArea } = require('../comandos/cobertura')

const POLIGONO = {
  type: 'Polygon',
  coordinates: [[[-50, -15], [-49, -15], [-49, -14], [-50, -14], [-50, -15]]]
}

function arquivoTemporario (conteudo) {
  const alvo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acervo-')), 'area.geojson')
  fs.writeFileSync(alvo, conteudo, 'utf8')
  return alvo
}

test('extrai geometria solta', () => {
  assert.deepStrictEqual(geometriasDe(POLIGONO), [POLIGONO])
})

test('extrai de Feature e de FeatureCollection', () => {
  const feature = { type: 'Feature', properties: {}, geometry: POLIGONO }
  assert.strictEqual(geometriasDe(feature).length, 1)

  const colecao = { type: 'FeatureCollection', features: [feature, feature] }
  assert.strictEqual(geometriasDe(colecao).length, 2)
})

test('extrai de GeometryCollection aninhada', () => {
  const gc = { type: 'GeometryCollection', geometries: [POLIGONO, POLIGONO] }
  const dentroDeFeature = { type: 'Feature', geometry: gc }
  assert.strictEqual(geometriasDe(dentroDeFeature).length, 2)
})

test('descarta ponto e linha, que nao tem area', () => {
  const colecao = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-49.5, -14.5] } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-50, -15], [-49, -14]] } },
      { type: 'Feature', geometry: POLIGONO }
    ]
  }
  const geoms = geometriasDe(colecao)
  assert.strictEqual(geoms.length, 1)
  assert.strictEqual(geoms[0].type, 'Polygon')
})

test('so manda type e coordinates, sem propriedades do arquivo', () => {
  const sujo = { ...POLIGONO, properties: { nome: 'x' }, id: 7, bbox: [0, 0, 1, 1] }
  assert.deepStrictEqual(Object.keys(geometriasDe(sujo)[0]).sort(), ['coordinates', 'type'])
})

test('le um GeoJSON do disco', () => {
  const alvo = arquivoTemporario(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: POLIGONO }] }))
  assert.strictEqual(lerArea(alvo).length, 1)
})

test('arquivo inexistente ensina a conversao do GPKG', () => {
  assert.throws(() => lerArea('nao-existe.gpkg'), /ogr2ogr -f GeoJSON/)
})

test('arquivo que nao e JSON ensina a conversao', () => {
  const alvo = arquivoTemporario('isto nao e json')
  assert.throws(() => lerArea(alvo), /ogr2ogr -f GeoJSON/)
})

// O modo de falha que motivou a recusa: uma area so de pontos voltaria com
// zero folhas, e zero folhas se le como "o acervo nao tem nada aqui".
test('GeoJSON sem area recusa em vez de devolver lista vazia', () => {
  const alvo = arquivoTemporario(JSON.stringify({ type: 'Point', coordinates: [-49.5, -14.5] }))
  assert.throws(() => lerArea(alvo), /nao tem nenhuma geometria de AREA/)
})
