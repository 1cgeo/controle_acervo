// Path: acervo\acervo_route.js
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
  '/produto/:produto_id',
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
  '/produto/detalhado/:produto_id',
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
      req.body.arquivos_ids,
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

module.exports = router
