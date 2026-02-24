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
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  
    const dados = await acervoCtrl.getProdutosLayer();
    const msg = 'Camadas de Produtos retornados com sucesso';

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
  '/versao/:versao_id',
  verifyLogin,
  schemaValidation({
    params: acervoSchema.versaoByIdParams
  }),
  asyncHandler(async (req, res, next) => {
    const { versao_id } = req.params;

    const dados = await acervoCtrl.getVersaoById(versao_id);

    const msg = 'Informações da versão retornadas com sucesso';

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
  schemaValidation({ body: acervoSchema.produtosIdsComTipos }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.prepareDownloadByProdutos(
      req.body.produtos_ids,
      req.body.tipos_arquivo,
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

router.post(
  '/refresh_materialized_views',
  verifyAdmin,  // Apenas administradores podem executar esta operação
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.refreshAllMaterializedViews();
    const msg = 'Atualização de views materializadas concluída com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/create_materialized_views',
  verifyAdmin,  // Apenas administradores podem executar esta operação
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.createMaterializedViews();
    const msg = 'Criação de views materializadas concluída com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);


router.get(
  '/situacao-geral',
  verifyLogin,
  schemaValidation({
    query: acervoSchema.situacaoGeralQuery
  }),
  asyncHandler(async (req, res, next) => {
    // Extract scale parameters from query
    const scales = {
      '25k': req.query.scale25k === 'true',
      '50k': req.query.scale50k === 'true',
      '100k': req.query.scale100k === 'true',
      '250k': req.query.scale250k === 'true'
    };
    
    // If no scales are selected, use all scales
    if (!scales['25k'] && !scales['50k'] && !scales['100k'] && !scales['250k']) {
      scales['25k'] = scales['50k'] = scales['100k'] = scales['250k'] = true;
    }
    
    const zipData = await acervoCtrl.getSituacaoGeralJSON(scales);
    
    // Set appropriate headers for ZIP file download
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="situacao-geral.zip"',
      'Content-Length': zipData.length
    });
    
    // Send the ZIP file directly
    return res.send(zipData);
  })
);

router.get(
  '/busca',
  verifyLogin,
  schemaValidation({
    query: acervoSchema.buscaProdutos
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.buscaProdutos(
      req.query.termo,
      req.query.tipo_produto_id,
      req.query.tipo_escala_id,
      req.query.projeto_id,
      req.query.lote_id,
      req.query.page || 1,
      req.query.limit || 20
    );

    const msg = 'Busca de produtos realizada com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

module.exports = router
