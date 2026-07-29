// Path: ponto_controle\ponto_controle_schema.js
'use strict'

const Joi = require('joi')

const models = {}

// O codigo do ponto e a identidade global, como o MI/INOM e do produto:
// UF-HV-XXXX, ate 4 digitos, sem zero a esquerda.
const COD_PONTO = /^[A-Z]{2}-(HV|BASE)-[1-9][0-9]{0,3}$/

models.codPontoParams = Joi.object().keys({
  cod_ponto: Joi.string().pattern(COD_PONTO).required()
})

// Os filtros da tela, compartilhados pela lista, pelas facetas, pelas posicoes
// do mapa e pelo CSV. Um schema so porque um filtro so: se divergirem, o numero
// entre parenteses na faceta deixa de ser o total que a lista devolve.
const filtros = {
  lote_id: Joi.number().integer(),
  projeto_id: Joi.number().integer(),
  tipo_situacao: Joi.number().integer(),
  // Recorte espacial da tela: minx,miny,maxx,maxy em 4674.
  bbox: Joi.string().pattern(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/),
  // Busca por parte do codigo, para a caixa de texto.
  cod_ponto: Joi.string().max(255)
}

models.facetasQuery = Joi.object().keys({ ...filtros })

models.posicoesQuery = Joi.object().keys({ ...filtros })

// O CSV aceita `ids` para exportar SO os selecionados. Sem ele, exporta o
// conjunto inteiro que os filtros descrevem, e nao a pagina na tela.
models.csvQuery = Joi.object().keys({
  ...filtros,
  ids: Joi.alternatives().try(
    Joi.array().items(Joi.number().integer()).single(),
    Joi.string().pattern(/^\d+(,\d+)*$/)
  )
})

models.listaQuery = Joi.object().keys({
  ...filtros,
  pagina: Joi.number().integer().min(1).default(1),
  por_pagina: Joi.number().integer().min(1).max(500).default(100)
})

// Um arquivo do ponto, como o manifesto da missao o declara.
//
// O conteudo NAO passa por aqui, e o VOLUME tambem nao: quem escolhe onde o
// arquivo mora e o servidor, pelo volume primario do tipo de produto 10. Deixar
// o cliente escolher o volume seria deixa-lo escrever onde quisesse.
//
// O `checksum` daqui e uma AFIRMACAO, nao uma prova: o confirm-upload recalcula
// o SHA-256 sobre o arquivo que chegou ao volume, e e esse que vale. O
// `tamanho_mb` serve so para a conta de espaco; o gravado e o medido no disco.
models.arquivo = Joi.object().keys({
  tipo_arquivo_id: Joi.number().integer().required(),
  nome_arquivo: Joi.string().required(),
  extensao: Joi.string().max(20).allow(null, ''),
  tamanho_mb: Joi.number().allow(null),
  checksum: Joi.string().length(64).pattern(/^[0-9a-f]{64}$/).required(),
  metadado: Joi.object().allow(null)
})

// Um ponto vindo do GeoPackage da missao. As colunas de dominio e de medicao
// entram como um objeto solto (`atributos`), conferido contra as COLUNAS REAIS
// da tabela no controller.
//
// Por que nao listar as 56 colunas aqui: a lista viveria em dois lugares, e o
// dia em que o plugin ganhasse um campo, este schema o recusaria em silencio.
// O controller compara com a tabela viva e RELATA o que sobrou ou faltou.
models.ponto = Joi.object().keys({
  cod_ponto: Joi.string().pattern(COD_PONTO).required(),
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  atributos: Joi.object().required(),
  arquivos: Joi.array().items(models.arquivo).default([])
})

// Corpo da FASE 1 (prepare-upload/missao). Ela nao grava ponto nenhum: confere
// a missao inteira, reserva a sessao e devolve para onde copiar cada arquivo.
models.prepararMissao = Joi.object().keys({
  lote_id: Joi.number().integer().required(),
  // Sem isto, reimportar uma missao corrigida seria recusada ponto a ponto.
  // Com isto ligado, o ponto que ja existe e SUBSTITUIDO. E ato explicito de
  // quem importa, e nao o padrao.
  substituir: Joi.boolean().default(false),
  pontos: Joi.array().items(models.ponto).min(1).required()
})

// Corpo da FASE 2 (confirm-upload). So o identificador da sessao: tudo o que se
// vai gravar ja esta nas tabelas temporarias, e o que decide o resultado sao os
// ARQUIVOS no volume, nao o que o cliente mandar aqui.
models.confirmarMissao = Joi.object().keys({
  session_uuid: Joi.string().uuid().required()
})

module.exports = models
