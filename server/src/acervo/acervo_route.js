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
  '/prepare-download/arquivos',
  verifyLogin,
  schemaValidation({ body: acervoSchema.arquivosIds }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.prepareDownload(
      req.body.arquivos_ids,
      req.usuarioUuid
    )

    const msg = 'Download preparado com sucesso. Utilize confirm-download para confirmar a conclusão da transferência.'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/prepare-download/produtos',
  verifyLogin,
  schemaValidation({ body: acervoSchema.produtosIds }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.prepareDownloadByProdutos(
      req.body.produtos_ids,
      req.usuarioUuid
    )

    const msg = 'Download preparado com sucesso. Utilize confirm-download para confirmar a conclusão da transferência.'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/confirm-download',
  verifyLogin,
  schemaValidation({ body: acervoSchema.downloadConfirmations }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.confirmDownload(
      req.body.confirmations
    )

    const msg = 'Status de download atualizado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/cleanup-expired-downloads',
  verifyAdmin, // Only admin users can access this endpoint
  asyncHandler(async (req, res, next) => {
    await acervoCtrl.cleanupExpiredDownloads()

    const msg = 'Limpeza de downloads expirados realizada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

module.exports = router
