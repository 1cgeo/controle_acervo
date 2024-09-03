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
  
    const dados = await acervoCtrl.getProdutosLayer();
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
    
    const dados = await acervoCtrl.getProdutoById(produto_id);

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
    
    const dados = await acervoCtrl.getProdutoDetailedById(produto_id);

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
