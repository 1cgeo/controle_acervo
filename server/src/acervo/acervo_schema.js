// Path: acervo\acervo_schema.js
'use strict'

const Joi = require('joi')

const models = {}

models.produtoByIdParams = Joi.object().keys({
  produto_id: Joi.number().integer().required()
});

models.versaoByIdParams = Joi.object().keys({
  versao_id: Joi.number().integer().required()
});

models.arquivosIds = Joi.object().keys({
  arquivos_ids: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
    .unique()
})

models.produtosIdsComTipos = Joi.object().keys({
  produtos_ids: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
    .unique(),
  tipos_arquivo: Joi.array()
    .items(
      Joi.number()
        .integer()
        .strict()
        .required()
    )
    .required()
    .min(1)
    .unique()
});

models.downloadConfirmations = Joi.object().keys({
  confirmations: Joi.array()
    .items(
      Joi.object().keys({
        download_token: Joi.string().uuid().required(),
        success: Joi.boolean().required(),
        error_message: Joi.string().allow(null, '')
      })
    )
    .required()
    .min(1)
});

models.situacaoGeralQuery = Joi.object().keys({
  scale25k: Joi.boolean().default(false),
  scale50k: Joi.boolean().default(false),
  scale100k: Joi.boolean().default(false),
  scale250k: Joi.boolean().default(false)
});

// Recorte espacial da busca: 'minLon,minLat,maxLon,maxLat' em graus.
//
// Vem como UMA string, e nao como quatro numeros, porque e o formato que o mapa
// ja produz (getBounds().toArray()) e que cabe inteiro numa URL compartilhavel.
// A validacao aqui rejeita o retangulo degenerado ou invertido: sem isso o
// ST_MakeEnvelope aceita e devolve zero resultado em silencio, que a tela leria
// como "nao existe produto nessa area".
const bboxSchema = Joi.string().custom((valor, helpers) => {
  const partes = String(valor).split(',').map(n => Number(n.trim()));
  if (partes.length !== 4 || partes.some(n => !Number.isFinite(n))) {
    return helpers.message('bbox precisa de quatro números: minLon,minLat,maxLon,maxLat');
  }
  const [minLon, minLat, maxLon, maxLat] = partes;
  if (minLon >= maxLon || minLat >= maxLat) {
    return helpers.message('bbox precisa ter minLon < maxLon e minLat < maxLat');
  }
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    return helpers.message('bbox fora do intervalo de coordenadas geográficas');
  }
  return partes;
});

// Poligono desenhado no mapa, como GeoJSON em texto.
//
// O teto de vertices existe por DOIS motivos, e nenhum e estetico: a consulta
// espacial paga por vertice, e a busca inteira viaja na URL (o link tem de ser
// compartilhavel). Cem vertices desenham qualquer recorte operacional e mantem
// a URL abaixo do que servidor e navegador aceitam sem susto.
const MAX_VERTICES = 100;

const geometriaSchema = Joi.string().custom((valor, helpers) => {
  let geo;
  try {
    geo = JSON.parse(valor);
  } catch {
    return helpers.message('geometria precisa ser um GeoJSON válido');
  }
  if (!geo || geo.type !== 'Polygon' || !Array.isArray(geo.coordinates)) {
    return helpers.message('geometria precisa ser um Polygon');
  }
  // Um anel externo, sem buracos: e o que o desenho do mapa produz, e aceitar
  // mais seria prometer o que a ferramenta nao entrega.
  if (geo.coordinates.length !== 1) {
    return helpers.message('geometria precisa ter exatamente um anel');
  }
  const anel = geo.coordinates[0];
  if (!Array.isArray(anel) || anel.length < 4) {
    return helpers.message('o anel precisa de ao menos três vértices');
  }
  if (anel.length > MAX_VERTICES + 1) {
    return helpers.message(`o desenho excede ${MAX_VERTICES} vértices`);
  }
  const coordenadaOk = (c) => Array.isArray(c) && c.length >= 2
    && Number.isFinite(c[0]) && Number.isFinite(c[1])
    && c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90;
  if (!anel.every(coordenadaOk)) {
    return helpers.message('geometria tem coordenada inválida');
  }
  // Anel aberto entra no PostGIS como geometria invalida.
  const primeiro = anel[0];
  const ultimo = anel[anel.length - 1];
  if (primeiro[0] !== ultimo[0] || primeiro[1] !== ultimo[1]) {
    return helpers.message('o anel precisa ser fechado (primeiro vértice igual ao último)');
  }
  // Devolve normalizado: o SQL recebe sempre o mesmo formato.
  return JSON.stringify({ type: 'Polygon', coordinates: [anel.map(c => [c[0], c[1]])] });
});

