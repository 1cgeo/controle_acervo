"use strict";

const express = require("express");

const { schemaValidation, asyncHandler, httpCode } = require("../utils");

const { verifyLogin, verifyAdmin } = require("../login");

const produtoCtrl = require("./produto_ctrl");
const produtoSchema = require("./produto_schema");

const router = express.Router();

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

router.put(
  '/versao',
  verifyAdmin,
  schemaValidation({
    body: versaoSchema.versaoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await versaoCtrl.atualizaVersao(req.body, req.usuarioId);

    const msg = 'Versão atualizada com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
)

router.put(
  '/arquivo',
  verifyAdmin,
  schemaValidation({
    body: arquivoSchema.arquivoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await arquivoCtrl.atualizaArquivo(req.body, req.usuarioId);

    const msg = 'Arquivo atualizado com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.delete(
  '/produto',
  schemaValidation({
    body: produtoSchema.produtoIds
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deleteProdutos(req.body.produto_ids, req.body.motivo_exclusao, req.usuarioId)
    const msg = 'Produtos deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/versao',
  schemaValidation({
    body: versaoSchema.versaoIds
  }),
  asyncHandler(async (req, res, next) => {
    await versaoCtrl.deleteVersoes(req.body.versao_ids, req.body.motivo_exclusao, req.usuarioId);
    const msg = 'Versões deletadas com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

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

router.delete(
  '/arquivo',
  schemaValidation({
    body: arquivoSchema.arquivoIds
  }),
  asyncHandler(async (req, res, next) => {
    await arquivoCtrl.deleteArquivos(req.body.arquivo_ids, req.body.motivo_exclusao, req.usuarioId);
    const msg = 'Arquivos deletados com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

module.exports = router;
