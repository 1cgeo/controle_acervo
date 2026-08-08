'use strict'

const Joi = require('joi')

const models = {}

models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// Campos que o client web reenvia por vir do GET, e que o servidor ignora.
// O dialog de DFD (orcamento_client, dfd-dialog.js) carrega os itens de
// GET /dfd/:id e devolve cada item INTEIRO no PUT, incluindo a PK, a FK, o
// nome do tipo (que vem de JOIN) e as quatro colunas de auditoria. Recusar
// essas chaves deixaria a edição de qualquer DFD que já tenha item impossível,
// então elas são declaradas e descartadas com `.strip()`. É uma tolerância
// NOMEADA, não porta aberta: qualquer outra chave desconhecida no item ainda
// vira 400, então um `descrciao` errado continua sendo pego. O descarte é
// registrado no log pelo schemaValidation. Some daqui quando o client parar de
// reenviar o item inteiro.
const camposEcoDoClient = {
  id: Joi.any().strip(),
  dfd_id: Joi.any().strip(),
  tipo_item: Joi.any().strip(),
  data_cadastramento: Joi.any().strip(),
  usuario_cadastramento_uuid: Joi.any().strip(),
  // `valor_total` entrou nesta lista na 1.43.0, e por MERECIMENTO: ele deixou de
  // ser coluna e passou a ser DERIVADO (`quantidade * valor_unitario`, igual em
  // 31 de 31 linhas de producao), mas continua saindo no GET com o mesmo nome,
  // porque a tela e o CLI o exibem. Como o dialogo devolve o item inteiro no
  // PUT, ele volta -- e recusa-lo tornaria a edicao de qualquer DFD com item
  // impossivel. Chega, e o servidor o ignora: quem manda no total e a
  // multiplicacao.
  valor_total: Joi.any().strip(),
  // As duas ainda sao descartadas por TOLERANCIA, e nao porque existam: elas
  // sairam de `orcamento.dfd_item` na 1.43.0 e o GET nao as devolve mais. O
  // dialogo antigo, que carregou os itens antes da atualizacao, continua
  // reenviando-as, e um 400 aqui deixaria a tela travada ate o F5.
  data_modificacao: Joi.any().strip(),
  usuario_modificacao_uuid: Joi.any().strip()
}

const item = Joi.object().keys({
  tipo_item_id: Joi.number().integer().strict().required(),
  cod_catmat_catser: Joi.string().max(30).allow(null, ''),
  descricao: Joi.string().required(),
  // min(0), como o valor de toda outra feature do modulo: item de demanda nao
  // tem quantidade nem preco negativo, e as colunas do DDL nao tem CHECK que
  // barre. Sem o piso, o sinal trocado entra calado e ainda derruba o
  // `valor_estimado` do DFD, que e a soma destes totais.
  //
  // `.strict()` fecha o par, e pela mesma razao: e o que licitacao, RPNP,
  // liquidacao e nota_credito ja cobram no mesmo modulo. Sem ele o Joi converte
  // "12" em 12, e o texto que NAO for numero puro vira NaN ou numero errado sem
  // nada acusar. Os dois consumidores reais mandam NUMERO: o formulario usa
  // `createNumberField`, cujo `getValue()` devolve Number ou null
  // (client/src/js/components/form-fields/form-fields.js), e o orcamento_cli
  // valida contra ESTE mesmo schema antes de enviar.
  quantidade: Joi.number().min(0).strict().allow(null),
  valor_unitario: Joi.number().min(0).strict().allow(null),
  // NAO HA `valor_total` GRAVAVEL aqui, e a ausencia e a modelagem: ele e o
  // produto dos dois campos acima. Ele aparece na lista de eco logo abaixo, que
  // e outra coisa -- ali ele e DESCARTADO, e nao aceito.
  ...camposEcoDoClient
})

// OS CAMPOS QUE SAIRAM NA 1.43.0, e por que NENHUM deles entra aqui com
// `.strip()`:
//
//   `justificativa`, `data_prevista_conclusao`, `responsavel_cpf` -- 0 de 8 em
//   producao, nunca preenchidas, e nenhum DFD jamais editado;
//   `grau_prioridade_id` -- 1 de 8, um unico codigo, e levou
//   `dominio.grau_prioridade` inteira junto;
//   `vinculo_plano_gestao` -- 8 de 8 com UM valor distinto ('Plano de Gestão do
//   1º CGEO'), uma constante digitada oito vezes;
//   `valor_estimado` -- DERIVADO da soma dos itens, igual em 8 de 8.
//
// Nenhum entra porque o modulo orcamento usa o validador ESTRITO
// (`orcamento/utils.js`): quem continuar mandando qualquer um deles recebe 400
// dizendo o nome, em vez de 200 e a impressao de ter gravado. E a MESMA escolha
// que `nota_credito.valor_recolhido` recebeu na 1.40.0, pelo mesmo motivo.
// A excecao e o `valor_total` do ITEM, que o dialogo devolve por ECO do GET e
// nao por digitacao -- esse esta declarado com `.strip()` acima.
const camposDoDfd = {
  numero: Joi.string().max(20).required(),
  ano: Joi.number().integer().strict().required(),
  rotulo: Joi.string().max(120).allow(null, ''),
  objeto: Joi.string().allow(null, ''),
  // FICA, e e a unica das constantes do DFD que ficou: no dia em que outra secao
  // do CGEO pedir um DFD, e ele que distingue de quem e a demanda.
  area_requisitante: Joi.string().max(255).allow(null, ''),
  consta_pca: Joi.boolean().strict().default(true),
  itens: Joi.array().items(item).default([])
}

models.criar = Joi.object().keys(camposDoDfd)

models.atualizar = Joi.object().keys(camposDoDfd)

module.exports = models
