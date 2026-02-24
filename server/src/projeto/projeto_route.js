// Path: projeto\projeto_route.js
"use strict";

const express = require("express");

const { schemaValidation, asyncHandler, httpCode } = require("../utils");

const { verifyLogin, verifyAdmin } = require("../login");

const projetoCtrl = require("./projeto_ctrl");
const projetoSchema = require("./projeto_schema");

const router = express.Router();

router.get(
  '/projeto',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await projetoCtrl.getProjetos();

    const msg = 'Projetos retornados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/projeto',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.projeto
  }),
  asyncHandler(async (req, res, next) => {
    const result = await projetoCtrl.criaProjeto(req.body, req.usuarioUuid);

    return res.sendJsonAndLog(true, result.message, httpCode.Created, result);
  })
);

router.put(
  '/projeto',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.projetoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    const result = await projetoCtrl.atualizaProjeto(req.body, req.usuarioUuid);

    return res.sendJsonAndLog(true, result.message, httpCode.OK, result);
  })
);

router.delete(
  '/projeto',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.projetoIds
  }),
  asyncHandler(async (req, res, next) => {
    const result = await projetoCtrl.deleteProjetos(req.body.projeto_ids);

    return res.sendJsonAndLog(true, result.message, httpCode.OK, result);
  })
);

router.get(
  '/lote',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await projetoCtrl.getLotes();

    const msg = 'Lotes retornados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/lote',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.lote
  }),
  asyncHandler(async (req, res, next) => {
    const result = await projetoCtrl.criaLote(req.body, req.usuarioUuid);

    return res.sendJsonAndLog(true, result.message, httpCode.Created, result);
  })
);

router.put(
  '/lote',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.loteAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    const result = await projetoCtrl.atualizaLote(req.body, req.usuarioUuid);

    return res.sendJsonAndLog(true, result.message, httpCode.OK, result);
  })
);

router.delete(
  '/lote',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.loteIds
  }),
  asyncHandler(async (req, res, next) => {
    const result = await projetoCtrl.deleteLotes(req.body.lote_ids);

    return res.sendJsonAndLog(true, result.message, httpCode.OK, result);
  })
);

module.exports = router;