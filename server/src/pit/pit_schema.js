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
  prazo: dia.allow(null, ''),
  // Prevista, Em execução, Concluída ou Cancelada (2026-08-03). OPCIONAL, e o
  // nulo é uma afirmação: ninguém classificou. Entrou porque meta CANCELADA não
  // tinha onde ser dita: as 5.2 e 5.3 de 2026 só se distinguiam por terem
  // quantidade prevista zero, o que ninguém lê como cancelamento.
  //
  situacao_id: Joi.number().integer().strict().min(1).max(4).allow(null),
  // De onde vem o NÚMERO da meta: 1 Manual, 2 Capacitação, 3 Produção, 4
  // Impressão. Omitir vale 1, que é o que toda meta já é.
  //
  // Virar uma meta para automática é ato deliberado, e o portão dele é a rota
  // `/metas/execucao/ensaio`: ela mostra o digitado e o calculado lado a lado
  // ANTES da virada. Trocar isto sem olhar o ensaio muda o número que a 2.1 do
  // RPCMTec e o EXEC_PIT do RTM publicam, e ninguém percebe.
  origem_id: Joi.number().integer().strict().min(1).max(4)
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

models.gradeQuery = Joi.object().keys({
  ano: Joi.number().integer().required()
})

// O `mes` é OPCIONAL aqui, e a ausência dele muda a resposta: sem mês, o
// realizado é o ano inteiro (é o que a tela mostra); com mês, é o acumulado até
// ele mais o número daquele mês, que são as duas colunas da 2.1.
models.resumoQuery = Joi.object().keys({
  ano: Joi.number().integer().required(),
  mes: Joi.number().integer().min(1).max(12)
})

// O ensaio aceita a meta OPCIONAL: sem ela, o ano inteiro de uma vez, que é
// como se decide quais metas estão prontas para virar.
models.ensaioQuery = Joi.object().keys({
  ano: Joi.number().integer().required(),
  meta_id: Joi.number().integer()
})

models.metaIdParams = Joi.object().keys({
  metaId: Joi.number().integer().required()
})

// UMA CÉLULA da grade. Os quatro campos são OPCIONAIS, e a diferença entre
// omitir e mandar nulo é o contrato desta rota: omitir é NÃO MEXER, mandar nulo
// é APAGAR. É o que permite o modo "Executar" gravar o realizado sem carregar o
// plano junto, e o modo "Planejar" fazer o contrário, escrevendo os dois na
// mesma linha sem um limpar o outro.
//
// Zero é valor legítimo e diferente de nulo nos dois números: "conferi o mês e
// não houve" é uma resposta, e ela some da tela se for tratada como ausência.
models.salvarExecucao = Joi.object().keys({
  meta_id: Joi.number().integer().strict().required(),
  mes: Joi.number().integer().strict().min(1).max(12).required(),
  quantidade_planejada: Joi.number().integer().strict().min(0).allow(null),
  quantidade: Joi.number().integer().strict().min(0).allow(null),
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
  // De onde vem a prova da demanda (2026-08-03). Reusa `dominio.origem_meta` e
  // aceita só Manual (1) e Produção (3); o banco cobra o mesmo pelo CHECK
  // `demanda_extra_origem_manual_ou_producao`.
  //
  // SEM `.required()`: ausente vira Manual no controller, que é o default da
  // coluna. O cliente que ainda não conhece o campo continua funcionando.
  origem_id: Joi.number().integer().strict().valid(1, 3),
  // OBRIGATÓRIO, e é o que separa o Extra-PIT de trabalho fora do plano: o
  // modelo do relatório tem uma coluna para ele.
  documento_autorizacao: Joi.string().max(255).required(),
  descricao: Joi.string().allow(null, ''),
  data_entrega: dia.allow(null, '')
}

models.criarDemandaExtra = Joi.object().keys({ ...demandaExtra })

models.atualizarDemandaExtra = Joi.object().keys({ ...demandaExtra })

// --- De-para da mídia impressa para a meta (fonte da meta 4) ----------------

models.midiaQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// O `ano` vem no corpo e TAMBÉM está na meta, e a duplicata é deliberada: a
// restrição UNIQUE (ano, tipo_midia_id) do banco não enxerga coluna de outra
// tabela. O controlador confere que os dois casam antes de gravar.
const midiaMeta = {
  ano: Joi.number().integer().strict().required(),
  tipo_midia_id: Joi.number().integer().strict().required(),
  meta_pit_id: Joi.number().integer().strict().required()
}

models.criarMidiaMeta = Joi.object().keys({ ...midiaMeta })

models.atualizarMidiaMeta = Joi.object().keys({ ...midiaMeta })

module.exports = models
