'use strict'

const Joi = require('joi')

const models = {}

// Dia de CALENDÁRIO, e por isso `.iso().raw()`. Sem o `.raw()` o Joi converte
// 'AAAA-MM-DD' em meia-noite UTC e a coluna guarda o dia anterior em UTC-3; sem
// o `.iso()` a string segue crua para o Postgres, e '01/08/2026' vira 8 de
// janeiro, porque o DateStyle padrão é MDY. É o padrão da casa, e vale para
// `prazo`, `data_conclusao` e `data_entrega`.
const dia = Joi.date().iso().raw()

models.idParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// DE QUE REVISÃO A TELA ESTÁ APAGANDO A META.
//
// OPCIONAL, porque a regra tem duas metades e o servidor cobra a primeira
// sozinho: a meta com mais de uma declaração não se apaga de lugar nenhum. A
// segunda metade ("você está noutra revisão, aí só cabe cancelar") precisa saber
// de onde veio o pedido, e é isso que este parâmetro diz. O CLI não o manda, e
// continua barrado pela primeira metade.
models.excluirMetaQuery = Joi.object().keys({
  revisao_id: Joi.number().integer()
})

models.listarQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// O que a DSG DECLARA sobre o item, e que vai para a linha da revisão. Os
// quatro últimos são OPCIONAIS, e omitir vale nulo: a linha de cabeçalho da meta
// não promete quantidade nenhuma, porque quem promete são os itens que ela
// agrupa.
//
// `descricao` é a frase da DSG, e ela JÁ contém o demandante e a quantidade
// ("Carta Topográfica 1:25.000. COTER, 24"): por isso os três andam juntos.
const declaracao = {
  // OBRIGATÓRIA: ela é a frase que a revisão declara, e a coluna de
  // `pit.meta_revisao` é NOT NULL.
  descricao: Joi.string().required(),
  quantidade_prevista: Joi.number().integer().strict().min(0).allow(null),
  demandante: Joi.string().max(255).allow(null, ''),
  prazo: dia.allow(null, ''),
  // O ÚNICO ato de situação que é da DSG. Não há `situacao_id` digitado: 'Em
  // execução' e 'Concluída' a grade calcula do que foi lançado, e status
  // digitado ao lado de status calculado é uma segunda verdade.
  cancelada: Joi.boolean()
}

// O que o SCA decide sobre a meta, e que revisão nenhuma menciona. Por isso muda
// sem revisão, na tela de metas.
const classificacao = {
  // O QUE A META CONTA: 1 Folha, 2 Marco, 3 Capacitação, 4 Item de acervo, 5
  // Atividade. Classificação NOSSA, não da DSG.
  //
  // A coerência com a origem é cobrada no controller: Produção e Impressão
  // exigem Folha, e Capacitação exige Capacitação.
  unidade_id: Joi.number().integer().strict().min(1).max(5).allow(null),
  // De onde vem o NÚMERO da meta: 1 Manual, 2 Capacitação, 3 Produção, 4
  // Impressão. Omitir é NÃO MEXER, e o controller guarda o valor que já estava.
  //
  // Virar uma meta para automática é ato deliberado, e o portão dele é a rota
  // `/metas/execucao/ensaio`: ela mostra o digitado e o calculado lado a lado
  // ANTES da virada. Trocar isto sem olhar o ensaio muda o número que a 2.1 do
  // RPCMTec e o EXEC_PIT do RTM publicam, e ninguém percebe.
  origem_id: Joi.number().integer().strict().min(1).max(4)
}

// O CAMPO QUE SÓ ENTRA PELA REVISÃO, e a mensagem que diz por onde ir.
//
// `forbidden()` em vez de silêncio: o campo descartado sem aviso é meia meta
// gravada, e quem mandou acha que gravou. Aqui o 400 ENSINA o modelo, que é o
// que a interface sozinha não conseguia fazer.
const soNaRevisao = campo => Joi.any().forbidden().messages({
  'any.unknown':
    `"${campo}" é o que o PIT PROMETE, e isso só muda dentro de uma revisão da ` +
    'DSG. Abra a revisão do ano na tela de Revisões do PIT e altere a meta por ' +
    'lá. Para consertar um erro de cópia do documento assinado, use a correção ' +
    'de transcrição.'
})

