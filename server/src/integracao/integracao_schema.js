'use strict'

const Joi = require('joi')

const models = {}

// Cobertura por folha (situação geral). Sem escala, varre as quatro.
// mi/inom: lista separada por vírgula (filtra às folhas pedidas).
models.situacaoGeralQuery = Joi.object().keys({
  escala: Joi.string().valid('25k', '50k', '100k', '250k'),
  geom: Joi.boolean().default(false),
  mi: Joi.string(),
  inom: Joi.string()
})

// Geometria GeoJSON aceita no recorte espacial. Só os tipos que fazem sentido
// como ÁREA de interesse: ponto e linha dariam interseção de área zero e
// nenhuma folha passaria o limiar, o que pareceria "acervo vazio" em vez de
// "você mandou a geometria errada".
const geometriaGeoJson = Joi.object().keys({
  type: Joi.string().valid('Polygon', 'MultiPolygon').required(),
  coordinates: Joi.array().min(1).required(),
  crs: Joi.any().strip(),
  bbox: Joi.any().strip()
})

// Recorte espacial da situação geral. Vai por POST porque a área de interesse
// é uma geometria inteira: uma moldura de projeto passa fácil do limite de
// query string, e truncar URL daria resposta errada em silêncio.
//
// `limiar` é a fração MÍNIMA da FOLHA coberta pela área (não o inverso): 0.01
// pega quem encosta, 0.5 só quem está majoritariamente dentro. Mantém a
// semântica do script que esta rota aposenta.
models.situacaoGeralEspacialBody = Joi.object().keys({
  escala: Joi.string().valid('25k', '50k', '100k', '250k'),
  geom: Joi.boolean().default(false),
  mi: Joi.string(),
  inom: Joi.string(),
  intersecta: Joi.array().items(geometriaGeoJson).min(1).required(),
  limiar: Joi.number().min(0).max(1).default(0.01)
})

// Período mensal de um ano, com modo cumulativo (acumulado até o mês).
// ano/mes default: data corrente. cumulativo default: true (RPCMTec é cumulativo).
const periodoBase = {
  ano: Joi.number()
    .integer()
    .min(2000)
    .max(2100)
    .default(() => new Date().getFullYear()),
  mes: Joi.number()
    .integer()
    .min(1)
    .max(12)
    .default(() => new Date().getMonth() + 1),
  cumulativo: Joi.boolean().default(true)
}

// Produtos finalizados no mês (RPCMTec 2.2). Filtra por data_edicao (finalização).
models.produtosFinalizadosQuery = Joi.object().keys({
  ...periodoBase,
  tipo_produto_id: Joi.number().integer(),
  tipo_escala_id: Joi.number().integer()
})

// Atendimentos da mapoteca no mês (RPCMTec 2.4 e 2.7).
models.atendimentosQuery = Joi.object().keys({
  ...periodoBase
})

module.exports = models
