'use strict'

// MICROCONTROLE: o que o plugin do QGIS mede enquanto a pessoa trabalha.
//
// SAO ONZE ROTAS EM DOIS BANCOS, e a divisao decide o que acontece quando a
// telemetria esta fora do ar:
//
//   BANCO PRINCIPAL (cinco) - GET /tipo_monitoramento e as quatro de
//     /configuracao/perfil_monitoramento. Elas dizem O QUE monitorar, e
//     RESPONDEM SEMPRE: nao tocam a segunda conexao.
//   BANCO DA TELEMETRIA (seis) - GET /tipo_operacao, POST /feicao, POST /tela,
//     GET /feicao/resumo, GET /tela/cobertura e GET /tela/aproveitamento. Sem o
//     outro banco elas respondem 503, e nao 500: a dependencia que falta e
//     externa, e este servico nao quebrou. Ver `microcontrole_ctrl.js`.
//
// TRES DAS SEIS JUNTAM DADO DOS DOIS BANCOS, EM JAVASCRIPT. Nao existe juncao
// entre bancos no PostgreSQL, e nao se abriu nenhum `dblink` para fingir que
// existe: o controlador resolve aqui os `atividade_id` de um lote e os nomes dos
// operadores, e leva os identificadores prontos para a consulta de la.
//
// A REGUA DE PERFIL, e ela e tradução direta do SAP 2.3.5:
//
//   `verifyAdmin` de la  -> `gerente` daqui. Sao NOVE: os dois catalogos, as
//     tres leituras agregadas e as quatro do CRUD de perfil. Pela regua da casa
//     (2026-08-08) o gerente e quem responde pela area, e e ele quem olha
//     aproveitamento de EQUIPE -- a leitura aqui nao e "a tela do modulo", e sim
//     o rendimento de pessoas com nome. No SAP as nove eram `verifyAdmin` porque
//     la o admin era o unico degrau acima de "esta logado"; aqui existe o
//     gerente do modulo, que e o degrau certo.
//   `verifyLogin` de la  -> `operador` daqui. Sao DUAS: `POST /feicao` e
//     `POST /tela`. Elas nao sao tela: e o PLUGIN gravando a telemetria do
//     PROPRIO trabalho de quem esta com a atividade na mao, e quem trabalha e
//     operador. Cobrar gerente aqui desligaria a medicao de todo mundo que ela
//     existe para medir.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele e 'acervo':
// uma rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro
// de sintaxe, sem teste vermelho e sem nada na tela. A PASTA E `microcontrole` e
// o MODULO e `producao`, como `src/campo/` cobra `pit`:
// `__tests__/routes/modulo_em_toda_rota.test.js` varre este arquivo por isso.
//
// A TELEMETRIA NAO AUDITA E O CADASTRO AUDITA, e a assimetria esta explicada no
// cabecalho de `microcontrole_ctrl.js`.
//
// ORDEM DE DECLARACAO: nao ha rota com parametro neste arquivo -- os filtros vem
// todos por query string e os ids de exclusao vem no CORPO, que e o contrato do
// SAP Gerente. Nada aqui pode ser capturado por um `/:id`, e a regra da casa
// ("rota literal antes de rota com parametro") nao tem em que morder.

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

// O validador ESTRITO: chave desconhecida no corpo vira 400 com a sugestao do
// nome mais parecido, em vez de ser descartada em silencio. E o que ja vale nas
// 49 rotas de `producao/perfil_route.js`, que sao as irmas destas quatro de
// configuracao.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const microcontroleCtrl = require('./microcontrole_ctrl')
const microcontroleSchema = require('./microcontrole_schema')

const router = express.Router()

// --- Os catalogos ------------------------------------------------------------

/**
 * @swagger
 * /api/microcontrole/tipo_monitoramento:
 *   get:
 *     summary: Lista os tipos de monitoramento (banco principal)
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     responses:
 *       200:
 *         description: Tipos de monitoramento retornados com sucesso
 */
router.get(
  '/tipo_monitoramento',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await microcontroleCtrl.getTipoMonitoramento()

    return res.sendJsonAndLog(
      true, 'Tipos de monitoramento retornados com sucesso', httpCode.OK, dados
    )
  })
)

/**
 * @swagger
 * /api/microcontrole/tipo_operacao:
 *   get:
 *     summary: Lista os tipos de operacao de feicao (banco da telemetria)
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     responses:
 *       200:
 *         description: Tipos de operacao retornados com sucesso
 *       503:
 *         description: O banco da telemetria nao esta configurado ou nao respondeu
 */
