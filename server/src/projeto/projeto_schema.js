"use strict";

const Joi = require("joi");

const models = {};

// `acervo.projeto.data_inicio/data_fim` e `acervo.lote.data_inicio/data_fim` sao
// colunas DATE: dia de calendario, nao instante.
//
// O BUG QUE O `.raw()` MATA. Sem ele, o Joi converte a string 'AAAA-MM-DD' num
// Date de MEIA-NOITE UTC. O driver manda o instante, e o Postgres o converte
// para o fuso da sessao antes de guardar no DATE. Em UTC-3, 2022-09-15T00:00Z
// vira 2022-09-14 21:00 local, e a coluna guarda 2022-09-14: o dia ANDA PARA
// TRAS. O GET devolve 'AAAA-MM-DD', entao reenviar o que o GET devolveu, sem
// mudar nada, RECUA A DATA UM DIA a cada chamada. Pego em 2026-07-31 ao
// reparentar dois lotes do Convenio RS, que perderam um dia cada.
//
// Com `.raw()`, a validacao continua sendo de data (o `.min` abaixo segue
// valendo), mas o valor que sai do Joi e a STRING original. O Postgres faz o
// cast de 'AAAA-MM-DD' para DATE sem fuso nenhum no caminho.
//
// Mesma solucao que `mapoteca.pedido` ja usava (data_pedido e irmas). O padrao
// da casa para dia de calendario e este.
const dataCalendario = () => Joi.date().raw();

models.projeto = Joi.object().keys({
  nome: Joi.string().required(),
  descricao: Joi.string().allow('').required(),
  data_inicio: dataCalendario().required(),
  // Espelha o CHECK data_fim >= data_inicio do banco
  data_fim: dataCalendario().min(Joi.ref('data_inicio')).allow(null).required(),
  // Quando o lote PROMETE terminar (2026-08-03). Daqui sai o mês do PLANEJADO
  // da grade do PIT, e por isso ela é coluna separada de `data_fim`: aquela é o
  // que aconteceu, esta é o que se prometeu, e a primeira sobrescreveria a
  // segunda no dia em que o lote fechasse.
  //
  // OPCIONAL, e não `required`: os lotes que já existem nasceram sem ela, e
  // exigi-la agora recusaria a edição de qualquer um deles.
  data_fim_prevista: dataCalendario().min(Joi.ref('data_inicio')).allow(null),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.projetoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  descricao: Joi.string().allow('').required(),
  data_inicio: dataCalendario().required(),
  // Espelha o CHECK data_fim >= data_inicio do banco
  data_fim: dataCalendario().min(Joi.ref('data_inicio')).allow(null).required(),
  // Quando o lote PROMETE terminar (2026-08-03). Daqui sai o mês do PLANEJADO
  // da grade do PIT, e por isso ela é coluna separada de `data_fim`: aquela é o
  // que aconteceu, esta é o que se prometeu, e a primeira sobrescreveria a
  // segunda no dia em que o lote fechasse.
  //
  // OPCIONAL, e não `required`: os lotes que já existem nasceram sem ela, e
  // exigi-la agora recusaria a edição de qualquer um deles.
  data_fim_prevista: dataCalendario().min(Joi.ref('data_inicio')).allow(null),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.projetoIds = Joi.object().keys({
  projeto_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
});

models.lote = Joi.object().keys({
  projeto_id: Joi.number().integer().strict().required(),
  pit: Joi.string().required(),
  nome: Joi.string().required(),
  descricao: Joi.string().allow('').optional(),
  data_inicio: dataCalendario().required(),
  // Espelha o CHECK data_fim >= data_inicio do banco
  data_fim: dataCalendario().min(Joi.ref('data_inicio')).allow(null).required(),
  // Quando o lote PROMETE terminar (2026-08-03). Daqui sai o mês do PLANEJADO
  // da grade do PIT, e por isso ela é coluna separada de `data_fim`: aquela é o
  // que aconteceu, esta é o que se prometeu, e a primeira sobrescreveria a
  // segunda no dia em que o lote fechasse.
  //
  // OPCIONAL, e não `required`: os lotes que já existem nasceram sem ela, e
  // exigi-la agora recusaria a edição de qualquer um deles.
  data_fim_prevista: dataCalendario().min(Joi.ref('data_inicio')).allow(null),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.loteAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  projeto_id: Joi.number().integer().strict().required(),
  pit: Joi.string().required(),
  nome: Joi.string().required(),
  descricao: Joi.string().allow('').optional(),
  data_inicio: dataCalendario().required(),
  // Espelha o CHECK data_fim >= data_inicio do banco
  data_fim: dataCalendario().min(Joi.ref('data_inicio')).allow(null).required(),
  // Quando o lote PROMETE terminar (2026-08-03). Daqui sai o mês do PLANEJADO
  // da grade do PIT, e por isso ela é coluna separada de `data_fim`: aquela é o
  // que aconteceu, esta é o que se prometeu, e a primeira sobrescreveria a
  // segunda no dia em que o lote fechasse.
  //
  // OPCIONAL, e não `required`: os lotes que já existem nasceram sem ela, e
  // exigi-la agora recusaria a edição de qualquer um deles.
  data_fim_prevista: dataCalendario().min(Joi.ref('data_inicio')).allow(null),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.loteIds = Joi.object().keys({
  lote_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1)
});

module.exports = models;
