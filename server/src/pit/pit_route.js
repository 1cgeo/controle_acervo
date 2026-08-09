'use strict'

const express = require('express')

const { asyncHandler, httpCode, AppError } = require('../utils')

// Validacao ESTRITA, e nao a padrao da plataforma: chave desconhecida no corpo
// vira 400 com sugestao, em vez de sumir no stripUnknown. E o contrato que esta
// rota ja tinha quando morava no modulo orcamento, e a escrita aqui vem de CLI e
// de carga, onde um nome de campo errado descartado em silencio grava meia meta.
const schemaValidation = require('../utils/schema_validation_estrito')

// SEM `verifyGerente` desde 2026-08-08: a grade da execução era a última rota do
// sistema a usá-lo, e ela passou a cobrar consulta no módulo PIT. O
// middleware continua em `login/`, sem chamador.
const { verifyAcesso, verifyAdmin, verifyPerfil } = require('../login')

const pitCtrl = require('./pit_ctrl')
const execucaoCtrl = require('./pit_execucao_ctrl')
const extraCtrl = require('./pit_extra_ctrl')
const revisaoCtrl = require('./pit_revisao_ctrl')

const uploadAnexoRevisao = require('./anexo_revisao_upload')

const pitSchema = require('./pit_schema')

const router = express.Router()

// Metas do PIT: rota de PLATAFORMA, sem prefixo de modulo, como /usuarios.
//
// LER e de quem TEM ACESSO AO SISTEMA (`verifyAcesso`): perfil em qualquer
// modulo, sem exigir um modulo especifico. Todo modulo precisa oferecer a lista:
// o orcamento amarra a NC e o item do PDR a meta que financiam, e a mapoteca
// amarra o pedido de impressao a meta que ele cumpre.
//
// Era `verifyLogin`, e a diferenca e a conta recem-criada, ainda SEM concessao
// nenhuma: ela esta logada e nao esta no sistema. O plano de trabalho da Divisao
// nao e o que ela ve enquanto espera o acesso.
//
// ESCREVER e do administrador global (`verifyAdmin`): o PIT muda uma vez por
// ano, vem de documento assinado, e errar nele contamina os tres modulos.

router.get(
  '/',
  verifyAcesso,
  schemaValidation({ query: pitSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.listar(req.query.ano)

    return res.sendJsonAndLog(true, 'Metas do PIT retornadas com sucesso', httpCode.OK, dados)
  })
)

// Antes de '/:id', senao 'anos' cai na rota do id e reprova na validacao.
router.get(
  '/anos',
  verifyAcesso,
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.anos()

    return res.sendJsonAndLog(true, 'Anos com meta cadastrada retornados com sucesso', httpCode.OK, dados)
  })
)

// ---------------------------------------------------------------------------
// Execução mensal das metas (subseção 2.1 do RPCMTec)
//
// ANTES de '/:id', como '/anos': o Express casa na ordem de declaração, e
// 'execucao' cairia na rota do id e reprovaria na validação de parâmetro.
//
// LER é da CONSULTA NO PIT desde 2026-08-08, e era `verifyGerente`
// (gerente de QUALQUER módulo, ou o administrador global). Duas coisas estavam
// erradas no desenho antigo, e a régua nova conserta as duas:
//
//   O NÍVEL. Exigir gerente para OLHAR a grade era dizer que quem lança a
//   execução não pode conferir o resultado do que lançou, porque lançar é do
//   operador. A régua nova é a mesma dos três módulos: consulta LÊ, operador
//   lança, gerente responde pela área.
//
//   O MÓDULO. O `verifyGerente` aceitava o gerente de QUALQUER módulo, inclusive
//   quem nunca tocou no plano, e ao mesmo tempo recusava o operador do PIT. O
//   compartimento certo para a grade do PIT é o módulo PIT (o code 4, que se
//   chamou `producao` até 2026-08-09), que é o módulo que a escreve.
//
// ESCREVER é do OPERADOR DO PIT desde a 1.33.0, e era do administrador
// global. Lançar quanto uma meta entregou em março é o trabalho de quem toca a
// produção, e exigir para isso a mesma flag que libera o orçamento e o cadastro
// de usuários é o que fez 5 das 7 contas que trabalham no sistema virarem
// administradoras (medido em 2026-08-06).
//
// A ESCRITA DA META continua `verifyAdmin`, mais abaixo neste arquivo, e a
// distinção é o ponto: a meta é o que a DSG PROMETEU, e o que está no sistema é
// transcrição de documento assinado. A execução é o que a Divisão ENTREGOU.
// ---------------------------------------------------------------------------

