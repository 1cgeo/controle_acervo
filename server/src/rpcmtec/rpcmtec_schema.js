'use strict'

const Joi = require('joi')

const models = {}

// Query do Anuário e do RTM: ano e mês de corte, sempre os dois.
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

// Dia de CALENDÁRIO: `.iso().raw()`. Sem o `.raw()` o Joi converte 'AAAA-MM-DD'
// em meia-noite UTC e a coluna guarda o dia anterior em UTC-3; sem o `.iso()` a
// string segue crua para o Postgres, e '01/08/2026' viraria 8 de janeiro pelo
// DateStyle MDY. É o padrão da casa, e vale para TODO dia deste schema.
const dia = Joi.date().iso().raw()

// Criação e atualização da edição mensal. A UNIQUE (ano, mes) vira 409 no ctrl.
//
// O ASSINANTE é o uuid do cadastro, e não um nome digitado: o bloco de
// assinatura do PDF sai de `dgeo.usuario`. É ANULÁVEL na criação porque quem vai
// assinar nem sempre se sabe no dia 1º, e o fechamento o cobra.

// O ANO TEM LIMITES, e eles são os mesmos que a tela já usa. A coluna é
// `SMALLINT` (`er/rpcmtec.sql`), então `{ ano: 40000 }` passava pelo Joi, chegava
// ao INSERT e voltava como 500 com o `22003 smallint out of range` cru: o
// `tratarErroEdicao` só traduz o 23505 da UNIQUE. Entrada de gente merece 400, e
// aqui a régua vale também para o CLI.
const ANO_MINIMO = 2000
const ANO_MAXIMO = 2100

const camposBase = {
  ano: Joi.number().integer().strict().min(ANO_MINIMO).max(ANO_MAXIMO).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  assinante_uuid: Joi.string().uuid().allow(null, ''),
  // `allow(null, '')`, como o vizinho de cima e como TODO campo `dia` deste
  // escopo. Aceitava só o nulo, e a string vazia levava 400: campo de data
  // LIMPO num formulário chega como '', e quem mandasse os dois campos limpos
  // recebia erro num e sucesso no outro, para a mesma ação.
  //
  // O '' não chega ao banco: `rpcmtec_edicao_ctrl` grava
  // `dados.data_assinatura || null` na criação e na atualização, então a coluna
  // DATE recebe NULL. O client web já mandava `|| null` e nunca caiu nisso; um
  // CLI ou uma chamada direta caía.
  data_assinatura: dia.allow(null, '')
}

models.criar = Joi.object().keys({ ...camposBase })

// O "eu sei o que estou fazendo" da TROCA DE PERÍODO, no molde do
// `ciente_revisao` do fechamento e do `confirmar_remocao` da importação da 5.1.
//
// Trocar o mês de uma edição ABERTA que já tem subseção digitada preenchida
// refaz as calculadas (elas saem do banco a cada montagem) e MANTÉM as digitadas
// como estão: o texto que descreve julho passa a sair sob o rótulo de agosto, e
// nada acusa. É o mesmo estrago que a rota de copiar o mês anterior produzia, e
// que foi podada em 2026-08-06 por essa razão. Sem esta chave a rota responde
// 409 dizendo quantas subseções estão preenchidas; com ela, troca.
//
// `default(false)` para o chamador antigo, que não a conhece, receber o aviso em
// vez de trocar calado. Ela NÃO existe na criação: não há período anterior.
models.atualizar = Joi.object().keys({
  ...camposBase,
  confirmar_troca_de_periodo: Joi.boolean().default(false)
})

// --- Subseção digitada ------------------------------------------------------

// O número é rótulo do documento ('2.1', '9.3'), e não inteiro. O padrão
// recusa o que a estrutura nunca teria, e o ctrl confere contra a estrutura de
// verdade: aqui só se barra o disparate.
models.subsecaoParams = Joi.object().keys({
  id: Joi.number().integer().required(),
  numero: Joi.string().pattern(/^\d{1,2}\.\d{1,2}$/).required()
})