// A REVISÃO EM QUE O ATO CAI, e o MOTIVO quando essa revisão já foi publicada.
//
// `revisao_id` OPCIONAL: omitir cai no rascunho do ano, que é o caminho do CLI e
// da carga. A tela sempre manda, porque ela sabe qual revisão está aberta nela,
// e o servidor não deve adivinhar.
//
// `motivo` OPCIONAL AQUI, e obrigatório no controller quando a revisão está
// publicada. O Joi não enxerga o estado da revisão: quem sabe se o ato é
// correção de transcrição ou alteração de rascunho é quem lê `data_vigencia`.
const ondeCai = {
  revisao_id: Joi.number().integer().strict(),
  motivo: Joi.string().min(5)
}

models.criar = Joi.object().keys({
  ano: Joi.number().integer().strict().required(),
  numero_meta: Joi.number().integer().strict().required(),
  item: Joi.string().max(20).allow(null, ''),
  // ACRESCENTAR META É ATO DA DSG, como alterar e cancelar: o controller exige
  // uma revisão e a declaração cai dentro dela.
  ...declaracao,
  ...classificacao,
  ...ondeCai
})

// SÓ A IDENTIDADE. A declaração saiu daqui: ela era a segunda porta para mudar o
// que a DSG promete, ao lado da revisão, e nenhuma tela conseguia explicar duas
// portas para o mesmo ato.
models.atualizar = Joi.object().keys({
  ano: Joi.number().integer().strict().required(),
  numero_meta: Joi.number().integer().strict().required(),
  item: Joi.string().max(20).allow(null, ''),
  ...classificacao,
  descricao: soNaRevisao('descricao'),
  quantidade_prevista: soNaRevisao('quantidade_prevista'),
  demandante: soNaRevisao('demandante'),
  prazo: soNaRevisao('prazo'),
  cancelada: soNaRevisao('cancelada')
})