// A GRADE do ano: uma linha por meta, com os doze meses e os dois números de
// cada um. O mês é COLUNA, e não filtro: o trabalho é anual, e "estou
// atrasado?" não se responde um mês por vez.
router.get(
  '/execucao',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ query: pitSchema.gradeQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await execucaoCtrl.grade(req.query.ano)

    return res.sendJsonAndLog(
      true, 'Grade do PIT retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/execucao/resumo',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ query: pitSchema.resumoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await execucaoCtrl.resumoDoAno(req.query.ano, req.query.mes)

    return res.sendJsonAndLog(
      true, 'Resumo da execução do PIT retornado com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/execucao/meta/:metaId',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ params: pitSchema.metaIdParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await execucaoCtrl.listarDaMeta(req.params.metaId)

    return res.sendJsonAndLog(
      true, 'Lançamentos da meta retornados com sucesso', httpCode.OK, dados
    )
  })
)

// O DIAGNÓSTICO do cadastro: o que cada meta automática promete contra o que
// existe cadastrado para cumpri-la. É o que alimenta o aviso da tela de metas.
//
// Numa meta automática, esquecer de cadastrar a versão, a capacitação ou o
// pedido não dá erro: dá ZERO na grade, indistinguível de "o mês não chegou".
// Esta rota é quem torna esse silêncio visível.
//
// MESMA GUARDA da grade, e pelo mesmo motivo do ensaio: ela devolve o planejado
// meta a meta, que é o dado de `/execucao`.
router.get(
  '/execucao/diagnostico',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ query: pitSchema.gradeQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await execucaoCtrl.diagnostico(req.query.ano)

    return res.sendJsonAndLog(
      true, 'Diagnóstico do cadastro do PIT retornado com sucesso', httpCode.OK, dados
    )
  })
)

