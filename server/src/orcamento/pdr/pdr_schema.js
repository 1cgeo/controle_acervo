'use strict'

const Joi = require('joi')

const models = {}

models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// Um item do PDR (o PDR e o conjunto dos itens do ano; nao ha cabeçalho).
const campos = {
  ano: Joi.number().integer().strict().required(),
  cod_nd: Joi.string().max(6).required(),
  meta_pit_id: Joi.number().integer().strict().allow(null),
  item_label: Joi.string().max(10).allow(null, ''),
  descricao: Joi.string().allow(null, ''),
  // NAO HA `gnd` AQUI, e a ausencia e a modelagem. Ate a 1.42.0 ele era uma
  // coluna do item, e valia SEMPRE o `gnd` da natureza de despesa apontada por
  // `cod_nd`: medido em 2026-08-08, os 36 itens de producao concordavam nos 36.
  // Duas colunas afirmando a mesma coisa so tinham como discordar, e o proprio
  // formulario ja exibia o campo DESABILITADO, derivando-o da ND. Desde a 1.43.0
  // o GND e lido por JOIN e continua SAINDO na leitura com o mesmo nome de
  // campo, porque a tela, o CLI e o cartao-resumo do PDR o exibem.
  //
  // O campo nao entra aqui nem com `.strip()`: o modulo usa o validador ESTRITO,
  // entao quem continuar mandando `gnd` recebe 400 dizendo o nome, em vez de 200
  // e a impressao de ter escolhido um GND. E a mesma escolha de
  // `nota_credito.valor_recolhido` na 1.40.0.
  // min(0), como o valor de toda outra feature do modulo (licitacao, RPNP,
  // liquidacao): credito planejado nao e negativo, e as colunas nao tem CHECK
  // que barre. Sem o piso, um sinal trocado entrava calado e o painel somava
  // menos "previsto" do que o PDR autoriza. Nao e `positive()`: item zerado
  // existe (solicitado sem autorizacao nenhuma).
  //
  // `.strict()` fecha o par, e pela mesma razao do `min(0)`: e o que licitacao,
  // RPNP, liquidacao e nota_credito ja cobram no mesmo modulo. Sem ele o Joi
  // converte "11400" em 11400, e "1.400,00" vira NaN ou um numero errado sem
  // nada acusar. Os dois consumidores reais mandam NUMERO: o formulario usa
  // `createNumberField`, cujo `getValue()` devolve Number ou null
  // (client/src/js/components/form-fields/form-fields.js), e o orcamento_cli
  // valida contra ESTE mesmo schema antes de enviar.
  valor_solicitado: Joi.number().min(0).strict().allow(null),
  valor_autorizado: Joi.number().min(0).strict().allow(null),
  observacao: Joi.string().allow(null, '')
}

models.criar = Joi.object().keys(campos)
models.atualizar = Joi.object().keys(campos)

module.exports = models
