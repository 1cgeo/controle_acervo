'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyLogin, verifyAdmin } = require('../login')

const acervoCtrl = require('./acervo_ctrl')
const acervoSchema = require('./acervo_schema')

const router = express.Router()

router.get(
  '/dominio/tipo_produto',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getTipoProduto()

    const msg = 'Domínio Tipos de produto retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/situacao_bdgex',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getSituacaoBDGEx()

    const msg = 'Domínio Situação no BDGEx retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_arquivo',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getTipoArquivo()

    const msg = 'Domínio Tipo de Arquivos retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_relacionamento',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getTipoRelacionamento()

    const msg = 'Domínio Tipo de Relacionamento retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_status_arquivo',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getTipoStatusArquivo()

    const msg = 'Domínio Tipo de Status do Arquivo retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_versao',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getTipoVersao()

    const msg = 'Domínio Tipo de Versão retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_status_execucao',
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getTipoStatusExecucao()

    const msg = 'Domínio Tipo de Status de Execução retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

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
  '/verificar_consistencia',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const resultados = await acervoCtrl.verificarConsistencia()

    const msg = 'Verificação de consistência concluída com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, resultados)
  })
)

router.get(
  '/arquivos_incorretos',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const arquivosIncorretos = await acervoCtrl.getArquivosIncorretos()

    const msg = 'Arquivos incorretos recuperados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, arquivosIncorretos)
  })
)

module.exports = router
