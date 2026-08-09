'use strict'

const Joi = require('joi')

const models = {}

// ---------------------------------------------------------------------------
// A geometria do campo
// ---------------------------------------------------------------------------
//
// VALIDADOR PROPRIO, e nao o `utils/geometria_schema.js` compartilhado. Aquele
// aceita UM Polygon de UM anel e no maximo 100 vertices, e as restricoes existem
// la por uma razao que aqui nao vale: ele valida o recorte de BUSCA, que viaja
// na URL e precisa caber num link compartilhavel.
//
// UM POLIGONO SO, e isso e uma decisao do chefe de 2026-08-09, MEDIDA antes de
// ser tomada: dos 47 poligonos do dump de producao do SAP, os 47 tem UMA parte
// (`ST_NumGeometries` = 1) e NENHUM tem buraco. O MULTIPOLYGON de varias partes
// era defesa contra um caso que nao existe -- e defesa contra caso inexistente
// custa caro na entrada, porque um GeoJSON com duas partes por engano entraria
// calado e a area do campo passaria a ser outra.
//
// A COLUNA CONTINUA MULTIPOLYGON, e o estreitamento e AQUI, deliberado. Trocar o
// tipo da coluna custaria uma migracao de estrutura para ganhar nada: o
// `ST_Multi` do INSERT ja embrulha, e a coluna aceitar mais do que a porta
// deixa entrar nao e incoerencia -- e a porta que decide.
//
// BURACO CONTINUA PERMITIDO: um poligono com ilha interna ainda e UM poligono.
// Nenhum campo do SAP tem, e recusa-lo seria inventar uma restricao que nem os
// dados nem o chefe pediram.
//
// ACEITA Polygon E MultiPolygon DE UMA PARTE, e NORMALIZA para MultiPolygon: a
// coluna e MULTIPOLYGON, e obrigar quem importa a embrulhar o desenho seria
// exigir dele um detalhe que e do banco. O SQL sempre recebe a mesma forma.
//
// O TETO DE VERTICES contem engano de importacao, e nao aperta quem desenha: os
// 47 poligonos do dump tem 23 vertices em media.
const MAX_VERTICES = 2000

const coordenadaOk = c =>
  Array.isArray(c) && c.length >= 2 &&
  Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
  c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90

/**
 * Valida e normaliza um anel de coordenadas.
 * @returns {Array|string} o anel limpo, ou a mensagem de erro
 */
const limparAnel = anel => {
  if (!Array.isArray(anel) || anel.length < 4) {
    return 'cada anel precisa de ao menos três vértices'
  }
  if (!anel.every(coordenadaOk)) return 'a geometria tem coordenada inválida'
  const primeiro = anel[0]
  const ultimo = anel[anel.length - 1]
  // Anel aberto entra no PostGIS como geometria invalida, e o erro que ele
  // devolve nao diz qual anel nem por que.
  if (primeiro[0] !== ultimo[0] || primeiro[1] !== ultimo[1]) {
    return 'cada anel precisa ser fechado (primeiro vértice igual ao último)'
  }
  return anel.map(c => [c[0], c[1]])
}

const geometriaCampo = Joi.string().custom((valor, helpers) => {
  let geo
  try {
    geo = JSON.parse(valor)
  } catch {
    return helpers.message('a geometria precisa ser um GeoJSON válido')
  }
  if (!geo || !Array.isArray(geo.coordinates)) {
    return helpers.message('a geometria precisa ser um GeoJSON válido')
  }

  // Polygon vira MultiPolygon de uma parte. A tela pode mandar qualquer um dos
  // dois; o banco so conhece o segundo.
  const partes = geo.type === 'Polygon'
    ? [geo.coordinates]
    : geo.type === 'MultiPolygon'
      ? geo.coordinates
      : null

  if (!partes) {
    return helpers.message('a geometria precisa ser um Polygon ou um MultiPolygon')
  }
  if (partes.length === 0) {
    return helpers.message('a geometria precisa ter ao menos um polígono')
  }
  // UM SO. Ver o cabecalho: os 47 poligonos do SAP tem uma parte, e a mensagem
  // diz QUANTAS vieram porque o engano tipico e um arquivo com varias feicoes
  // colapsado em MultiPolygon por alguma ferramenta.
  if (partes.length > 1) {
    return helpers.message(
      `a geometria precisa ser UM polígono só, e vieram ${partes.length}`
    )
  }

  let vertices = 0
  const limpas = []
  for (const parte of partes) {
    if (!Array.isArray(parte) || parte.length === 0) {
      return helpers.message('a geometria precisa ter ao menos um polígono')
    }
    const aneis = []
    for (const anel of parte) {
      const limpo = limparAnel(anel)
      if (typeof limpo === 'string') return helpers.message(limpo)
      vertices += limpo.length
      aneis.push(limpo)
    }
    limpas.push(aneis)
  }
  if (vertices > MAX_VERTICES) {
    return helpers.message(`o desenho excede ${MAX_VERTICES} vértices`)
  }

  return JSON.stringify({ type: 'MultiPolygon', coordinates: limpas })
})

// ---------------------------------------------------------------------------
// Parametros de rota
// ---------------------------------------------------------------------------

models.idParams = Joi.object().keys({
  id: Joi.number().integer().positive().required()
})

models.imagemIdParams = Joi.object().keys({
  imagemId: Joi.number().integer().positive().required()
})

models.trackIdParams = Joi.object().keys({
  trackId: Joi.number().integer().positive().required()
})

// ---------------------------------------------------------------------------
// O campo
// ---------------------------------------------------------------------------

