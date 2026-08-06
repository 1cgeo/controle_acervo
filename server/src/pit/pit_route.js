'use strict'

const express = require('express')

const { asyncHandler, httpCode, AppError } = require('../utils')

// Validacao ESTRITA, e nao a padrao da plataforma: chave desconhecida no corpo
// vira 400 com sugestao, em vez de sumir no stripUnknown. E o contrato que esta
// rota ja tinha quando morava no modulo orcamento, e a escrita aqui vem de CLI e
// de carga, onde um nome de campo errado descartado em silencio grava meia meta.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyLogin, verifyAdmin, verifyGerente } = require('../login')

const pitCtrl = require('./pit_ctrl')
const execucaoCtrl = require('./pit_execucao_ctrl')
const extraCtrl = require('./pit_extra_ctrl')
const revisaoCtrl = require('./pit_revisao_ctrl')

const uploadAnexoRevisao = require('./anexo_revisao_upload')

const pitSchema = require('./pit_schema')

const router = express.Router()

// Metas do PIT: rota de PLATAFORMA, sem prefixo de modulo, como /usuarios.
//
// LER e de qualquer pessoa logada (`verifyLogin`), e nao de um perfil de modulo.
// Todo modulo precisa oferecer a lista: o orcamento amarra a NC e o item do PDR
// a meta que financiam, e a mapoteca amarra o pedido de impressao a meta que ele
// cumpre.
//
// ESCREVER e do administrador global (`verifyAdmin`): o PIT muda uma vez por
// ano, vem de documento assinado, e errar nele contamina os tres modulos.

router.get(
  '/',
  verifyLogin,
  schemaValidation({ query: pitSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await pitCtrl.listar(req.query.ano)

    return res.sendJsonAndLog(true, 'Metas do PIT retornadas com sucesso', httpCode.OK, dados)
  })
)

// Antes de '/:id', senao 'anos' cai na rota do id e reprova na validacao.
router.get(
  '/anos',
  verifyLogin,
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
// LER é do GERENTE de qualquer módulo e do administrador global: o PIT é o
// compromisso do ano, e quem responde por ele é quem responde pelo módulo.
// ESCREVER é do administrador global. Não há perfil de PIT, porque não há
// módulo PIT.
// ---------------------------------------------------------------------------

// A GRADE do ano: uma linha por meta, com os doze meses e os dois números de
// cada um. O mês é COLUNA, e não filtro: o trabalho é anual, e "estou
// atrasado?" não se responde um mês por vez.
router.get(
  '/execucao',
  verifyGerente,
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
  verifyGerente,
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
  verifyGerente,
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
  verifyGerente,
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
  verifyAdmin,
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
  verifyAdmin,
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await execucaoCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Lançamento excluído com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// Demanda Extra-PIT (subseção 3.3 do RPCMTec)
// ---------------------------------------------------------------------------

router.get(
  '/extra',
  verifyLogin,
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
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await extraCtrl.anos()

    return res.sendJsonAndLog(
      true, 'Anos com demanda Extra-PIT retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/extra/:id',
  verifyLogin,
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
  verifyAdmin,
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
  verifyAdmin,
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
  verifyAdmin,
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
// LER é de qualquer pessoa logada, como o resto da 3.3. ESCREVER é do
// administrador, como as outras escritas da demanda: o vínculo é o que faz a
// folha CONTAR como exceção autorizada em vez de meta do plano.

// Antes de '/extra/:id/versoes/:versao_id', pela mesma razão de '/anos'.
router.get(
  '/extra/:id/versoes/candidatas',
  verifyLogin,
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
  verifyLogin,
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
  verifyAdmin,
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
  verifyAdmin,
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
// LER é do GERENTE e do administrador, como o resto da grade. O ensaio devolve o
// planejado e o realizado meta a meta, ou seja, o MESMO dado de `/execucao`:
// uma guarda mais fraca aqui seria o caminho de volta para quem a grade barra.
router.get(
  '/execucao/ensaio',
  verifyGerente,
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
  verifyLogin,
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
  verifyLogin,
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
  verifyLogin,
  schemaValidation({ params: pitSchema.revisaoIdParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.alteracoes(req.params.revisaoId)

    return res.sendJsonAndLog(true, 'Alterações da revisão retornadas', httpCode.OK, dados)
  })
)

router.get(
  '/revisoes/:revisaoId/anexos',
  verifyLogin,
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
  verifyLogin,
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
  schemaValidation({ params: pitSchema.declaracaoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await revisaoCtrl.removerDeclaracao(
      req.params.revisaoId, req.params.metaId, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Meta removida do rascunho da revisão', httpCode.OK, dados
    )
  })
)

router.get(
  '/revisoes/:revisaoId',
  verifyLogin,
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
  verifyLogin,
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
  verifyLogin,
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