// UMA rota para criar, alterar e APAGAR, porque o par (meta, mês) é uma CÉLULA
// de grade: quem preenche não sabe (nem deveria saber) se aquele mês já tinha
// linha. Quem separa criação de alteração é o controlador, e só para o rastro; e
// quando a célula fica sem nenhum dos quatro campos, ele apaga a linha em vez de
// guardar uma que não diz nada.
router.post(
  '/execucao',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ body: pitSchema.salvarExecucao }),
  asyncHandler(async (req, res, next) => {
    const dados = await execucaoCtrl.salvar(req.body, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(
      true, 'Execução lançada com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/execucao/:id',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await execucaoCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Lançamento excluído com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// Demanda Extra-PIT (subseção 3.3 do RPCMTec)
//
// LER é de quem tem acesso ao sistema (`verifyAcesso`, perfil em qualquer
// módulo). ESCREVER é do OPERADOR DO PIT desde a
// 1.33.0, e era do administrador global: o Extra-PIT é a exceção AUTORIZADA ao
// plano, e quem a cadastra é quem toca a produção.
//
// AS ROTAS DE VERSÃO, mais abaixo, acompanham desde 2026-08-06. Elas ligam a
// folha do acervo à demanda, e sem elas o operador entregava meia tarefa: uma
// demanda Extra-PIT sem folha ligada não conta nada na grade. Ver o comentário
// delas.
// ---------------------------------------------------------------------------

router.get(
  '/extra',
  verifyAcesso,
  schemaValidation({ query: pitSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await extraCtrl.listar(req.query.ano)

    return res.sendJsonAndLog(
      true, 'Demandas Extra-PIT retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// Antes de '/extra/:id', pela mesma razão de '/anos'.
router.get(
  '/extra/anos',
  verifyAcesso,
  asyncHandler(async (req, res, next) => {
    const dados = await extraCtrl.anos()

    return res.sendJsonAndLog(
      true, 'Anos com demanda Extra-PIT retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/extra/:id',
  verifyAcesso,
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await extraCtrl.getPorId(req.params.id)

    if (!dados) {
      throw new AppError('Demanda Extra-PIT não encontrada', httpCode.NotFound)
    }

    return res.sendJsonAndLog(
      true, 'Demanda Extra-PIT retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/extra',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ body: pitSchema.criarDemandaExtra }),
  asyncHandler(async (req, res, next) => {
    const dados = await extraCtrl.criar(req.body, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(
      true, 'Demanda Extra-PIT criada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/extra/:id',
  verifyPerfil('operador', 'pit'),
  schemaValidation({
    params: pitSchema.idParams,
    body: pitSchema.atualizarDemandaExtra
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await extraCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Demanda Extra-PIT atualizada com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/extra/:id',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await extraCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(
      true, 'Demanda Extra-PIT excluída com sucesso', httpCode.OK
    )
  })
)

// --- As versões do acervo que materializam a demanda ------------------------
//
// O Extra-PIT é PRODUÇÃO, e a demanda só fecha quando a versão existe. O vínculo
// mora em `acervo.versao.demanda_extra_id`, exclusivo com `meta_pit_id` pelo
// CHECK `versao_plano_ou_excecao`.
//
// POR QUE AQUI, e não no módulo produto. `PUT /produtos/versao` já grava a
// coluna, mas exige o corpo INTEIRO da versão (nome, tipo, lote, datas, todos
// `.required()`): ligar uma folha por lá obriga a ler a versão, devolver tudo de
// volta e torcer para nada se perder no caminho. Estas rotas mexem em UM campo.
//
// LER é de quem tem acesso ao sistema (`verifyAcesso`), como o resto da 3.3.
// ESCREVER é do operador do PIT, igual às outras escritas da demanda Extra-PIT.
//
// A 1.33.0 deixou estas duas com o administrador global, pelo argumento de que
// elas gravam `acervo.versao.demanda_extra_id` e quem manda no acervo é o módulo
// acervo. O argumento cai diante do que ele produzia: o operador do PIT
// cadastrava a demanda e parava ali, sem poder dizer QUAIS folhas a cumprem. Uma
// demanda Extra-PIT sem folha ligada não conta nada na grade do PIT, então a
// permissão entregava metade de uma tarefa.
//
// A fronteira que importa não é a tabela, é o CAMPO. Estas rotas mexem em UM
// campo de UMA linha que já existe, e não criam, apagam nem movem produto,
// versão ou arquivo. Nada do que o perfil de acervo protege passa por aqui.

// Antes de '/extra/:id/versoes/:versao_id', pela mesma razão de '/anos'.
router.get(
  '/extra/:id/versoes/candidatas',
  verifyAcesso,
  schemaValidation({
    params: pitSchema.idParams,
    query: pitSchema.candidatasQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await extraCtrl.listarVersoesCandidatas(
      req.params.id, req.query.termo
    )

    return res.sendJsonAndLog(
      true, 'Versões candidatas retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/extra/:id/versoes',
  verifyAcesso,
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await extraCtrl.listarVersoes(req.params.id)

    return res.sendJsonAndLog(
      true, 'Versões da demanda Extra-PIT retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/extra/:id/versoes',
  verifyPerfil('operador', 'pit'),
  schemaValidation({
    params: pitSchema.idParams,
    body: pitSchema.associarVersaoDemandaExtra
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await extraCtrl.associarVersao(
      req.params.id, req.body.versao_id, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Versão ligada à demanda Extra-PIT com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/extra/:id/versoes/:versao_id',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ params: pitSchema.versaoDemandaExtraParams }),
  asyncHandler(async (req, res, next) => {
    await extraCtrl.desassociarVersao(
      req.params.id, req.params.versao_id, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Versão desligada da demanda Extra-PIT com sucesso', httpCode.OK
    )
  })
)

// O ENSAIO: o digitado e o calculado lado a lado, sem escrever nada. É o portão
// para virar uma meta de Manual para automática, e responde inclusive na meta
// que ainda está Manual, que é justamente a que interessa olhar.
//
// MESMA GUARDA DA GRADE, e ela acompanhou a mudança de 2026-08-08. O ensaio
// devolve o planejado e o realizado meta a meta, ou seja, o MESMO dado de
// `/execucao`: guarda diferente aqui é o caminho de volta para quem a grade
// barra.
//
// ELA NÃO ESTAVA NA LISTA de rotas a mudar, e mudou assim mesmo, porque deixar o
// `verifyGerente` aqui não seria "mais rígido": ele aceita o gerente de QUALQUER
// módulo, inclusive quem não tem uma linha no PIT. Com a grade cobrando
// consulta no PIT, o gerente da mapoteca perderia `/execucao` e continuaria
// lendo o mesmo dado por este endereço. A régua nova é por COMPARTIMENTO, e não
// só por nível, e um endereço fora dela reabre o compartimento.
router.get(
  '/execucao/ensaio',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ query: pitSchema.ensaioQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await execucaoCtrl.ensaio(req.query.ano, req.query.meta_id)

    return res.sendJsonAndLog(true, 'Ensaio da grade retornado com sucesso', httpCode.OK, dados)
  })
)

// ---------------------------------------------------------------------------
// Exercício e revisão do PIT.
//
// Ficam antes de '/:id' pela mesma razão de '/anos': o Express casa na ordem de
// declaração, e 'exercicios' cairia na rota do id.
// ---------------------------------------------------------------------------

router.get(
  '/exercicios',
  verifyAcesso,
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.listarExercicios()

    return res.sendJsonAndLog(true, 'Exercícios do PIT retornados', httpCode.OK, dados)
  })
)

router.post(
  '/exercicios',
  verifyAdmin,
  schemaValidation({ body: pitSchema.criarExercicio }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.criarExercicio(
      req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Exercício do PIT criado', httpCode.Created, dados)
  })
)

// Encerrar o ano é aqui: `situacao_id` 3. É o que faz o servidor recusar
// alteração em exercício fechado.
router.put(
  '/exercicios/:ano',
  verifyAdmin,
  schemaValidation({
    params: pitSchema.anoParams,
    body: pitSchema.atualizarExercicio
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.atualizarExercicio(
      req.params.ano, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Exercício do PIT atualizado', httpCode.OK, dados)
  })
)

router.get(
  '/revisoes',
  verifyAcesso,
  schemaValidation({ query: pitSchema.revisaoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.listarRevisoes(req.query.ano)

    return res.sendJsonAndLog(true, 'Revisões do PIT retornadas', httpCode.OK, dados)
  })
)

// O QUE A REVISÃO FAZ, meta a meta, com o valor anterior ao lado. É a tela de
// conferência: o gerente lê isto contra o DIEx antes de publicar.
router.get(
  '/revisoes/:revisaoId/alteracoes',
  verifyAcesso,
  schemaValidation({ params: pitSchema.revisaoIdParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.alteracoes(req.params.revisaoId)

    return res.sendJsonAndLog(true, 'Alterações da revisão retornadas', httpCode.OK, dados)
  })
)

router.get(
  '/revisoes/:revisaoId/anexos',
  verifyAcesso,
  schemaValidation({ params: pitSchema.revisaoIdParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.listarAnexos(req.params.revisaoId)

    return res.sendJsonAndLog(true, 'Anexos da revisão retornados', httpCode.OK, dados)
  })
)

// Anexa o documento assinado. Ordem: auth -> valida params -> multer -> valida
// corpo -> handler, como no anexo do pedido da mapoteca.
router.post(
  '/revisoes/:revisaoId/anexos',
  verifyAdmin,
  schemaValidation({ params: pitSchema.revisaoIdParams }),
  uploadAnexoRevisao,
  schemaValidation({ body: pitSchema.anexoUploadBody }),
  asyncHandler(async (req, res, next) => {
    if (!req.file) {
      throw new AppError(
        'Nenhum arquivo enviado (campo "arquivo")', httpCode.BadRequest
      )
    }

    const dados = await revisaoCtrl.criarAnexo(
      req.params.revisaoId, req.file, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Anexo da revisão cadastrado', httpCode.Created, dados)
  })
)

router.get(
  '/revisoes/anexo/:anexoId/download',
  verifyAcesso,
  schemaValidation({ params: pitSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await revisaoCtrl.getAnexoParaDownload(req.params.anexoId)

    res.setHeader('Content-Type', arquivo.mimetype || 'application/octet-stream')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(arquivo.nome_original)}`
    )

    return res.send(arquivo.conteudo)
  })
)

router.delete(
  '/revisoes/anexo/:anexoId',
  verifyAdmin,
  schemaValidation({ params: pitSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    await revisaoCtrl.deletarAnexo(
      req.params.anexoId, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Anexo da revisão excluído', httpCode.OK)
  })
)

// PUBLICAR: o ato que faz a revisão passar a reger. Antes de '/revisoes/:id'
// pela ordem de declaração.
router.post(
  '/revisoes/:revisaoId/publicar',
  verifyAdmin,
  schemaValidation({
    params: pitSchema.revisaoIdParams,
    body: pitSchema.publicarRevisao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.publicar(
      req.params.revisaoId, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Revisão do PIT publicada', httpCode.OK, dados)
  })
)

// ALTERA A META DENTRO DA REVISAO, que e o unico jeito de mudar o que o PIT
// PROMETE. Antes de '/revisoes/:id' pela ordem de declaracao.
//
// POR QUE OS DOIS IDS NO CAMINHO. A alteracao entrava por 'PUT /metas/:id', e o
// servidor descobria sozinho em que revisao gravar, procurando o rascunho do
// ano: quem estivesse olhando o R0 publicado e mudasse um numero via a mudanca
// cair no R1, sem nada dizer. Aqui a revisao e escolhida por quem chama.
//
// A REVISAO PUBLICADA ACEITA A EDICAO, com MOTIVO. O texto assinado e o rei, e o
// que esta no sistema e transcricao dele: editar o R0 publicado conserta a nossa
// COPIA, e nao o plano. O controller cobra o motivo e ele desce para o rastro.
//
// AS TRES OPERACOES cabem nesta rota, porque `pit.meta_item_revisao` e esparsa:
// acrescentar e a primeira linha da meta, alterar e a linha com o numero novo,
// cancelar e a linha com `cancelada`. Tirar a meta da revisao e o DELETE abaixo.
router.put(
  '/revisoes/:revisaoId/meta/:metaId',
  verifyAdmin,
  schemaValidation({
    params: pitSchema.declaracaoParams,
    body: pitSchema.declararNaRevisao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.declararNaRevisao(
      req.params.revisaoId, req.params.metaId, req.body,
      req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Meta declarada na revisão do PIT', httpCode.OK, dados
    )
  })
)

// REMOVE a declaracao de UMA meta do RASCUNHO. Antes de '/revisoes/:id' pela
// ordem de declaracao.
//
// Existe porque `pit.meta_item_revisao` e esparsa -- as linhas de uma revisao SAO as
// alteracoes dela --, e faltava o caminho de volta: quem acrescentasse uma meta
// por engano so saia publicando o erro. A lacuna apareceu na carga do PIT de
// 2026, onde a meta 6.9 teve de entrar no R0 marcada `cancelada` por nao haver
// como deixa-la AUSENTE.
router.delete(
  '/revisoes/:revisaoId/meta/:metaId',
  verifyAdmin,
  schemaValidation({
    params: pitSchema.declaracaoParams,
    body: pitSchema.removerDeclaracao
  }),
  asyncHandler(async (req, res, next) => {
    // `req.body?.` porque a remocao no RASCUNHO nao leva corpo, e ali `req.body`
    // vem indefinido. A leitura direta viraria 500 no caminho mais comum.
    const dados = await revisaoCtrl.removerDeclaracao(
      req.params.revisaoId, req.params.metaId, req.usuarioUuid, req.contexto,
      req.body?.motivo
    )

    return res.sendJsonAndLog(
      true, 'Declaração removida da revisão do PIT', httpCode.OK, dados
    )
  })
)

router.get(
  '/revisoes/:revisaoId',
  verifyAcesso,
  schemaValidation({ params: pitSchema.revisaoIdParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.getRevisao(req.params.revisaoId)
    if (!dados) {
      throw new AppError('Revisão do PIT não encontrada', httpCode.NotFound)
    }

    return res.sendJsonAndLog(true, 'Revisão do PIT retornada', httpCode.OK, dados)
  })
)

router.post(
  '/revisoes',
  verifyAdmin,
  schemaValidation({ body: pitSchema.criarRevisao }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.criarRevisao(
      req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Revisão do PIT criada', httpCode.Created, dados)
  })
)

router.put(
  '/revisoes/:revisaoId',
  verifyAdmin,
  schemaValidation({
    params: pitSchema.revisaoIdParams,
    body: pitSchema.atualizarRevisao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.atualizarRevisao(
      req.params.revisaoId, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Revisão do PIT atualizada', httpCode.OK, dados)
  })
)

router.delete(
  '/revisoes/:revisaoId',
  verifyAdmin,
  schemaValidation({ params: pitSchema.revisaoIdParams }),
  asyncHandler(async (req, res, next) => {
    await revisaoCtrl.deletarRevisao(
      req.params.revisaoId, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Revisão do PIT excluída', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// A meta em si. Fica por ÚLTIMO porque '/:id' captura qualquer segmento.
// ---------------------------------------------------------------------------

// O HISTÓRICO da meta: em que revisão ela mudou, e para quanto. Antes de '/:id'.
router.get(
  '/:id/historico',
  verifyAcesso,
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.historico(req.params.id)

    return res.sendJsonAndLog(true, 'Histórico da meta retornado', httpCode.OK, dados)
  })
)

// CORRIGIR TRANSCRIÇÃO, e não alterar o PIT. Edita a linha da revisão em vigor,
// exigindo motivo, para quem digitou 53 onde o documento diz 35 não precisar
// inventar uma revisão que a DSG não emitiu.
router.put(
  '/:id/transcricao',
  verifyAdmin,
  schemaValidation({
    params: pitSchema.idParams,
    body: pitSchema.corrigirTranscricao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.corrigirTranscricao(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Transcrição da meta corrigida', httpCode.OK, dados)
  })
)

router.get(
  '/:id',
  verifyAcesso,
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.getPorId(req.params.id)

    if (!dados) {
      throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
    }

    return res.sendJsonAndLog(true, 'Meta do PIT retornada com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/',
  verifyAdmin,
  schemaValidation({ body: pitSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.criar(req.body, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Meta do PIT criada com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/:id',
  verifyAdmin,
  schemaValidation({
    params: pitSchema.idParams,
    body: pitSchema.atualizar
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Meta do PIT atualizada com sucesso', httpCode.OK, dados)
  })
)

// APAGAR A META, e só a partir da revisão que a CRIOU.
//
// A primeira criação pode ter nascido errada, e o documento assinado talvez nem
// tenha a meta: por isso ela se apaga. Da segunda declaração em diante o plano
// já contou com ela, e o que cabe é CANCELAR, dentro de uma revisão.
//
// `?revisao_id=` diz de onde a tela está apagando, e o controller recusa quando
// não é a revisão criadora. Sem o parâmetro sobra a guarda da contagem, que é a
// que basta para o CLI.
router.delete(
  '/:id',
  verifyAdmin,
  schemaValidation({
    params: pitSchema.idParams,
    query: pitSchema.excluirMetaQuery
  }),
  asyncHandler(async (req, res, next) => {
    await pitCtrl.deletar(
      req.params.id, req.query.revisao_id, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Meta do PIT excluída com sucesso', httpCode.OK)
  })
)

module.exports = router
