'use strict'

const Joi = require('joi')

const models = {}

// Query do gerador: ano e mês de corte, sempre os dois.
//
// SEM a chave `cumulativo` que a antiga rota do orçamento tinha. Ela oferecia
// escolher entre "só o mês" e "acumulado no ano", e o RPCMTec não tem essa
// escolha: cada subseção já sabe qual dos dois recortes é o seu (a 2.4 lista o
// MÊS, a 3.1 mostra os dois lado a lado, a 4.1 é sempre acumulada no ano). Uma
// chave global sobrepondo isso só conseguia gerar um relatório que não fecha
// com nenhuma edição real.
models.gerarQuery = Joi.object().keys({
  ano: Joi.number().integer().required(),
  mes: Joi.number().integer().min(1).max(12).required()
})

// Parâmetro de rota: id da edição mensal (BIGSERIAL). Coerção numérica, que na
// URL o valor chega como string.
models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Listagem da edição mensal: filtro opcional por ano.
models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// Criação e atualização da edição mensal. A UNIQUE (ano, mes) vira 409 no ctrl.
const camposBase = {
  ano: Joi.number().integer().strict().required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  assinante: Joi.string().max(255).allow(null, ''),
  // .raw() preserva 'YYYY-MM-DD' sem passar por Date UTC; sem ele, grava o dia
  // anterior em UTC-3.
  data_assinatura: Joi.date().raw().allow(null)
}

models.criar = Joi.object().keys({ ...camposBase })
models.atualizar = Joi.object().keys({ ...camposBase })

// Dia de CALENDÁRIO: `.iso().raw()`. Sem o `.raw()` o Joi converte
// 'AAAA-MM-DD' em meia-noite UTC e a coluna guarda o dia anterior em UTC-3; sem
// o `.iso()` a string segue crua para o Postgres, e '01/08/2026' viraria 8 de
// janeiro pelo DateStyle MDY. Padrão da casa desde 2026-08-01.
const dia = Joi.date().iso().raw()

// --- Capacitação (2.6 ministrada / 6.2 recebida) ----------------------------

models.capacitacaoQuery = Joi.object().keys({
  ano: Joi.number().integer(),
  tipo_id: Joi.number().integer().min(1).max(2)
})

const capacitacao = {
  ano: Joi.number().integer().strict().required(),
  nome: Joi.string().max(255).required(),
  tipo_id: Joi.number().integer().strict().required(),
  situacao_id: Joi.number().integer().strict().required(),
  instituicoes: Joi.string().allow(null, ''),
  local_realizacao: Joi.string().max(255).allow(null, ''),
  data_inicio: dia.allow(null, ''),
  data_fim: dia.allow(null, ''),
  // As três seguintes valem para UM dos dois tipos, e o servidor não recusa a
  // que não pertence: quem decide o que aparece é o formulário, e quem decide o
  // que SAI é o gerador. Recusar aqui transformaria em erro um campo que a tela
  // nem mostra, no meio de um cadastro montado aos poucos.
  efetivo_capacitado: Joi.number().integer().strict().min(0).allow(null),
  // QUEM da Divisão participou, por uuid do cadastro (chefe, 2026-08-02). Era um
  // texto livre, e texto livre não casa com pessoa. Vale para os DOIS tipos: na
  // ministrada são os instrutores, na recebida são os capacitados, e o papel vem
  // do `tipo_id` em vez de ser um campo.
  //
  // `unique()` porque a tabela tem a UNIQUE (capacitacao, usuario): mandar o
  // mesmo duas vezes chegaria ao 409 do banco, e a lista vem de uma tela de
  // seleção onde repetir não faz sentido.
  militares: Joi.array().items(Joi.string().uuid()).unique().default([]),
  plano_codigo: Joi.string().max(255).allow(null, ''),
  documento: Joi.string().max(255).allow(null, ''),
  // Meta do PIT que esta capacitação cumpre (2026-08-03). ANULÁVEL, e a maioria
  // fica nula: em 2026 o PIT só promete capacitação MINISTRADA (a meta 5), e as
  // Recebidas não têm meta que as prometa. Exigir uma inventaria compromisso.
  meta_pit_id: Joi.number().integer().strict().allow(null)
}

models.criarCapacitacao = Joi.object().keys({ ...capacitacao })
models.atualizarCapacitacao = Joi.object().keys({ ...capacitacao })

module.exports = models