// A META COMO ESTA REVISÃO A DECLARA. Os dois ids vêm no caminho
// (`declaracaoParams`), então o corpo é a declaração mais o que a tela edita no
// mesmo formulário.
//
// A CLASSIFICAÇÃO ENTRA AQUI, e é OPCIONAL. Ela continua sendo nossa, e revisão
// nenhuma a menciona; o que mudou foi a tela, que deixou de ter um botão
// "Corrigir cadastro" ao lado do de alterar a meta. Ninguém distinguia os dois,
// e a decisão do chefe é que tudo se faça dentro da revisão. `numero_meta`
// presente é o sinal de que o bloco da identidade veio junto; omitir os quatro
// é "não mexer", que é o que o CLI e a carga fazem.
//
// `motivo` é cobrado pelo controller quando a revisão já foi publicada: aí a
// edição conserta a TRANSCRIÇÃO do texto assinado, e o motivo diz em que a cópia
// divergia.
models.declararNaRevisao = Joi.object().keys({
  ...declaracao,
  numero_meta: Joi.number().integer().strict(),
  item: Joi.string().max(20).allow(null, ''),
  ...classificacao,
  motivo: Joi.string().min(5)
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
  // De onde vem a prova da demanda. Reusa `dominio.origem_meta` e aceita só
  // Manual (1) e Produção (3); o banco cobra o mesmo pelo CHECK
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

// --- Versões do acervo que materializam a demanda ---------------------------
//
// O vínculo mora em `acervo.versao.demanda_extra_id` e é exclusivo com
// `meta_pit_id` (CHECK `versao_plano_ou_excecao`). Aqui só entra o id da versão:
// o corpo NÃO repete o id da demanda, que já vem no caminho, e duas fontes para
// a mesma chave abririam a chance de discordarem.

models.versaoDemandaExtraParams = Joi.object().keys({
  id: Joi.number().integer().required(),
  versao_id: Joi.number().integer().required()
})

models.associarVersaoDemandaExtra = Joi.object().keys({
  versao_id: Joi.number().integer().strict().required()
})

// O termo da busca de candidatas. Vazio devolve as primeiras do acervo, dentro
// do teto do controller.
models.candidatasQuery = Joi.object().keys({
  termo: Joi.string().max(255).allow('')
})

// --- Exercício e revisão do PIT ---------------------------------------------

models.anoParams = Joi.object().keys({
  ano: Joi.number().integer().min(2000).max(2100).required()
})

models.criarExercicio = Joi.object().keys({
  ano: Joi.number().integer().strict().min(2000).max(2100).required(),
  // 1 Em elaboração, 2 Vigente, 3 Encerrado. Omitir vale Vigente.
  situacao_id: Joi.number().integer().strict().min(1).max(3),
  observacao: Joi.string().allow(null, '')
})

models.atualizarExercicio = Joi.object().keys({
  situacao_id: Joi.number().integer().strict().min(1).max(3).required(),
  observacao: Joi.string().allow(null, '')
})

models.revisaoQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

// A revisão NASCE RASCUNHO: `data_vigencia` não entra aqui de propósito. Ela é
// preenchida na publicação, depois de o gerente conferir as alterações contra o
// documento. Aceitar a data no cadastro faria a grade mudar antes da conferência.
const revisao = {
  codigo: Joi.string().max(20).required(),
  // A data do fecho do documento, que NÃO é a da assinatura digital: o R1 de
  // 2026 traz "Brasília-DF, 11 de maio de 2026" e o Diretor assinou em 14/05.
  data_documento: dia.allow(null, ''),
  data_assinatura: dia.allow(null, ''),
  assinante: Joi.string().max(255).allow(null, ''),
  observacao: Joi.string().allow(null, '')
}

models.criarRevisao = Joi.object().keys({
  ano: Joi.number().integer().strict().required(),
  ...revisao
})

models.atualizarRevisao = Joi.object().keys({ ...revisao })

// PUBLICAR. A data pode ser RETROATIVA, e às vezes tem de ser: o R1 de 2026 foi
// assinado em 14/05 e o documento é de 11/05. Quem escolhe é quem publica.
models.publicarRevisao = Joi.object().keys({
  data_vigencia: dia.required()
})

// CORRIGIR TRANSCRIÇÃO, e não alterar o PIT. O motivo é OBRIGATÓRIO: é ele que
// separa "digitei errado" de "a DSG mudou", que é a distinção inteira.
models.corrigirTranscricao = Joi.object().keys({
  descricao: Joi.string().required(),
  quantidade_prevista: Joi.number().integer().strict().min(0).allow(null),
  demandante: Joi.string().max(255).allow(null, ''),
  prazo: dia.allow(null, ''),
  cancelada: Joi.boolean(),
  motivo: Joi.string().min(5).required()
})

models.revisaoIdParams = Joi.object().keys({
  revisaoId: Joi.number().integer().required()
})

// A declaracao de UMA meta dentro de UMA revisao. Os dois ids na rota, porque a
// linha e a interseccao dos dois: `pit.meta_revisao` nao tem id que alguem
// conheca de fora.
models.declaracaoParams = Joi.object().keys({
  revisaoId: Joi.number().integer().required(),
  metaId: Joi.number().integer().required()
})

models.anexoIdParams = Joi.object().keys({
  anexoId: Joi.number().integer().required()
})

// Vem em multipart, então tudo chega como TEXTO: `tipo_anexo_id` sem
// `.strict()`, ao contrário do resto do arquivo.
models.anexoUploadBody = Joi.object().keys({
  tipo_anexo_id: Joi.number().integer().min(1).max(4),
  descricao: Joi.string().allow(null, '')
})

module.exports = models