router.get(
  '/tipo_operacao',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await microcontroleCtrl.getTipoOperacao()

    return res.sendJsonAndLog(
      true, 'Tipos de operação retornados com sucesso', httpCode.OK, dados
    )
  })
)

// --- A escrita do plugin -----------------------------------------------------
//
// AS DUAS NAO DEVOLVEM CORPO, so o 201. O plugin manda em rajada, em segundo
// plano, e nao tem o que fazer com a linha gravada.

/**
 * @swagger
 * /api/microcontrole/feicao:
 *   post:
 *     summary: Grava a telemetria de feicao de uma atividade (banco da telemetria)
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     responses:
 *       201:
 *         description: Telemetria de feicao armazenada com sucesso
 *       503:
 *         description: O banco da telemetria nao esta configurado ou nao respondeu
 */
router.post(
  '/feicao',
  verifyPerfil('operador', 'producao'),
  schemaValidation({ body: microcontroleSchema.feicao }),
  asyncHandler(async (req, res, next) => {
    // `req.usuarioUuid`, E NUNCA O CORPO: a autoria sai do token, e e o unico
    // ponto que impede lancar telemetria em nome de outro.
    await microcontroleCtrl.armazenaFeicao(
      req.body.atividade_id,
      req.usuarioUuid,
      req.body.dados
    )

    return res.sendJsonAndLog(
      true,
      'Informações de produção de feição armazenadas com sucesso',
      httpCode.Created
    )
  })
)

/**
 * @swagger
 * /api/microcontrole/tela:
 *   post:
 *     summary: Grava a telemetria de tela de uma atividade (banco da telemetria)
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     responses:
 *       201:
 *         description: Telemetria de tela armazenada com sucesso
 *       503:
 *         description: O banco da telemetria nao esta configurado ou nao respondeu
 */
router.post(
  '/tela',
  verifyPerfil('operador', 'producao'),
  schemaValidation({ body: microcontroleSchema.tela }),
  asyncHandler(async (req, res, next) => {
    await microcontroleCtrl.armazenaTela(
      req.body.atividade_id,
      req.usuarioUuid,
      req.body.dados
    )

    return res.sendJsonAndLog(
      true, 'Informações de tela armazenadas com sucesso', httpCode.Created
    )
  })
)

// --- As tres leituras agregadas ----------------------------------------------

/**
 * @swagger
 * /api/microcontrole/feicao/resumo:
 *   get:
 *     summary: Resumo de producao de feicao, por operador, por camada e por dia
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     parameters:
 *       - in: query
 *         name: lote_id
 *         required: false
 *         schema:
 *           type: integer
 *         description: ID do lote (ausente = todos os lotes)
 *       - in: query
 *         name: data_inicio
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Inicio do periodo (default ultimos 30 dias)
 *       - in: query
 *         name: data_fim
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fim do periodo (default agora)
 *     responses:
 *       200:
 *         description: Resumo de feicao retornado com sucesso
 *       503:
 *         description: O banco da telemetria nao esta configurado ou nao respondeu
 */
router.get(
  '/feicao/resumo',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ query: microcontroleSchema.resumoFeicaoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await microcontroleCtrl.getResumoFeicao(
      req.query.lote_id,
      req.query.data_inicio,
      req.query.data_fim
    )

    return res.sendJsonAndLog(
      true, 'Resumo de feição retornado com sucesso', httpCode.OK, dados
    )
  })
)

/**
 * @swagger
 * /api/microcontrole/tela/cobertura:
 *   get:
 *     summary: Cobertura de tela como GeoJSON FeatureCollection
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     parameters:
 *       - in: query
 *         name: lote_id
 *         required: false
 *         schema:
 *           type: integer
 *         description: ID do lote (ausente = todos os lotes)
 *       - in: query
 *         name: usuario_uuid
 *         required: false
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID do operador (ausente = todos)
 *       - in: query
 *         name: data_inicio
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Inicio do periodo (default ultimos 30 dias)
 *       - in: query
 *         name: data_fim
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fim do periodo (default agora)
 *     responses:
 *       200:
 *         description: Cobertura de tela retornada com sucesso
 *       503:
 *         description: O banco da telemetria nao esta configurado ou nao respondeu
 */
