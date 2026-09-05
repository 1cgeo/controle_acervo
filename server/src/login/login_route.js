'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const loginCtrl = require('./login_ctrl')
const loginSchema = require('./login_schema')
const verifyLogin = require('./verify_login')

const router = express.Router()

router.post(
  '/',
  schemaValidation({ body: loginSchema.login }),
  asyncHandler(async (req, res, next) => {
    // `plugins` e `qgis` só chegam dos dois clientes de QGIS, e o Joi já os
    // proibiu nos demais. Eles alimentam o gate de versão de `login_ctrl.js`,
    // que só barra o 'sap_fp'.
    const dados = await loginCtrl.login(
      req.body.usuario,
      req.body.senha,
      req.body.cliente,
      req.body.plugins,
      req.body.qgis
    )

    return res.sendJsonAndLog(
      true,
      'Usuário autenticado com sucesso',
      httpCode.Created,
      dados
    )
  })
)

// Perfil atual de quem ja tem token, para o client reconferir a foto que
// guardou no login. So exige token valido (verifyLogin), e nao perfil em modulo
// nenhum: quem perdeu todo o acesso tambem precisa da resposta para a tela
// parar de oferecer o que nao pode mais.
router.get(
  '/sessao',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await loginCtrl.sessao(req.usuarioUuid)

    return res.sendJsonAndLog(
      true,
      'Sessão retornada com sucesso',
      httpCode.OK,
      dados
    )
  })
)

// O TOKEN DA TILE, e a rota é literal e vem depois de `/sessao`: não há rota com
// parâmetro neste arquivo, mas a ordem é a mesma regra de sempre.
//
// A GUARDA É `verifyLogin`, E A ESCOLHA É DELIBERADA. Ela é a mesma pergunta que
// o `verifyLoginTile` faz na ponta ("token válido, conta ativa"), e nada além:
// a rota da tile declara, no cabeçalho dela, que quem tem conta ativa busca
// tile mesmo sem perfil no módulo `producao`, porque o que a tile carrega é o
// recorte da folha e o nome dela. Cobrar `verifyAcesso` aqui trocaria essa
// decisão de lugar sem que ninguém tivesse decidido nada -- e a tile passaria a
// exigir mais para NASCER do que para ser BUSCADA, que é o pior dos dois mundos.
//
// POST, e não GET: ela CRIA uma credencial, como o `POST /login` cria a sessão.
// Nenhum corpo é lido, e por isso não há `schemaValidation`.
router.post(
  '/tile',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await loginCtrl.tokenDeTile({
      id: req.usuarioId,
      uuid: req.usuarioUuid,
      administrador: req.administrador,
      cliente: req.clienteDoToken,
      // O carimbo da senha vigente, lido pelo `verifyLogin` na consulta que ele
      // já faz: sem ele, a camada de tiles sobreviveria à troca de senha pelos
      // dez minutos do token curto.
      carimbo: req.carimboDaSenha
    })

    return res.sendJsonAndLog(
      true,
      'Token de tile gerado com sucesso',
      httpCode.Created,
      dados
    )
  })
)

module.exports = router
