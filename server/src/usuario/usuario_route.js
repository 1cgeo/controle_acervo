'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyAdmin, verifyLogin } = require('../login')

const usuarioCtrl = require('./usuario_ctrl')

const usuarioSchema = require('./usuario_schema')

const router = express.Router()

// ---------------------------------------------------------------------------
// Catalogos
// ---------------------------------------------------------------------------

// Catalogo para a tela de usuarios montar os selects de perfil por modulo, em
// vez de decorar os codigos do dominio.
router.get(
  '/dominio/modulo',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await usuarioCtrl.getModulos()
    return res.sendJsonAndLog(true, 'Módulos retornados', httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_perfil',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await usuarioCtrl.getPerfis()
    return res.sendJsonAndLog(true, 'Perfis retornados', httpCode.OK, dados)
  })
)

// `verifyLogin`, e nao verifyAdmin como os dois acima: a tela de "meu perfil"
// tambem escolhe posto/graduacao, e quem a usa e qualquer pessoa logada.
router.get(
  '/dominio/tipo_posto_grad',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await usuarioCtrl.getPostosGrad()
    return res.sendJsonAndLog(true, 'Postos e graduações retornados', httpCode.OK, dados)
  })
)

// ---------------------------------------------------------------------------
// O PROPRIO cadastro (#/perfil), `verifyLogin`
//
// REGISTRADO ANTES DE '/:uuid': o Express casa na ordem de declaracao, e
// `PUT /perfil` cairia na rota de administrador com 'perfil' no lugar do uuid.
// O schema de params recusaria (nao e um GUID), mas com 400 de validacao em vez
// da tela funcionando -- e a mensagem nao diria nada a quem esta lendo.
// ---------------------------------------------------------------------------

router.get(
  '/perfil',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await usuarioCtrl.getPerfilProprio(req.usuarioUuid)
    return res.sendJsonAndLog(true, 'Perfil retornado', httpCode.OK, dados)
  })
)

router.put(
  '/perfil',
  verifyLogin,
  schemaValidation({ body: usuarioSchema.updatePerfilProprio }),
  asyncHandler(async (req, res, next) => {
    await usuarioCtrl.atualizaPerfilProprio(req.usuarioUuid, req.body)
    return res.sendJsonAndLog(true, 'Perfil atualizado com sucesso', httpCode.OK)
  })
)

// Trocar a PROPRIA senha. Ate 2026-08-02 o SCA nao tinha como oferecer isto: a
// senha vivia no Auth Server, e a tela dela era de la.
router.put(
  '/perfil/senha',
  verifyLogin,
  schemaValidation({ body: usuarioSchema.updateSenhaPropria }),
  asyncHandler(async (req, res, next) => {
    await usuarioCtrl.atualizaSenhaPropria(
      req.usuarioUuid,
      req.body.senha_atual,
      req.body.senha_nova
    )
    return res.sendJsonAndLog(true, 'Senha alterada com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// Administracao de usuarios, `verifyAdmin`
// ---------------------------------------------------------------------------

// Reset em LOTE: a senha passa a ser o proprio login de cada um. Fica antes de
// '/:uuid' pela mesma razao de '/perfil'.
router.post(
  '/senha/reset',
  verifyAdmin,
  schemaValidation({ body: usuarioSchema.listaUsuario }),
  asyncHandler(async (req, res, next) => {
    const dados = await usuarioCtrl.resetaSenhas(req.body.usuarios)
    return res.sendJsonAndLog(
      true,
      'Senhas resetadas com sucesso. A senha de cada usuário passou a ser o login dele.',
      httpCode.OK,
      dados
    )
  })
)

router.put(
  '/:uuid',
  verifyAdmin,
  schemaValidation({
    body: usuarioSchema.updateUsuario,
    params: usuarioSchema.uuidParams
  }),
  asyncHandler(async (req, res, next) => {
    await usuarioCtrl.atualizaUsuario(req.params.uuid, req.body)
    return res.sendJsonAndLog(true, 'Usuário atualizado com sucesso', httpCode.OK)
  })
)

router.delete(
  '/:uuid',
  verifyAdmin,
  schemaValidation({ params: usuarioSchema.uuidParams }),
  asyncHandler(async (req, res, next) => {
    await usuarioCtrl.deletaUsuario(req.params.uuid)
    return res.sendJsonAndLog(true, 'Usuário excluído com sucesso', httpCode.OK)
  })
)

router.get(
  '/',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await usuarioCtrl.getUsuarios()
    return res.sendJsonAndLog(true, 'Usuários retornados', httpCode.OK, dados)
  })
)

// Cria a pessoa COM senha. Substitui o par importar/sincronizar que existia
// enquanto `dgeo.usuario` era um espelho do Auth Server.
router.post(
  '/',
  verifyAdmin,
  schemaValidation({ body: usuarioSchema.criaUsuario }),
  asyncHandler(async (req, res, next) => {
    const dados = await usuarioCtrl.criaUsuario(req.body)
    return res.sendJsonAndLog(true, 'Usuário criado com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/',
  verifyAdmin,
  schemaValidation({
    body: usuarioSchema.updateUsuarioLista
  }),
  asyncHandler(async (req, res, next) => {
    await usuarioCtrl.atualizaUsuarioLista(req.body.usuarios)
    return res.sendJsonAndLog(true, 'Usuários atualizados com sucesso', httpCode.OK)
  })
)

module.exports = router