router.get(
  '/tela/cobertura',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ query: microcontroleSchema.coberturaTelaQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await microcontroleCtrl.getCoberturaTela(
      req.query.lote_id,
      req.query.usuario_uuid,
      req.query.data_inicio,
      req.query.data_fim
    )

    return res.sendJsonAndLog(
      true, 'Cobertura de tela retornada com sucesso', httpCode.OK, dados
    )
  })
)

/**
 * @swagger
 * /api/microcontrole/tela/aproveitamento:
 *   get:
 *     summary: Aproveitamento diario de tela de um operador
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     parameters:
 *       - in: query
 *         name: usuario_uuid
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID do operador
 *       - in: query
 *         name: data_inicio
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Data inicial (AAAA-MM-DD, default ultimos 30 dias)
 *       - in: query
 *         name: data_fim
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Data final (AAAA-MM-DD, inclusive)
 *     responses:
 *       200:
 *         description: Aproveitamento de tela retornado com sucesso
 *       503:
 *         description: O banco da telemetria nao esta configurado ou nao respondeu
 */
router.get(
  '/tela/aproveitamento',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ query: microcontroleSchema.aproveitamentoTelaQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await microcontroleCtrl.getAproveitamentoTela(
      req.query.usuario_uuid,
      req.query.data_inicio,
      req.query.data_fim
    )

    return res.sendJsonAndLog(
      true, 'Aproveitamento de tela retornado com sucesso', httpCode.OK, dados
    )
  })
)

// --- O perfil de monitoramento (banco principal) -----------------------------
//
// A ORDEM DOS QUATRO E A DO SAP (GET, DELETE, POST, PUT), e nao a que a casa
// costuma usar. Ela nao muda comportamento -- os quatro tem o MESMO caminho e
// diferem so no metodo, e o Express casa por metodo antes de casar por ordem --
// mas manter a ordem de la faz a comparacao com `microcontrole_route.js` do SAP
// ser linha a linha enquanto a travessia acontece. E o mesmo criterio de
// `producao/perfil_route.js`.

/**
 * @swagger
 * /api/microcontrole/configuracao/perfil_monitoramento:
 *   get:
 *     summary: Lista o perfil de monitoramento (qual subfase de qual lote e monitorada)
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     responses:
 *       200:
 *         description: Perfis de monitoramento retornados com sucesso
 */
router.get(
  '/configuracao/perfil_monitoramento',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await microcontroleCtrl.getPerfilMonitoramento()

    return res.sendJsonAndLog(
      true, 'Perfis de monitoramento retornados com sucesso', httpCode.OK, dados
    )
  })
)

/**
 * @swagger
 * /api/microcontrole/configuracao/perfil_monitoramento:
 *   delete:
 *     summary: Exclui perfis de monitoramento pelos ids
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     responses:
 *       200:
 *         description: Perfis de monitoramento excluidos com sucesso
 */
router.delete(
  '/configuracao/perfil_monitoramento',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: microcontroleSchema.perfilMonitoramentoIds }),
  asyncHandler(async (req, res, next) => {
    await microcontroleCtrl.deletePerfilMonitoramento(
      req.body.perfis_monitoramento_ids, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Perfis de monitoramento excluídos com sucesso', httpCode.OK
    )
  })
)

/**
 * @swagger
 * /api/microcontrole/configuracao/perfil_monitoramento:
 *   post:
 *     summary: Cria perfis de monitoramento em massa
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     responses:
 *       201:
 *         description: Perfis de monitoramento criados com sucesso
 */
router.post(
  '/configuracao/perfil_monitoramento',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: microcontroleSchema.perfilMonitoramento }),
  asyncHandler(async (req, res, next) => {
    const dados = await microcontroleCtrl.criaPerfilMonitoramento(
      req.body.perfis_monitoramento, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Perfis de monitoramento criados com sucesso', httpCode.Created, dados
    )
  })
)

/**
 * @swagger
 * /api/microcontrole/configuracao/perfil_monitoramento:
 *   put:
 *     summary: Atualiza perfis de monitoramento em massa
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Microcontrole
 *     responses:
 *       200:
 *         description: Perfis de monitoramento atualizados com sucesso
 */
router.put(
  '/configuracao/perfil_monitoramento',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: microcontroleSchema.perfilMonitoramentoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await microcontroleCtrl.atualizaPerfilMonitoramento(
      req.body.perfis_monitoramento, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Perfis de monitoramento atualizados com sucesso', httpCode.OK
    )
  })
)

module.exports = router
