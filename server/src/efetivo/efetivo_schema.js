'use strict'

const Joi = require('joi')

const models = {}

// Dia de CALENDÁRIO: `.iso().raw()`. Sem o `.raw()` o Joi converte 'AAAA-MM-DD'
// em meia-noite UTC e a coluna guarda o dia anterior em UTC-3, o que aqui não
// seria cosmético: a passagem que começa em 01/01 passaria a começar em 31/12 e
// bateria no EXCLUDE contra a passagem do ano anterior.
const dia = Joi.date().iso().raw()

models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.anoQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

models.anoObrigatorioQuery = Joi.object().keys({
  ano: Joi.number().integer().required()
})

models.anoMesQuery = Joi.object().keys({
  ano: Joi.number().integer().required(),
  mes: Joi.number().integer().min(1).max(12).required()
})

// A 6.1 do RPCMTec e a tela leem JSON; o chefe que fecha o mes baixa CSV. Mesma
// consulta, mesma guarda, mesmo recorte: um formato separado divergiria do que a
// tela mostra na primeira regra nova.
models.anoMesRelatorioQuery = models.anoMesQuery.keys({
  formato: Joi.string().valid('json', 'csv').default('json')
})

// --- Passagem pela DGEO ------------------------------------------------------

models.criarPeriodo = Joi.object().keys({
  usuario_uuid: Joi.string().uuid().required(),
  data_inicio: dia.required(),
  // NULO é "sem previsão de saída", e é o caso comum. A tela mostra isso como
  // uma caixa marcada, e não como um campo vazio.
  data_fim: dia.allow(null, ''),
  observacao: Joi.string().allow(null, '')
})

// O MILITAR não entra: trocá-lo numa passagem existente reescreveria de quem é o
// período. Para isso, exclui-se e cadastra de novo.
models.atualizarPeriodo = Joi.object().keys({
  data_inicio: dia.required(),
  data_fim: dia.allow(null, ''),
  observacao: Joi.string().allow(null, '')
})

// --- Impedimento -------------------------------------------------------------

const impedimento = {
  descricao: Joi.string().max(255).required(),
  // 1 a 100. Zero seria um impedimento que não impede, e o registro dele só
  // encheria a lista; 100 é o afastamento integral.
  percentual: Joi.number().integer().strict().min(1).max(100).required(),
  data_inicio: dia.required(),
  data_fim: dia.allow(null, '')
}

models.criarImpedimento = Joi.object().keys({
  usuario_uuid: Joi.string().uuid().required(),
  ...impedimento
})

models.atualizarImpedimento = Joi.object().keys({ ...impedimento })

// --- O PRÓPRIO aproveitamento ------------------------------------------------
//
// OS MESMOS CAMPOS, MENOS O MILITAR. O dono sai de `req.usuarioUuid`, que veio do
// token já validado, e nunca do pedido: declarar `usuario_uuid` aqui seria
// oferecer no contrato justamente o campo que estas rotas existem para não ler.
// Quem o mandar assim mesmo cai no `stripUnknown` do `schemaValidation`, que o
// descarta e avisa no envelope.
//
// SÃO OS SCHEMAS DE ATUALIZAÇÃO REAPROVEITADOS, e não cópias: `atualizarPeriodo`
// e `atualizarImpedimento` já são exatamente "o registro sem o militar", que é o
// corpo destas rotas. Duas declarações do mesmo conjunto divergiriam no primeiro
// campo novo, e a que ficasse para trás seria a do próprio, que é a menos olhada.
models.meuPeriodo = models.atualizarPeriodo
models.meuImpedimento = models.atualizarImpedimento

module.exports = models
