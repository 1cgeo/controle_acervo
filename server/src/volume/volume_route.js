"use strict";

const express = require("express");

const { schemaValidation, asyncHandler, httpCode } = require("../utils");

const { verifyAdmin } = require("../login");

const volumeCtrl = require("./volume_ctrl");
const volumeSchema = require("./volume_schema");

const router = express.Router();

router.get(
  '/volume_tipo_produto',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await volumeCtrl.getVolumeTipoProduto()

    const msg = 'Volume Tipo Produto retornada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.delete(
  '/volume_tipo_produto',
  verifyAdmin,
  schemaValidation({
    body: volumeSchema.volumeTipoProdutoIds
  }),
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.deleteVolumeTipoProduto(req.body.volume_tipo_produto_ids)

    const msg = 'Entradas do Volume Tipo Produto deletadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.post(
  '/volume_tipo_produto',
  verifyAdmin,
  schemaValidation({
    body: volumeSchema.volumeTipoProduto
  }),
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.criaVolumeTipoProduto(req.body.volume_tipo_produto)

    const msg = 'Entradas do Volume Tipo Produto criadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/volume_tipo_produto',
  verifyAdmin,
  schemaValidation({
    body: volumeSchema.volumeTipoProdutoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.atualizaVolumeTipoProduto(req.body.volume_tipo_produto)

    const msg = 'Entradas do Volume Tipo Produto atualizadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.get(
  '/volume_armazenamento',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await volumeCtrl.getVolumeArmazenamento()

    const msg = 'Volume de armazenamento retornada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.delete(
  '/volume_armazenamento',
  verifyAdmin,
  schemaValidation({
    body: volumeSchema.volumeArmazenamentoIds
  }),
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.deleteVolumeArmazenamento(req.body.volume_armazenamento_ids)

    const msg = 'Entradas do volume de armazenamento deletadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.post(
  '/volume_armazenamento',
  verifyAdmin,
  schemaValidation({
    body: volumeSchema.volumeArmazenamento
  }),
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.criaVolumeArmazenamento(req.body.volume_armazenamento)

    const msg = 'Entradas do volume de armazenamento criadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/volume_armazenamento',
  verifyAdmin,
  schemaValidation({
    body: volumeSchema.volumeArmazenamentoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await volumeCtrl.atualizaVolumeArmazenamento(req.body.volume_armazenamento)

    const msg = 'Entradas do volume de armazenamento atualizadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)


module.exports = router;
