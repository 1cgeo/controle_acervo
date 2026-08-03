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
const midiaCtrl = require('./pit_midia_ctrl')
const revisaoCtrl = require('./pit_revisao_ctrl')

const uploadAnexoRevisao = require('./anexo_revisao_upload')

const pitSchema = require('./pit_schema')

const router = express.Router()

// Metas do PIT: rota de PLATAFORMA, sem prefixo de modulo, como /usuarios.
//
// LER e de qualquer pessoa logada (verifyLogin), e nao de um perfil no
// orcamento. Todo modulo precisa oferecer a lista: o orcamento amarra a NC e o
// item do PDR a meta que financiam, e a mapoteca amarra o pedido de impressao a
// meta que ele cumpre. Exigir perfil no orcamento deixava a mapoteca de fora, e
// foi por isso que o pedido guardou o codigo da meta como texto livre ate
// 2026-07-31.
//
// ESCREVER e do administrador global (verifyAdmin). O PIT muda uma vez por ano,
// vem de documento assinado, e errar nele contamina os tres modulos. Decisao do
// chefe, 2026-07-31.

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
// LER é do GERENTE de qualquer módulo e do administrador global (chefe,
// 2026-08-02). Era de qualquer pessoa logada até essa data: o PIT é o
// compromisso do ano, e quem responde por ele é quem responde pelo módulo.
// ESCREVER continua sendo do administrador global. Não há perfil de PIT, porque
// não há módulo PIT.
// ---------------------------------------------------------------------------

// A GRADE do ano: uma linha por meta, com os doze meses e os dois números de
// cada um. Substituiu o `GET /execucao?ano&mes` em 2026-08-02, quando o mês
// deixou de ser filtro e virou coluna: o trabalho é anual, e "estou atrasado?"
// não se responde um mês por vez.
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

// O ENSAIO: o digitado e o calculado lado a lado, sem escrever nada. É o portão
// para virar uma meta de Manual para automática, e responde inclusive na meta
// que ainda está Manual, que é justamente a que interessa olhar.
//
// LER é de qualquer pessoa logada, como o resto da grade.
router.get(
  '/execucao/ensaio',
  verifyLogin,
  schemaValidation({ query: pitSchema.ensaioQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await execucaoCtrl.ensaio(req.query.ano, req.query.meta_id)

    return res.sendJsonAndLog(true, 'Ensaio da grade retornado com sucesso', httpCode.OK, dados)
  })
)

// ---------------------------------------------------------------------------
// De-para da MÍDIA impressa para a meta, por ano. É a fonte da meta 4 quando ela
// for automática, e a razão de não bastar `mapoteca.pedido.meta_pit_id` está no
// topo de pit_midia_ctrl.js.
//
// LER é de qualquer pessoa logada, como o resto do PIT: a mapoteca precisa
// mostrar a que meta o material atende. ESCREVER é do administrador global, pelo
// mesmo motivo da meta: errar aqui muda o número que a 2.1 e o EXEC_PIT
// publicam.
// ---------------------------------------------------------------------------

router.get(
  '/midia',
  verifyLogin,
  schemaValidation({ query: pitSchema.midiaQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await midiaCtrl.listar(req.query.ano)

    return res.sendJsonAndLog(
      true, 'De-para de mídia retornado com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/midia',
  verifyAdmin,
  schemaValidation({ body: pitSchema.criarMidiaMeta }),
  asyncHandler(async (req, res, next) => {
    const dados = await midiaCtrl.criar(req.body, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(
      true, 'De-para de mídia criado com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/midia/:id',
  verifyAdmin,
  schemaValidation({ params: pitSchema.idParams, body: pitSchema.atualizarMidiaMeta }),
  asyncHandler(async (req, res, next) => {
    await midiaCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'De-para de mídia atualizado com sucesso', httpCode.OK)
  })
)

router.delete(
  '/midia/:id',
  verifyAdmin,
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await midiaCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'De-para de mídia excluído com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// Exercício e revisão do PIT (2026-08-04).
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

router.delete(
  '/:id',
  verifyAdmin,
  schemaValidation({ params: pitSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await pitCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Meta do PIT excluída com sucesso', httpCode.OK)
  })
)

module.exports = router
