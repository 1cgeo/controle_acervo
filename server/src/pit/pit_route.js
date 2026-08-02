'use strict'

const express = require('express')

const { asyncHandler, httpCode, AppError } = require('../utils')

// Validacao ESTRITA, e nao a padrao da plataforma: chave desconhecida no corpo
// vira 400 com sugestao, em vez de sumir no stripUnknown. E o contrato que esta
// rota ja tinha quando morava no modulo orcamento, e a escrita aqui vem de CLI e
// de carga, onde um nome de campo errado descartado em silencio grava meia meta.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyLogin, verifyAdmin } = require('../login')

const pitCtrl = require('./pit_ctrl')
const execucaoCtrl = require('./pit_execucao_ctrl')
const extraCtrl = require('./pit_extra_ctrl')

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
// A guarda segue a da meta: LER é de qualquer pessoa logada, porque o
// andamento do plano anual interessa aos três módulos, e ESCREVER é do
// administrador global. Não há perfil de PIT, porque não há módulo PIT.
// ---------------------------------------------------------------------------

router.get(
  '/execucao',
  verifyLogin,
  schemaValidation({ query: pitSchema.execucaoDoMesQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await execucaoCtrl.listarDoMes(req.query.ano, req.query.mes)

    return res.sendJsonAndLog(
      true, 'Execução do mês retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/execucao/resumo',
  verifyLogin,
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
  verifyLogin,
  schemaValidation({ params: pitSchema.metaIdParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await execucaoCtrl.listarDaMeta(req.params.metaId)

    return res.sendJsonAndLog(
      true, 'Lançamentos da meta retornados com sucesso', httpCode.OK, dados
    )
  })
)

// UMA rota para criar e para alterar, porque o par (meta, mês) é uma CÉLULA de
// grade: quem preenche não sabe (nem deveria saber) se aquele mês já tinha
// linha. Quem separa criação de alteração é o controlador, e só para o rastro.
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

// ---------------------------------------------------------------------------
// A meta em si. Fica por ÚLTIMO porque '/:id' captura qualquer segmento.
// ---------------------------------------------------------------------------

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
