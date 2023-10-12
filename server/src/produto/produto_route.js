"use strict";

const express = require("express");

const { schemaValidation, asyncHandler, httpCode } = require("../utils");

const { verifyLogin, verifyAdmin } = require("../login");

const produtoCtrl = require("./produto_ctrl");
const produtoSchema = require("./produto_schema");

const router = express.Router();

router.post(
  '/produto',
  verifyAdmin, 
  schemaValidation({
    body: produtoSchema.produto
  }),
  asyncHandler(async (req, res, next) => {
    const data = await produtoCtrl.criaProduto(req.body, req.usuarioId)

    const msg = 'Produto criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, data)
  })
)

router.put(
  '/produto',
  verifyAdmin,
  schemaValidation({
    body: produtoSchema.produtoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.atualizaProduto(req.body, req.usuarioId)

    const msg = 'Produto atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/produto',
  schemaValidation({
    body: produtoSchema.produtoIds
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deleteProdutos(req.body.produto_ids, req.usuarioId)
    const msg = 'Produtos deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/arquivo',
  schemaValidation({
    body: produtoSchema.arquivoIds
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deleteArquivos(req.body.arquivo_ids, req.usuarioId)
    const msg = 'Arquivos deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router;
