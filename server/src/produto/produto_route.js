// Path: produto\produto_route.js
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
    await produtoCtrl.atualizaProduto(req.body, req.usuarioUuid)

    const msg = 'Produto atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.put(
  '/versao',
  verifyAdmin,
  schemaValidation({
    body: produtoSchema.versaoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.atualizaVersao(req.body, req.usuarioUuid);

    const msg = 'Versão atualizada com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
)

router.delete(
  '/produto',
  verifyAdmin,
  schemaValidation({
    body: produtoSchema.produtoIds
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deleteProdutos(req.body.produto_ids, req.body.motivo_exclusao, req.usuarioUuid)
    const msg = 'Produtos deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/versao',
  verifyAdmin,
  schemaValidation({
    body: produtoSchema.versaoIds
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deleteVersoes(req.body.versao_ids, req.body.motivo_exclusao, req.usuarioUuid);
    const msg = 'Versões deletadas com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.post(
  '/versao_historica',
  verifyAdmin,
  schemaValidation({
    body: produtoSchema.versoesHistoricas
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.criaVersaoHistorica(req.body, req.usuarioUuid);

    const msg = 'Versões históricas criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.post(
  '/produto_versao_historica',
  verifyAdmin,
  schemaValidation({
    body: produtoSchema.produtosVersoesHistoricas
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.criaProdutoVersoesHistoricas(req.body, req.usuarioUuid);

    const msg = 'Produtos com versões históricas criados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.post(
  '/produtos',
  verifyLogin,
  schemaValidation({
    body: produtoSchema.produtos
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.bulkCreateProducts(req.body.produtos, req.usuarioUuid);

    const msg = 'Produtos criados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.get(
  '/versao_relacionamento',
  asyncHandler(async (req, res, next) => {
    const dados = await produtoCtrl.getVersaoRelacionamento();

    const msg = 'Versão Relacionamento retornada com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/versao_relacionamento',
  verifyAdmin,
  schemaValidation({
    body: produtoSchema.versaoRelacionamento
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.criaVersaoRelacionamento(req.body.versao_relacionamento, req.usuarioUuid );

    const msg = 'Entradas do Versão Relacionamento criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.put(
  '/versao_relacionamento',
  verifyAdmin,
  schemaValidation({
    body: produtoSchema.versaoRelacionamentoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.atualizaVersaoRelacionamento(req.body.versao_relacionamento, req.usuarioUuid );

    const msg = 'Entradas do Versão Relacionamento atualizadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.delete(
  '/versao_relacionamento',
  verifyAdmin,
  schemaValidation({
    body: produtoSchema.versaoRelacionamentoIds
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deleteVersaoRelacionamento(req.body.versao_relacionamento_ids);

    const msg = 'Entradas do Versão Relacionamento deletadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

module.exports = router;
