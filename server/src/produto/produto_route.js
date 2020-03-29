"use strict";

const express = require("express");

const { schemaValidation, asyncHandler, httpCode } = require("../utils");

const { verifyLogin, verifyAdmin } = require("../login");

const produtoCtrl = require("./produto_ctrl");
const produtoSchema = require("./produto_schema");

const router = express.Router();

router.put(
  "/:id",
  schemaValidation({
    body: produtoSchema.produto,
    params: produtoSchema.idParams
  }),
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.updateProduto(req.params.id, req.body.volume);

    const msg = "Produto atualizado com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.delete(
  "/:id",
  schemaValidation({
    params: produtoSchema.idParams
  }),
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deletaProduto(req.params.id);

    const msg = "Produto deletado com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.post(
  "/",
  verifyAdmin,
  schemaValidation({ body: produtoSchema.produtos }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.criaProdutos(req.body.produtos);
    const msg = "Produtos adicionados com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.get(
  "/",
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await produtoCtrl.getProdutos();

    const msg = "Produtos retornados com sucesso";

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

module.exports = router;
