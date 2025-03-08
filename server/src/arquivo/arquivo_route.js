// Path: arquivo\arquivo_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyLogin, verifyAdmin } = require('../login')

const arquivoCtrl = require('./arquivo_ctrl')
const arquivoSchema = require('./arquivo_schema')

const router = express.Router()

router.post(
  '/produtos_multiplos_arquivos',
  verifyLogin,
  schemaValidation({
    body: arquivoSchema.produtosMultiplosArquivos
  }),
  asyncHandler(async (req, res, next) => {
    await arquivoCtrl.bulkCreateProductsWithVersionAndMultipleFiles(req.body.produtos, req.usuarioUuid);

    const msg = 'Produtos com versões e múltiplos arquivos criados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.post(
  '/verifica_sistematico_versoes_multiplos_arquivos',
  verifyLogin,
  schemaValidation({
    body: arquivoSchema.sistematicoVersoesMultiplosArquivos
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.verifica_sistematico_versoes_multiplos_arquivos(req.body.versoes);
    const msg = 'Verificação de carregamento sistemático concluída com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/sistematico_versoes_multiplos_arquivos',
  verifyLogin,
  schemaValidation({
    body: arquivoSchema.sistematicoVersoesMultiplosArquivos
  }),
  asyncHandler(async (req, res, next) => {
    const results = await arquivoCtrl.bulkSistematicCreateVersionWithFiles(req.body.versoes, req.usuarioUuid);

    const msg = 'Versões de produtos sistemáticos com múltiplos arquivos criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created, results);
  })
);

router.post(
  '/versoes_multiplos_arquivos',
  verifyLogin,
  schemaValidation({
    body: arquivoSchema.versoesMultiplosArquivos
  }),
  asyncHandler(async (req, res, next) => {
    const results = await arquivoCtrl.bulkCreateVersionWithFiles(req.body.versoes, req.usuarioUuid);

    const msg = 'Versões com múltiplos arquivos criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created, results);
  })
);

router.post(
  '/multiplos_arquivos',
  verifyLogin,
  schemaValidation({
    body: arquivoSchema.multiplosArquivos
  }),
  asyncHandler(async (req, res, next) => {
    const results = await arquivoCtrl.bulkAddFilesToVersion(req.body.arquivos_por_versao, req.usuarioUuid);

    const msg = 'Múltiplos arquivos adicionados às versões com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created, results);
  })
);

module.exports = router