// A CÉLULA CHEGA EM TEXTO, e as linhas são uma matriz. O número de colunas é
// conferido no ctrl contra os cabeçalhos da estrutura: aqui não se sabe de qual
// subseção se trata.
//
// `sem_ocorrencia` declara o vazio POR DECISÃO. Marcá-lo junto com conteúdo é
// contradição, e quem a recusa é o CHECK do banco.
models.gravarSubsecao = Joi.object().keys({
  linhas: Joi.array().items(
    Joi.array().items(Joi.string().allow('', null))
  ),
  texto: Joi.string().allow(null, ''),
  sem_ocorrencia: Joi.boolean().default(false)
})

// --- Importação do CSV do github_dashboard (subseção 5.1) -------------------

// O ARQUIVO CHEGA COMO TEXTO, e não como upload multipart. As duas entradas
// reais são o arquivo escolhido na tela e o texto COLADO por quem rodou o
// `dashboard_cli --formato csv` no terminal, e a segunda não tem arquivo nenhum
// para enviar. Um CSV de quarenta repositórios tem uns dois quilobytes.
//
// `allow('')` de propósito: o CSV vazio é um dos casos que o importador RECUSA
// com a frase que ensina o conserto ("baixe os Dados Consolidados..."), e um 400
// genérico do Joi diria só "não pode ser vazio".
//
// O TETO existe para o corpo não virar um caminho de despejar megabyte na rota:
// 200 mil caracteres são umas cinco mil linhas, muito além de qualquer mês.
models.importarRepositorios = Joi.object().keys({
  csv: Joi.string().allow('').max(200000).required(),
  // O "eu li a lista", como o `ciente_revisao` do fechamento. Sem ele a rota
  // responde 409 quando a importação apagaria um Resumo já escrito.
  // `default(false)` para quem não o conhece continuar recebendo o aviso.
  confirmar_remocao: Joi.boolean().default(false)
})

// O fechamento AVISA sobre a conferência que falta, e deixa fechar. Este campo
// é o "eu li a lista": sem ele a rota devolve 409 com o que falta, com ele
// fecha. `default(false)` para o chamador antigo, que não o conhece, continuar
// recebendo o aviso em vez de fechar calado.
models.fecharEdicao = Joi.object().keys({
  ciente_revisao: Joi.boolean().default(false)
})

// --- Conferência por subseção -----------------------------------------------

// UM campo, e ele é obrigatório. `revisado` sem valor não tem padrão razoável:
// assumir `true` marcaria por engano quem quis desmarcar, e assumir `false`
// desmarcaria quem quis marcar. Quem chama diz o que quer.
//
// A IMPRESSÃO DIGITAL NÃO ENTRA AQUI, de propósito. Ela é calculada no servidor
// sobre o bloco montado na hora: se o cliente a mandasse, poderia afirmar
// conferência de um conteúdo que ninguém viu.
models.revisarSubsecao = Joi.object().keys({
  revisado: Joi.boolean().required()
})

// NÃO HÁ SCHEMA DE CÓPIA DO MÊS PASSADO, desde 2026-08-06. Havia aqui um corpo
// com o `numero` opcional, que servia à rota de trazer o digitado da edição
// anterior. A rota saiu (ver rpcmtec_route.js): o RPCMTec é o relatório DAQUELE
// mês, e o documento assinado não pode afirmar sobre agosto o que houve em
// julho.

// --- Anexo (o RPCMTec assinado) ---------------------------------------------

models.anexoIdParams = Joi.object().keys({
  anexoId: Joi.number().integer().required()
})

// O corpo vem em multipart, então todo campo chega como string.
models.anexoUploadBody = Joi.object().keys({
  descricao: Joi.string().allow(null, '')
})

