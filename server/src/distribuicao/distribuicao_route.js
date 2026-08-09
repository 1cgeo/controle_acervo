'use strict'

// A FILA DO OPERADOR: pega a proxima atividade, inicia, finaliza e aponta
// problema. E a rota que o plugin SAP Operador consome, e o coracao da producao.
//
// TODAS AS OITO COBRAM `verifyPerfil('operador', 'producao')`, com o segundo
// argumento SEMPRE explicito. O default de `verifyPerfil` e 'acervo': a rota que
// o esquecesse passaria a cobrar perfil no ACERVO, sem erro de sintaxe, sem
// teste vermelho e sem nada na tela.
//
// E `operador`, E NAO `consulta`, ATE NAS DUAS ROTAS DE LEITURA. A regua da casa
// diz que consulta LE as telas do modulo e operador LANCA, e nada aqui e tela:
// `/tipo_problema` e `/plugin_path` sao as duas primeiras chamadas que o plugin
// faz ao abrir, e servem so para ele montar o proprio formulario de apontamento
// e se atualizar sozinho. Quem so consulta a producao nao abre o plugin, e um
// piso mais baixo aqui prometeria um acesso que as outras seis negam no segundo
// seguinte.
//
// O SAP GUARDAVA ESTAS ROTAS COM `verifyLogin`, e `/plugin_path` com NADA. A
// traducao para as quatro guardas do SCA esta em `routes.js`: `verifyLogin` de
// la vira operador em `producao`. O `/plugin_path` aberto de la nao atravessou:
// ele devolve uma pasta de rede da instalacao, e responder isso a quem nao esta
// logado e entregar a topologia da rede a quem perguntar.
//
// NAO HA ROTA COM PARAMETRO NESTE ARQUIVO, e por isso a ordem de declaracao nao
// esconde nenhuma armadilha: as oito sao literais. Rota nova com `/:id` entra
// DEPOIS de todas elas.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../login')

const distribuicaoCtrl = require('./distribuicao_ctrl')
const distribuicaoSchema = require('./distribuicao_schema')

const router = express.Router()

/**
 * @swagger
 * /api/distribuicao/verifica:
 *   get:
 *     summary: Atividade em execução do operador
 *     description: Devolve o pacote da atividade que o operador tem em execução, se houver.
 *     tags:
 *       - distribuicao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Atividade em execução, ou aviso de que não há nenhuma
 */
router.get(
  '/verifica',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    // ELA ESCREVE, apesar de ser GET: quando o dado de producao e PostGIS
    // controlado, este pedido cria ou renova o papel efemero da pessoa no banco
    // de EDICAO e grava a linha de `producao.login_temporario`. O metodo e GET
    // porque o contrato do plugin ja instalado e esse, e mudar para POST
    // quebraria toda instalacao para ganhar uma letra de semantica.
    const dados = await distribuicaoCtrl.verifica(req.usuarioUuid, req.contexto)

    const msg = dados
      ? 'Atividade em execução retornada'
      : 'Sem atividade em execução'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

/**
 * @swagger
 * /api/distribuicao/inicia:
 *   post:
 *     summary: Inicia a próxima atividade da fila
 *     description: Calcula a fila do operador e põe a atividade escolhida em execução.
 *     tags:
 *       - distribuicao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Atividade iniciada
 *       400:
 *         description: Sem atividades disponíveis para iniciar
 */
router.post(
  '/inicia',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await distribuicaoCtrl.inicia(req.usuarioUuid, req.contexto)

    // FILA VAZIA NAO E ERRO, e mesmo assim sai como 400 com `success: true`. E o
    // contrato do SAP, e o plugin ja instalado distingue os dois casos por ele.
    const msg = dados
      ? 'Atividade iniciada'
      : 'Sem atividades disponíveis para iniciar'
    const code = dados ? httpCode.Created : httpCode.BadRequest

    return res.sendJsonAndLog(true, msg, code, dados)
  })
)

/**
 * @swagger
 * /api/distribuicao/finaliza:
 *   post:
 *     summary: Finaliza a atividade em execução
 *     description: Finaliza a atividade do operador, com ou sem correção, gravando observações, metadado de edição e alteração de fluxo.
 *     tags:
 *       - distribuicao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Atividade finalizada com sucesso
 *       400:
 *         description: Atividade não encontrada ou não corresponde a este operador
 */
