'use strict'

const Joi = require('joi')

const models = {}

// Os modulos que a rota aceita. 'plataforma' entra porque usuario, perfil, meta
// do PIT e edicao do RPCMTec nao sao de modulo nenhum, e e la que moram os
// eventos mais sensiveis do sistema.
const MODULOS = ['acervo', 'mapoteca', 'orcamento', 'equipamento', 'plataforma']

models.historicoParams = Joi.object().keys({
  modulo: Joi.string().valid(...MODULOS).required(),
  entidade: Joi.string().max(50).required(),
  // TEXTO, e nao numero: o sistema identifica registro por id inteiro, por uuid
  // e por code de dominio. Validar como inteiro recusaria o historico da versao
  // do acervo e o do usuario.
  id: Joi.string().max(64).required()
})

// Mesmo formato do `gerencia_schema.paginationParams`, de proposito: e o
// contrato que o `components/paginacao/` do cliente ja consome, e duas formas de
// paginar na mesma interface se leriam como coisas diferentes.
models.listagemQuery = Joi.object().keys({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  modulo: Joi.string().valid(...MODULOS),
  entidade: Joi.string().max(50),
  entidade_id: Joi.string().max(64),
  usuario_uuid: Joi.string().uuid(),
  operacao: Joi.string().valid('I', 'U', 'D'),
  origem: Joi.string().max(20),
  campo: Joi.string().max(80),
  lote_id: Joi.string().uuid(),
  // Dia de calendario, e por isso `.raw()`: sem ele o Joi converteria
  // 'AAAA-MM-DD' em meia-noite UTC e o recorte perderia o primeiro dia em
  // UTC-3. E o padrao da casa (ver produto_schema.js e mapoteca).
  data_inicio: Joi.date().iso().raw(),
  data_fim: Joi.date().iso().raw()
})

models.MODULOS = MODULOS

module.exports = models
