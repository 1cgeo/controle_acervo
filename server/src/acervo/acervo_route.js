'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyLogin, verifyAdmin } = require('../login')

const acervoCtrl = require('./acervo_ctrl')
const acervoSchema = require('./acervo_schema')

const router = express.Router()

router.get(
  '/camadas_produto',
  asyncHandler(async (req, res, next) => {
  
    const dados = await produtoCtrl.getProdutosLayer();
    const msg = 'Camadas de Produtos retornados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/produto/id/:produto_id',
  verifyLogin,
  schemaValidation({ 
    params: acervoSchema.produtoByIdParams
  }),
  asyncHandler(async (req, res, next) => {
    const { produto_id } = req.params;
    
    const dados = await produtoCtrl.getProdutoById(produto_id);

    const msg = 'Informações do produto retornadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/produto/detalhado/id/:produto_id',
  verifyLogin,
  schemaValidation({ 
    params: acervoSchema.produtoByIdParams
  }),
  asyncHandler(async (req, res, next) => {
    const { produto_id } = req.params;
    
    const dados = await produtoCtrl.getProdutoDetailedById(produto_id);

    const msg = 'Informações detalhadas do produto retornadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/download/arquivos',
  verifyLogin,
  schemaValidation({ body: acervoSchema.arquivosIds }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.downloadInfo(
      req.body.arquivos_id,
      req.usuarioUuid
    )

    const msg = 'Informação de download cadastrada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/download/produtos',
  verifyLogin,
  schemaValidation({ body: acervoSchema.produtosIds }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.downloadInfoByProdutos(
      req.body.produtos_ids,
      req.usuarioUuid
    )

    const msg = 'Informação de download dos produtos cadastrada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/versao_historica',
  verifyAdmin,
  schemaValidation({
    body: acervoSchema.versoesHistoricas
  }),
  asyncHandler(async (req, res, next) => {
    await acervoCtrl.criaVersaoHistorica(req.body, req.usuarioUuid);

    const msg = 'Versões históricas criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.post(
  '/produto_versao_historica',
  verifyAdmin,
  schemaValidation({
    body: acervoSchema.produtosVersoesHistoricas
  }),
  asyncHandler(async (req, res, next) => {
    await acervoCtrl.criaProdutoVersaoHistorica(req.body, req.usuarioUuid);

    const msg = 'Produtos com versões históricas criados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.post(
  '/produtos_multiplos_arquivos',
  verifyLogin,
  schemaValidation({
    body: acervoSchema.produtosMultiplosArquivos
  }),
  asyncHandler(async (req, res, next) => {
    await acervoCtrl.bulkCreateProductsWithVersionAndMultipleFiles(req.body.produtos, req.usuarioUuid);

    const msg = 'Produtos com versões e múltiplos arquivos criados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.post(
  '/sistematico_versoes_multiplos_arquivos',
  verifyLogin,
  schemaValidation({
    body: acervoSchema.sistematicoVersoesMultiplosArquivos
  }),
  asyncHandler(async (req, res, next) => {
    const results = await acervoCtrl.bulkSistematicCreateVersionWithFiles(req.body.versoes, req.usuarioUuid);

    const msg = 'Versões de produtos sistemáticos com múltiplos arquivos criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created, results);
  })
);

router.post(
  '/versoes_multiplos_arquivos',
  verifyLogin,
  schemaValidation({
    body: acervoSchema.versoesMultiplosArquivos
  }),
  asyncHandler(async (req, res, next) => {
    const results = await acervoCtrl.bulkCreateVersionWithFiles(req.body.versoes, req.usuarioUuid);

    const msg = 'Versões com múltiplos arquivos criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created, results);
  })
);

router.post(
  '/multiplos_arquivos',
  verifyLogin,
  schemaValidation({
    body: acervoSchema.multiplosArquivos
  }),
  asyncHandler(async (req, res, next) => {
    const results = await acervoCtrl.bulkAddFilesToVersion(req.body.arquivos_por_versao, req.usuarioUuid);

    const msg = 'Múltiplos arquivos adicionados às versões com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created, results);
  })
);

router.post(
  '/produtos',
  verifyLogin,
  schemaValidation({
    body: acervoSchema.produtos
  }),
  asyncHandler(async (req, res, next) => {
    await acervoCtrl.bulkCreateProducts(req.body.produtos, req.usuarioUuid);

    const msg = 'Produtos criados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

module.exports = router
