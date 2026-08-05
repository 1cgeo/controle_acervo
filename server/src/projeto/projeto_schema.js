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
// mudar nada, RECUA A DATA UM DIA a cada chamada.
//
// Com `.raw()`, a validacao continua sendo de data (o `.min` abaixo segue
// valendo), mas o valor que sai do Joi e a STRING original. O Postgres faz o
// cast de 'AAAA-MM-DD' para DATE sem fuso nenhum no caminho. E o padrao da casa
// para dia de calendario.
//
// O `.iso()` anda JUNTO do `.raw()`. Ele RECUSA formato ambiguo na entrada. Sem
// ele, '01/08/2026' passa, segue cru para o Postgres, e quem decide se aquilo e
// 1 de agosto ou 8 de janeiro e o DateStyle do banco (padrao MDY), nao o
// contrato da API. Mesmo par de `produto_schema.js`, `arquivo_schema.js`,
// `pit_schema.js` e `rpcmtec_schema.js`.
const dataCalendario = () => Joi.date().iso().raw();

// `acervo.projeto.nome`, `acervo.lote.nome` e `acervo.lote.pit` sao VARCHAR(255).
// Sem o teto aqui, string maior passava pelo Joi e estourava no banco: quem
// chamou recebia 500 (o codigo de "o servidor errou") em vez do 400 que diz qual
// campo esta grande demais. `descricao` fica de fora porque a coluna e TEXT.
const nome255 = () => Joi.string().max(255);

// O periodo de projeto e de lote, identico nos quatro modelos abaixo.
//
// `data_fim` espelha o CHECK data_fim >= data_inicio do banco.
//
// `data_fim_prevista` e quando o lote PROMETE terminar, e dali sai o mes do
// PLANEJADO da grade do PIT. E coluna separada de `data_fim` porque aquela e o
// que aconteceu e esta e o que se prometeu, e a primeira sobrescreveria a
// segunda no dia em que o lote fechasse. OPCIONAL, e nao `required`: os lotes
// que ja existem nasceram sem ela, e exigi-la recusaria a edicao de qualquer um.
const periodo = () => ({
  data_inicio: dataCalendario().required(),
  data_fim: dataCalendario().min(Joi.ref('data_inicio')).allow(null).required(),
  data_fim_prevista: dataCalendario().min(Joi.ref('data_inicio')).allow(null)
});

models.projeto = Joi.object().keys({
  nome: nome255().required(),
  descricao: Joi.string().allow('').required(),
  ...periodo(),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.projetoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: nome255().required(),
  descricao: Joi.string().allow('').required(),
  ...periodo(),
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
  pit: nome255().required(),
  nome: nome255().required(),
  descricao: Joi.string().allow('').optional(),
  ...periodo(),
  status_execucao_id: Joi.number().integer().strict().required()
});

models.loteAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  projeto_id: Joi.number().integer().strict().required(),
  pit: nome255().required(),
  nome: nome255().required(),
  descricao: Joi.string().allow('').optional(),
  ...periodo(),
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
