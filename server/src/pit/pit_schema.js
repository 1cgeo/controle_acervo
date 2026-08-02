'use strict'

const Joi = require('joi')

const models = {}

// Dia de CALENDÁRIO, e por isso `.iso().raw()`. Sem o `.raw()` o Joi converte
// 'AAAA-MM-DD' em meia-noite UTC e a coluna guarda o dia anterior em UTC-3; sem
// o `.iso()` a string segue crua para o Postgres, e '01/08/2026' vira 8 de
// janeiro, porque o DateStyle padrão é MDY. É o padrão da casa desde
// 2026-08-01, e vale para `prazo`, `data_conclusao` e `data_entrega`.
const dia = Joi.date().iso().raw()

models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// O que o PIT promete no item. Os quatro são OPCIONAIS, e omitir vale nulo: a
// linha de cabeçalho da meta não promete quantidade nenhuma (quem promete são
// os itens que ela agrupa), e o PIT de 2025 foi cadastrado só no nível da meta.
const promessa = {
  quantidade_prevista: Joi.number().integer().strict().min(0).allow(null),
  unidade: Joi.string().max(50).allow(null, ''),
  demandante: Joi.string().max(255).allow(null, ''),
  prazo: dia.allow(null, '')
}

models.criar = Joi.object().keys({
  ano: Joi.number().integer().strict().required(),
  numero_meta: Joi.number().integer().strict().required(),
  item: Joi.string().max(20).allow(null, ''),
  descricao: Joi.string().allow(null, ''),
  ...promessa
})

models.atualizar = Joi.object().keys({
  ano: Joi.number().integer().strict().required(),
  numero_meta: Joi.number().integer().strict().required(),
  item: Joi.string().max(20).allow(null, ''),
  descricao: Joi.string().allow(null, ''),
  ...promessa
})

// --- Execução mensal --------------------------------------------------------

models.execucaoDoMesQuery = Joi.object().keys({
  ano: Joi.number().integer().required(),
  mes: Joi.number().integer().min(1).max(12).required()
})

// O `mes` é OPCIONAL aqui, e a ausência dele muda a resposta: sem mês, o
// realizado é o ano inteiro (é o que a tela mostra); com mês, é o acumulado até
// ele mais o número daquele mês, que são as duas colunas da 2.1.
models.resumoQuery = Joi.object().keys({
  ano: Joi.number().integer().required(),
  mes: Joi.number().integer().min(1).max(12)
})

models.metaIdParams = Joi.object().keys({
  metaId: Joi.number().integer().required()
})

models.salvarExecucao = Joi.object().keys({
  meta_id: Joi.number().integer().strict().required(),
  mes: Joi.number().integer().strict().min(1).max(12).required(),
  // Zero é valor legítimo e diferente de não lançado: "conferi o mês e não
  // houve" é uma resposta, e ela some da tela se for tratada como ausência.
  quantidade: Joi.number().integer().strict().min(0).required(),
  data_conclusao: dia.allow(null, ''),
  observacao: Joi.string().allow(null, '')
})

// --- Demanda Extra-PIT ------------------------------------------------------

const demandaExtra = {
  ano: Joi.number().integer().strict().required(),
  demandante: Joi.string().max(255).required(),
  tipo_produto: Joi.string().max(255).required(),
  quantidade: Joi.number().integer().strict().min(1).required(),
  situacao_id: Joi.number().integer().strict().required(),
  // OBRIGATÓRIO, e é o que separa o Extra-PIT de trabalho fora do plano: o
  // modelo do relatório tem uma coluna para ele.
  documento_autorizacao: Joi.string().max(255).required(),
  descricao: Joi.string().allow(null, ''),
  data_entrega: dia.allow(null, '')
}

models.criarDemandaExtra = Joi.object().keys({ ...demandaExtra })

models.atualizarDemandaExtra = Joi.object().keys({ ...demandaExtra })

module.exports = models
