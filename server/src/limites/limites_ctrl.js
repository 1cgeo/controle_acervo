'use strict'

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')

const controller = {}

/**
 * Quanto se simplifica a geometria antes de mandar ao navegador.
 *
 * O denominador e a resolucao ALVO em pixels: a tolerancia sai da propria
 * extensao do poligono dividida por ele, entao um municipio pequeno e um estado
 * grande chegam com o mesmo nivel de detalhe APARENTE. Tolerancia fixa faria o
 * contrario: sumiria com o contorno do municipio e deixaria o estado pesado.
 *
 * Mil e o dobro da largura util do mapa na tela. O que se descarta abaixo disso
 * nao chega a um pixel, e a borda continua a mesma para quem olha.
 */
const RESOLUCAO_ALVO = 1000

/**
 * Casas decimais do GeoJSON. Cinco valem ~1 m em 4674, e a borda esta
 * simplificada bem acima disso: mais casas so engordariam a resposta.
 */
const CASAS = 5

/**
 * Terceiro argumento do `ST_AsGeoJSON`: ZERO, e nao o padrao.
 *
 * O padrao do PostGIS e 8, que embute em cada geometria um membro `crs` com o
 * EPSG. O `crs` saiu da especificacao do GeoJSON (RFC 7946), que e sempre
 * lon/lat: nada garante que o leitor o ignore em vez de recusar a feicao.
 */
const SEM_CRS = 0

const TABELAS = {
  estado: { tabela: 'limites.estado', rotulo: 'Estado' },
  municipio: { tabela: 'limites.municipio', rotulo: 'Município' }
}

/**
 * Contorno de UM limite, para a tela desenhar e enquadrar.
 *
 * Devolve a caixa envolvente junto com a geometria porque quem chama precisa das
 * duas coisas e por razoes diferentes: a geometria pinta a borda, a caixa da o
 * zoom. Calcular a caixa no navegador, percorrendo um MULTIPOLYGON de milhares
 * de vertices, seria refazer no JavaScript o que o PostGIS ja tem indexado.
 *
 * @param {'estado'|'municipio'} tipo
 * @param {number} id - codigo do IBGE
 * @returns {Promise<{tipo:string, id:number, nome:string, sigla:string|null,
 *   bbox:Array<number>, geometria:Object}>}
 */
controller.getLimite = async (tipo, id) => {
  const alvo = TABELAS[tipo]
  if (!alvo) {
    throw new AppError('Tipo de limite inválido', httpCode.BadRequest)
  }

  // A simplificacao PRESERVA a topologia: `ST_Simplify` puro pode produzir anel
  // que se cruza, e a borda apareceria com no na tela. O custo e ela ser mais
  // lenta, o que aqui nao importa: e uma feicao por chamada.
  const linha = await db.conn.oneOrNone(
    `SELECT
       l.id,
       l.nome,
       ${tipo === 'estado' ? 'l.sigla' : 'NULL::text AS sigla'},
       ST_XMin(l.geom) AS xmin, ST_YMin(l.geom) AS ymin,
       ST_XMax(l.geom) AS xmax, ST_YMax(l.geom) AS ymax,
       ST_AsGeoJSON(
         ST_SimplifyPreserveTopology(
           l.geom,
           GREATEST(
             ST_XMax(l.geom) - ST_XMin(l.geom),
             ST_YMax(l.geom) - ST_YMin(l.geom)
           ) / $<resolucao>
         ),
         $<casas>,
         $<opcoes>
       ) AS geojson
     FROM ${alvo.tabela} AS l
     WHERE l.id = $<id>`,
    { id, resolucao: RESOLUCAO_ALVO, casas: CASAS, opcoes: SEM_CRS }
  )

  if (!linha) {
    throw new AppError(`${alvo.rotulo} não encontrado`, httpCode.NotFound)
  }

  return {
    tipo,
    id: Number(linha.id),
    nome: linha.nome,
    sigla: linha.sigla || null,
    bbox: [
      Number(linha.xmin), Number(linha.ymin),
      Number(linha.xmax), Number(linha.ymax)
    ],
    geometria: JSON.parse(linha.geojson)
  }
}

module.exports = controller
