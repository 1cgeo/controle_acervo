'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyLogin, verifyAdmin } = require('../login')

const acervoCtrl = require('./acervo_ctrl')
const acervoSchema = require('./acervo_schema')

const router = express.Router()

router.get(
  '/estilo',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getEstilo()

    const msg = 'Estilo retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/download',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getDownload()

    const msg = 'Informação de download retornadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/tipo_produto',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getTipoProduto()

    const msg = 'Tipos de produto retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  'produto/tipo/:tipo_produto_id',
  schemaValidation({ 
    params: acervoSchema.produtoByTipoParams,
    query:  acervoSchema.produtoByTipoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { tipo_produto_id } = req.params;
    const { projeto_id, lote_id } = req.query;
    
    const dados = await produtoCtrl.getProdutosByTipo(
      tipo_produto_id, 
      projeto_id || null, 
      lote_id || null
    );
    const msg = 'Produtos retornados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  'produto/id/:produto_id',
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
  'produto/detailed/id/:produto_id',
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

router.get(
  '/arquivos_deletados',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getArquivosDeletados()

    const msg = 'Arquivos deletados retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/versao_historico',
  verifyAdmin,
  schemaValidation({
    body: acervoSchema.versaoHistorico
  }),
  asyncHandler(async (req, res, next) => {
    await acervoCtrl.criaVersaoHistorico(req.body, req.usuarioUuid);

    const msg = 'Versão histórica criada com sucesso';

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

module.exports = router