// Filtros compartilhados entre a busca paginada e a camada do mapa.
//
// As duas rotas respondem a MESMA pergunta, e por isso partem do mesmo objeto:
// se divergirem, o mapa passa a mostrar um conjunto e a lista outro, que e pior
// do que nao ter mapa. Espalhar (`...filtrosBusca`) e o que impede um filtro
// novo de entrar so num lado.
const filtrosBusca = {
  termo: Joi.string().allow(''),
  tipo_produto_id: Joi.number().integer(),
  // Subtipo (T34-700, ET-RDG, Carta Topografica Militar...). Ver o comentario
  // do controlador: ele casa no produto E na versao, de proposito.
  subtipo_produto_id: Joi.number().integer(),
  tipo_escala_id: Joi.number().integer(),
  projeto_id: Joi.number().integer(),
  lote_id: Joi.number().integer(),
  // Recorte espacial: a caixa (navegacao do mapa) ou o poligono (desenho).
  bbox: bboxSchema,
  geometria: geometriaSchema,
  // Palavra-chave EXATA de acervo.versao.palavras_chave. Diferente do `termo`,
  // que e substring: aqui a pessoa escolheu uma etiqueta que existe.
  palavra_chave: Joi.string().allow('')
};

models.buscaProdutos = Joi.object().keys({
  ...filtrosBusca,
  // A geometria de cada produto sai da resposta por padrao. A LISTA nao precisa
  // dela; quem precisa e a camada do mapa, que tem rota propria.
  com_geometria: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

// Camada do mapa: os MESMOS filtros, sem paginacao.
//
// Existe porque paginar o mapa e um erro de leitura: com 20 poligonos na tela
// de 800 resultados, o mapa parece dizer que o acervo tem 20 cartas ali. O teto
// protege o navegador; passando dele, a resposta avisa que truncou em vez de
// mentir por omissao.
// O padrao cabe o acervo INTEIRO com folga (5.741 produtos em 2026-07-28, que
// saem em 29 ms e 1,39 MB de JSON). Buscar sem filtro nenhum e o pior caso, e
// ele precisa caber: e justamente quando a pessoa quer ver a cobertura toda.
models.buscaGeometrias = Joi.object().keys({
  ...filtrosBusca,
  limit: Joi.number().integer().min(1).max(50000).default(20000)
});

// Exportacao CSV do resultado da busca.
//
// `ids` existe para o "exportar so os selecionados": quando vem preenchido, os
// demais filtros continuam valendo, mas o conjunto e restringido ao que a pessoa
// escolheu na tela. Sem ele, exporta o resultado inteiro da busca.
models.buscaCsv = Joi.object().keys({
  ...filtrosBusca,
  ids: Joi.string().pattern(/^\d+(,\d+)*$/).messages({
    'string.pattern.base': 'ids precisa ser uma lista de números separados por vírgula'
  })
});

models.palavrasChave = Joi.object().keys({
  termo: Joi.string().allow(''),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

// Auditoria de invariantes lógicos do acervo.
models.auditoriaQuery = Joi.object().keys({
  severidade: Joi.string().valid('DEFECT', 'REVISAR', 'INFO'),
  // csv de códigos (ex.: 1a,2c,4b). Sem isso, roda todos.
  codigos: Joi.string().pattern(/^[0-9a-z_]+(,[0-9a-z_]+)*$/),
  // Quantas linhas de AMOSTRA por invariante. O total vem sempre inteiro; a
  // amostra é o que se lê. Teto baixo de propósito: quem precisa da lista toda
  // vai atrás dos ids, não de um dump pela API.
  amostra: Joi.number().integer().min(0).max(100).default(10)
})

module.exports = models
