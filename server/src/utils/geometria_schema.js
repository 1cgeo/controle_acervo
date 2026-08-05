'use strict'

const Joi = require('joi')

/**
 * Polígono desenhado no mapa, como GeoJSON em texto.
 *
 * Compartilhado pela busca do acervo e pelo ponto de controle, que desenham com
 * a mesma ferramenta: duas cópias do validador divergiriam, e o recorte que uma
 * tela aceita e a outra recusa é diferença sem razão para quem usa.
 *
 * O teto de vértices existe por DOIS motivos, e nenhum é estético: a consulta
 * espacial paga por vértice, e a busca inteira viaja na URL (o link tem de ser
 * compartilhável). Cem vértices desenham qualquer recorte operacional e mantêm
 * a URL abaixo do que servidor e navegador aceitam sem susto.
 */
const MAX_VERTICES = 100

const geometriaSchema = Joi.string().custom((valor, helpers) => {
  let geo
  try {
    geo = JSON.parse(valor)
  } catch {
    return helpers.message('geometria precisa ser um GeoJSON válido')
  }
  if (!geo || geo.type !== 'Polygon' || !Array.isArray(geo.coordinates)) {
    return helpers.message('geometria precisa ser um Polygon')
  }
  // Um anel externo, sem buracos: é o que o desenho do mapa produz, e aceitar
  // mais seria prometer o que a ferramenta não entrega.
  if (geo.coordinates.length !== 1) {
    return helpers.message('geometria precisa ter exatamente um anel')
  }
  const anel = geo.coordinates[0]
  if (!Array.isArray(anel) || anel.length < 4) {
    return helpers.message('o anel precisa de ao menos três vértices')
  }
  if (anel.length > MAX_VERTICES + 1) {
    return helpers.message(`o desenho excede ${MAX_VERTICES} vértices`)
  }
  const coordenadaOk = c => Array.isArray(c) && c.length >= 2 &&
    Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
    c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90
  if (!anel.every(coordenadaOk)) {
    return helpers.message('geometria tem coordenada inválida')
  }
  // Anel aberto entra no PostGIS como geometria inválida.
  const primeiro = anel[0]
  const ultimo = anel[anel.length - 1]
  if (primeiro[0] !== ultimo[0] || primeiro[1] !== ultimo[1]) {
    return helpers.message('o anel precisa ser fechado (primeiro vértice igual ao último)')
  }
  // Devolve normalizado: o SQL recebe sempre o mesmo formato.
  return JSON.stringify({ type: 'Polygon', coordinates: [anel.map(c => [c[0], c[1]])] })
})

module.exports = { geometriaSchema, MAX_VERTICES }
