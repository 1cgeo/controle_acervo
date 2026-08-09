'use strict'

const Joi = require('joi')

const models = {}

// O CORPO DO `PUT /api/instituicao`, e o unico contrato de escrita da feature.
//
// SAO TRES CAMPOS, e nao ha `id`: a linha e UNICA, garantida pelo CHECK
// `(id = 1)` do DDL, e a rota nao recebe identificador nenhum. Aceitar `id` no
// corpo daria a impressao de que existe uma segunda linha para escolher.
//
// NAO HA SCHEMA DE CRIACAO NEM DE EXCLUSAO, e a ausencia e a regra: a linha
// nasce com o banco (semeada por `er/dgeo.sql` na instalacao nova, e pela
// migracao `2026-08-09_a_instituicao.sql` no banco existente) e so se ALTERA.
// Um `POST` teria de recusar a segunda chamada por CHECK, e um `DELETE` deixaria
// o sistema sem saber de quem ele e.
models.atualizar = Joi.object().keys({
  // O NOME POR EXTENSO, e ele nao e so rotulo: e por ele que a subsecao 2.7 do
  // RPCMTec acha a area de suprimento, comparando com
  // `limites.area_suprimento.cgeo`. Um acento a menos ou um 'o' no lugar do 'º'
  // faz o filtro nao casar, e por isso a string entra como a pessoa a digitou.
  //
  // `.trim()` porque espaco sobrando no fim e invisivel na tela e fatal na
  // comparacao: '1º Centro de Geoinformação ' nao e igual a
  // '1º Centro de Geoinformação'.
  nome: Joi.string().trim().max(255).required(),
  // A SIGLA, como ela aparece em cabecalho e em nome de arquivo.
  sigla: Joi.string().trim().max(50).required(),
  // A UG desta OM. `null` e um valor de primeira classe: a instalacao que nao
  // usa o modulo orcamento nao tem UG, e obriga-la a inventar um numero seria
  // pior do que a ausencia.
  //
  // TEXTO, e nao numero, porque `dominio.ug.code` e VARCHAR(10): o codigo e uma
  // sequencia de digitos e nao uma quantidade, e um zero a esquerda que virasse
  // inteiro se perderia. Quem confere se o codigo existe e a chave estrangeira,
  // e o controlador traduz o 23503 dela para um 400 que diz o que fazer.
  ug_code: Joi.string().trim().max(10).allow(null, '').default(null)
})

module.exports = models
