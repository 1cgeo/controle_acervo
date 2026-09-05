'use strict'

const Joi = require('joi')

const models = {}

// Parametro de rota: id do recebimento (BIGSERIAL). Coercao numerica.
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Query da listagem: filtro opcional por nota de empenho.
models.listarQuery = Joi.object().keys({
  nota_empenho_id: Joi.number().integer()
})

// Campos comuns de criacao/atualizacao do recebimento de material.
const camposBase = {
  nota_empenho_id: Joi.number().integer().strict().required(),
  material: Joi.string().required(),
  prazo_entrega: Joi.string().max(60).allow(null, ''),
  situacao: Joi.string().allow(null, ''),
  // Ano em que o material foi recebido (em que RPCMTec/3.6 deve constar). Quando
  // omitido/null, a 3.6 usa o ano da NE. Serve para itens de RPNP (empenho de ano
  // anterior) recebidos no ano corrente aparecerem na 3.6 do ano do recebimento.
  ano_referencia: Joi.number().integer().strict().allow(null),
  // O DIA em que o material chegou, e e ele que recorta a 4.6 pelo MES da
  // edicao (`rpcmtec_ctrl.js`, `rm.data_recebimento <= cutoff`). A coluna nasceu
  // em 2026-08-11 e ficou INERTE por falta desta linha: sem campo no Joi e sem
  // coluna no INSERT/UPDATE, toda linha nova nascia com o dia NULO, e a regra do
  // relatorio ("nulo continua aparecendo") fazia a edicao de janeiro listar
  // material recebido em julho -- exatamente o que a migracao existia para
  // consertar.
  //
  // `.raw()` preserva a string 'YYYY-MM-DD' (sem converter para Date UTC), senao
  // o Postgres (sessao em UTC-3) gravaria o dia anterior ao informado.
  data_recebimento: Joi.date().iso().raw().allow(null)
}

models.criar = Joi.object().keys({
  ...camposBase
})

models.atualizar = Joi.object().keys({
  ...camposBase
})

module.exports = models
