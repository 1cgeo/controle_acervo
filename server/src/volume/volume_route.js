"use strict";

const express = require("express");

const { schemaValidation, asyncHandler, httpCode } = require("../utils");

const { verifyAdmin } = require("../login");

const volumeCtrl = require("./volume_ctrl");
const volumeSchema = require("./volume_schema");

const router = express.Router();

router.put(
  "/associacao/:id",
  schemaValidation({
    body: volumeSchema.volumeTipoProduto,
    params: volumeSchema.idParams
  }),
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.updateAssociacao(
      req.params.id,
      req.body.tipo_produto_id,
      req.body.volume_armazenamento_id,
      req.body.primario
    );

    const msg = "Associação do volume atualizada com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.delete(
  "/associacao/:id",
  schemaValidation({
    params: volumeSchema.idParams
  }),
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.deletaAssociacao(req.params.id);

    const msg = "Associação deletada com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.post(
  "/associacao",
  verifyAdmin,
  schemaValidation({ body: volumeSchema.volumeTipoProduto }),
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.associaVolume(
      req.body.tipo_produto_id,
      req.body.volume_armazenamento_id,
      req.body.primario
    );
    const msg = "Associação adicionada com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.put(
  "/:id",
  schemaValidation({
    body: volumeSchema.volume,
    params: volumeSchema.idParams
  }),
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.updateVolume(req.params.id, req.body.volume);

    const msg = "Volume de armazenamento atualizado com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.delete(
  "/:id",
  schemaValidation({
    params: volumeSchema.idParams
  }),
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.deletaVolume(req.params.id);

    const msg = "Volume de armazenamento deletado com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.get(
  "/",
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await volumeCtrl.getVolumes();

    const msg = "Volumes de armazenamento retornados com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  "/",
  verifyAdmin,
  schemaValidation({ body: volumeSchema.volume }),
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.criaVolume(req.body.volume);
    const msg = "Volume de armazenamento adicionado com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

module.exports = router;