router.post(
  '/finaliza',
  verifyPerfil('operador', 'producao'),
  schemaValidation({ body: distribuicaoSchema.finaliza }),
  asyncHandler(async (req, res, next) => {
    const dados = await distribuicaoCtrl.finaliza(
      req.usuarioUuid,
      req.body.atividade_id,
      req.body.sem_correcao,
      req.body.alterar_fluxo,
      req.body.info_edicao,
      req.body.observacao_proxima_atividade,
      req.body.observacao_atividade,
      req.contexto
    )

    // `dados` E NULO NO CASO COMUM, e o envelope sai como sempre saiu. Ele so
    // traz alguma coisa quando o dado de producao e PostGIS controlado: ai vem
    // `revogacao`, dizendo se o acesso ao banco de EDICAO foi mesmo fechado. A
    // atividade fica finalizada nos dois casos -- ver o bloco no fim de
    // `controller.finaliza`, que e onde a decisao esta escrita.
    return res.sendJsonAndLog(
      true, 'Atividade finalizada com sucesso', httpCode.Created, dados
    )
  })
)

/**
 * @swagger
 * /api/distribuicao/problema_atividade:
 *   post:
 *     summary: Reporta um problema na atividade em execução
 *     description: Interrompe a atividade, cria a atividade pausada de retomada e tira a unidade de trabalho da distribuição.
 *     tags:
 *       - distribuicao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Problema de atividade reportado com sucesso
 */
router.post(
  '/problema_atividade',
  verifyPerfil('operador', 'producao'),
  schemaValidation({ body: distribuicaoSchema.problemaAtividade }),
  asyncHandler(async (req, res, next) => {
    const dados = await distribuicaoCtrl.problemaAtividade(
      req.body.atividade_id,
      req.body.tipo_problema_id,
      req.body.descricao,
      req.body.polygon_ewkt,
      req.usuarioUuid,
      req.contexto
    )

    // Mesmo envelope de `/finaliza`: `dados` so traz `revogacao` quando havia
    // acesso ao banco de EDICAO a fechar. Ver `fecharAcesso` no controller.
    return res.sendJsonAndLog(
      true, 'Problema de atividade reportado com sucesso', httpCode.Created, dados
    )
  })
)

/**
 * @swagger
 * /api/distribuicao/finalizacao_incorreta:
 *   post:
 *     summary: Reporta finalização incorreta
 *     description: Aponta o problema na última atividade finalizada pelo operador.
 *     tags:
 *       - distribuicao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Finalização incorreta reportada com sucesso
 */
router.post(
  '/finalizacao_incorreta',
  verifyPerfil('operador', 'producao'),
  schemaValidation({ body: distribuicaoSchema.finalizacaoIncorreta }),
  asyncHandler(async (req, res, next) => {
    await distribuicaoCtrl.finalizacaoIncorreta(
      req.body.descricao, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Problema de finalização incorreta reportado com sucesso', httpCode.Created
    )
  })
)

/**
 * @swagger
 * /api/distribuicao/metadados_edicao:
 *   post:
 *     summary: Grava o metadado por folha da atividade de Edição
 *     description: Permite ao operador gravar o nome e as palavras-chave das versões da sua atividade de edição em execução.
 *     tags:
 *       - distribuicao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Metadados de edição salvos com sucesso
 */
router.post(
  '/metadados_edicao',
  verifyPerfil('operador', 'producao'),
  schemaValidation({ body: distribuicaoSchema.metadadoEdicao }),
  asyncHandler(async (req, res, next) => {
    await distribuicaoCtrl.salvaMetadadoEdicao(
      req.usuarioUuid, req.body.metadados, req.contexto
    )

    return res.sendJsonAndLog(true, 'Metadados de edição salvos com sucesso', httpCode.OK)
  })
)

/**
 * @swagger
 * /api/distribuicao/tipo_problema:
 *   get:
 *     summary: Catálogo de tipos de problema
 *     description: Lista os tipos de problema que o operador pode apontar numa atividade.
 *     tags:
 *       - distribuicao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Tipos de problema retornados com sucesso
 */
router.get(
  '/tipo_problema',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await distribuicaoCtrl.getTipoProblema()

    return res.sendJsonAndLog(true, 'Tipos de problema retornados', httpCode.OK, dados)
  })
)

/**
 * @swagger
 * /api/distribuicao/plugin_path:
 *   get:
 *     summary: Caminho de onde o cliente baixa o plugin
 *     description: Devolve o caminho configurado em qgis.plugin_path, que nasce vazio e é preenchido na instalação.
 *     tags:
 *       - distribuicao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Caminho do plugin retornado com sucesso
 */
router.get(
  '/plugin_path',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await distribuicaoCtrl.getPluginPath()

    return res.sendJsonAndLog(true, 'Caminho do plugin retornado com sucesso', httpCode.OK, dados)
  })
)

module.exports = router
