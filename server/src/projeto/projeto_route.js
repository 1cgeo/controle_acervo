// Path: projeto\projeto_route.js
"use strict";

const express = require("express");

const { schemaValidation, asyncHandler, httpCode } = require("../utils");

const { verifyAdmin } = require("../login");

const projetoCtrl = require("./projeto_ctrl");
const projetoSchema = require("./projeto_schema");

const router = express.Router();

router.get(
  '/projeto',
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
    await projetoCtrl.criaProjeto(req.body, req.usuarioUuid);

    const msg = 'Projeto criado com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.put(
  '/projeto',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.projetoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await projetoCtrl.atualizaProjeto(req.body, req.usuarioUuid);

    const msg = 'Projeto atualizado com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.delete(
  '/projeto',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.projetoIds
  }),
  asyncHandler(async (req, res, next) => {
    await projetoCtrl.deleteProjetos(req.body.projeto_ids);

    const msg = 'Projetos deletados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.get(
  '/lote',
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
    await projetoCtrl.criaLote(req.body, req.usuarioUuid);

    const msg = 'Lote criado com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.put(
  '/lote',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.loteAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await projetoCtrl.atualizaLote(req.body, req.usuarioUuid);

    const msg = 'Lote atualizado com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.delete(
  '/lote',
  verifyAdmin,
  schemaValidation({
    body: projetoSchema.loteIds
  }),
  asyncHandler(async (req, res, next) => {
    await projetoCtrl.deleteLotes(req.body.lote_ids);

    const msg = 'Lotes deletados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

module.exports = router;