// --- Capacitação (2.6 ministrada / 6.2 recebida) ----------------------------

// SEM `tipo_id`, desde a 1.33.0: o tipo virou o CAMINHO
// (`/capacitacao/ministrada` e `/capacitacao/recebida`), e não um filtro que o
// cliente escolhe. A guarda da rota não enxerga a query nem o corpo, e a
// permissão da ministrada (Produção) é diferente da recebida (Efetivo).
models.capacitacaoQuery = Joi.object().keys({
  ano: Joi.number().integer()
})

const capacitacao = {
  // Os mesmos limites da edição, e pelo mesmo motivo: `rpcmtec.capacitacao.ano`
  // também é `SMALLINT`.
  ano: Joi.number().integer().strict().min(ANO_MINIMO).max(ANO_MAXIMO).required(),
  nome: Joi.string().max(255).required(),
  // `tipo_id` NÃO ESTÁ AQUI, e é regra, não esquecimento. Ele é fixado pela
  // ROTA, no servidor, e mandá-lo no corpo não muda nada: o `stripUnknown` do
  // schemaValidation o descarta. É o mesmo motivo do par
  // `/produto_versao_historica` e `/produto_versao_planejada` no módulo produto:
  // um nome por coisa evita o corpo que muda de significado por um inteiro
  // escondido. Acrescentá-lo de volta reabriria o caminho de escrever numa
  // subseção do relatório a que a pessoa não tem acesso.
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
  // QUEM da Divisão participou, por uuid do cadastro: texto livre não casa com
  // pessoa. Vale para os DOIS tipos, na ministrada são os instrutores e na
  // recebida os capacitados, e o papel vem do `tipo_id` em vez de ser um campo.
  //
  // `unique()` porque a tabela tem a UNIQUE (capacitacao, usuario): mandar o
  // mesmo duas vezes chegaria ao 409 do banco, e a lista vem de uma tela de
  // seleção onde repetir não faz sentido.
  //
  // SEM `.default([])`, pela mesma razão de `meta_pit_id` e `data_prevista` logo
  // abaixo: a chave AUSENTE preserva a lista gravada, e a lista VAZIA a apaga.
  // O default injetava `[]`, então "ausente" nunca chegava ao controlador e o
  // `gravarMilitares` fazia o DELETE de qualquer jeito. Quem corrigisse pelo CLI
  // o nome de uma capacitação, mandando o corpo sem `militares`, perdia os oito
  // instrutores dela -- com um evento de auditoria dizendo que a lista mudou. A
  // tela web sempre manda a lista, e por isso nunca caiu nisso.
  militares: Joi.array().items(Joi.string().uuid()).unique(),
  plano_codigo: Joi.string().max(255).allow(null, ''),
  documento: Joi.string().max(255).allow(null, ''),
  // Meta do PIT que esta capacitação cumpre. ANULÁVEL, e a maioria
  // fica nula: em 2026 o PIT só promete capacitação MINISTRADA (a meta 5), e as
  // Recebidas não têm meta que as prometa. Exigir uma inventaria compromisso.
  meta_pit_id: Joi.number().integer().strict().allow(null),
  // O mês em que esta capacitação PROMETE terminar, e de onde a grade do PIT
  // tira o PLANEJADO. Antes o planejado saía de `data_fim`, e concluir com
  // atraso movia o mês que a capacitação havia planejado.
  //
  // SEM `.default(...)`, e isso é regra e não descuido: o controlador distingue
  // "chave ausente" (preserva o gravado) de "null explícito" (apaga), e um
  // default injetaria a chave e mataria a preservação. É a mesma cobrança que
  // vale para `meta_pit_id`, e os dois formam o vínculo com o PIT.
  data_prevista: Joi.date().iso().raw().allow(null)
}

models.criarCapacitacao = Joi.object().keys({ ...capacitacao })
models.atualizarCapacitacao = Joi.object().keys({ ...capacitacao })

module.exports = models