// `Joi.date().iso().raw()` NAO E PREFERENCIA. Sem o `.raw()` o Joi devolve um
// Date e a coluna DATE guarda o dia ANTERIOR em UTC-3; sem o `.iso()`,
// '01/08/2026' vira 8 de janeiro. As duas coisas ja aconteceram nesta casa.
const dia = Joi.date().iso().raw()

models.campo = Joi.object().keys({
  nome: Joi.string().trim().max(255).required(),
  descricao: Joi.string().allow(null, ''),
  // O ANO E O DO EXERCICIO DO PIT, e a chave estrangeira o confere. O piso de
  // 2000 e teto de 2100 aqui so evitam que um erro de digitacao vire uma
  // consulta de chave estrangeira: quem recusa 2027 sem exercicio e o banco, e
  // a mensagem dele e traduzida no controller.
  ano: Joi.number().integer().min(2000).max(2100).required(),
  situacao_id: Joi.number().integer().required(),
  data_inicio: dia.required(),
  data_fim: dia.required(),
  placas_vtr: Joi.string().max(255).allow(null, ''),
  militares_externos: Joi.string().allow(null, ''),
  // AO MENOS UMA CATEGORIA. Campo sem finalidade nao tem o que escrever na
  // coluna "Finalidade Campo" da 2.5, e a subsecao sairia com celula vazia.
  categorias: Joi.array().items(Joi.number().integer()).min(1).unique().required(),
  // OS MILITARES DA DIVISAO. Lista possivelmente VAZIA, e nao e descuido: um
  // campo pode ser todo de gente de fora, e ai o efetivo vive so em
  // `militares_externos`.
  militares: Joi.array().items(Joi.string().uuid()).unique().default([]),
  // AS VERSOES QUE O CAMPO ATENDEU. Tambem vazia por padrao: viagem
  // internacional, exercicio e apoio a outra OM nao geram produto a apontar, e
  // no dump do SAP so 3 campos de 54 tinham vinculo.
  versoes: Joi.array().items(Joi.number().integer().positive()).unique().default([]),
  geometria: geometriaCampo.required()
})
  // O CHECK do banco (`campo_fim_apos_inicio`) tambem cobra, e o Joi cobra
  // ANTES porque a mensagem dele diz o campo. A do banco cita o nome da
  // restricao, que nao ajuda quem acabou de digitar.
  .custom((valor, helpers) => {
    if (valor.data_fim < valor.data_inicio) {
      return helpers.message('data_fim precisa ser igual ou posterior a data_inicio')
    }
    return valor
  })

models.campoQuery = Joi.object().keys({
  ano: Joi.number().integer().min(2000).max(2100),
  situacao_id: Joi.number().integer(),
  categoria_id: Joi.number().integer(),
  // Busca por nome, para a tela tabular.
  busca: Joi.string().trim().max(255).allow('')
})

// ---------------------------------------------------------------------------
// Imagem
// ---------------------------------------------------------------------------

// O TETO E 56 MB DE BASE64, que sao ~40 MB de binario, e ele veio MEDIDO: o
// maior video do dump do SAP tem 37 MB. Base64 cresce o arquivo em um terco,
// entao o teto do texto tem de ser maior que o teto que se quer do arquivo.
//
// E o unico ponto do SCA que aceita um corpo desse tamanho. `express.json` tem
// limite proprio, e a rota que recebe imagem precisa do dela em `routes.js`.
const MAX_BASE64 = 58720256

models.imagem = Joi.object().keys({
  descricao: Joi.string().allow(null, ''),
  data_imagem: dia.allow(null),
  tipo: Joi.string().valid('foto', 'video').default('foto'),
  // ANULAVEL de proposito: 133 das 143 imagens do dump do SAP estao sem, e
  // inventar 'image/jpeg' para todas seria gravar um palpite. Quem nao manda
  // recebe o tipo generico na hora de servir.
  mime_type: Joi.string().max(100).allow(null, ''),
  conteudo_base64: Joi.string().base64().max(MAX_BASE64).required()
})

models.imagemUpdate = Joi.object().keys({
  descricao: Joi.string().allow(null, ''),
  data_imagem: dia.allow(null)
})

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

// O PONTO NAO E GeoJSON: sao dois numeros. Um objeto GeoJSON por ponto
// multiplicaria por cinco o corpo de uma importacao de 6.500 pontos, que e o
// tamanho medio de um track no dump do SAP.
const pontoTrack = Joi.object().keys({
  longitude: Joi.number().min(-180).max(180).required(),
  latitude: Joi.number().min(-90).max(90).required(),
  elevacao: Joi.number().allow(null),
  // A HORA E O DADO, e nao o dia: e ela que ordena o trajeto. `Joi.date()` sem
  // `.raw()` aqui esta CERTO, ao contrario das colunas DATE acima -- a coluna e
  // `timestamp with time zone`, e o fuso e justamente o que ela guarda.
  momento: Joi.date().iso().allow(null)
})

models.track = Joi.object().keys({
  chefe_vtr: Joi.string().trim().max(255).required(),
  motorista: Joi.string().trim().max(255).required(),
  placa_vtr: Joi.string().trim().max(255).required(),
  dia: dia.required(),
  // O TETO DE 50.000 PONTOS por track: o maior do dump tem cerca de 6.500, e o
  // teto existe para conter arquivo GPX de mes inteiro mandado por engano, que
  // travaria a transacao.
  pontos: Joi.array().items(pontoTrack).min(2).max(50000).required()
})

models.trackUpdate = Joi.object().keys({
  chefe_vtr: Joi.string().trim().max(255).required(),
  motorista: Joi.string().trim().max(255).required(),
  placa_vtr: Joi.string().trim().max(255).required(),
  dia: dia.required()
})

module.exports = models
module.exports.MAX_VERTICES = MAX_VERTICES
module.exports.MAX_BASE64 = MAX_BASE64
