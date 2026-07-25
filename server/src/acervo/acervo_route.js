// Path: acervo\acervo_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyAdmin, verifyPerfil } = require('../login')

const acervoCtrl = require('./acervo_ctrl')
const acervoSchema = require('./acervo_schema')

const router = express.Router()

router.get(
  '/camadas_produto',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
  
    const dados = await acervoCtrl.getProdutosLayer();
    const msg = 'Camadas de Produtos retornados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/produto/detalhado/:produto_id',
  verifyPerfil('consulta'),
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
  verifyPerfil('consulta'),
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
  verifyPerfil('consulta'),
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
  verifyPerfil('consulta'),
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
  verifyPerfil('consulta'),
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
  verifyPerfil('consulta'),
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
  verifyAdmin,
  verifyAdmin, // Only admin users can access this endpoint
  asyncHandler(async (req, res, next) => {
    await acervoCtrl.cleanupExpiredDownloads()

    const msg = 'Limpeza de downloads expirados realizada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.post(
  '/refresh_materialized_views',
  verifyAdmin,
  verifyAdmin,  // Apenas administradores podem executar esta operação
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.refreshAllMaterializedViews();
    const msg = 'Atualização de views materializadas concluída com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/create_materialized_views',
  verifyAdmin,
  verifyAdmin,  // Apenas administradores podem executar esta operação
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.createMaterializedViews();
    const msg = 'Criação de views materializadas concluída com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);


router.get(
  '/situacao-geral',
  verifyPerfil('consulta'),
  schemaValidation({
    query: acervoSchema.situacaoGeralQuery
  }),
  asyncHandler(async (req, res, next) => {
    // schemaValidation já converteu os params para boolean (Joi.boolean)
    const scales = {
      '25k': req.query.scale25k === true,
      '50k': req.query.scale50k === true,
      '100k': req.query.scale100k === true,
      '250k': req.query.scale250k === true
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
  '/export-planilha-csv',
  verifyPerfil('consulta'),
  schemaValidation({
    query: acervoSchema.situacaoGeralQuery
  }),
  asyncHandler(async (req, res, next) => {
    // Mesmo padrão da planilha de referência (vários CSV, um por escala+tipo)
    const scales = {
      '25k': req.query.scale25k === true,
      '50k': req.query.scale50k === true,
      '100k': req.query.scale100k === true,
      '250k': req.query.scale250k === true
    };

    // Se nenhuma escala for selecionada, exporta todas
    if (!scales['25k'] && !scales['50k'] && !scales['100k'] && !scales['250k']) {
      scales['25k'] = scales['50k'] = scales['100k'] = scales['250k'] = true;
    }

    const zipData = await acervoCtrl.getPlanilhaCSV(scales);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="planilha-acervo.zip"',
      'Content-Length': zipData.length
    });

    return res.send(zipData);
  })
);

router.get(
  '/busca',
  verifyPerfil('consulta'),
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

// Auditoria dos invariantes lógicos do acervo (as regras que o schema não
// consegue exprimir). Leitura pura, em transação READ ONLY, mas exige admin:
// a saída expõe o formato do acervo inteiro e serve de mapa para quem for
// escrever nele.
//
// Nasceu como script no vault do Chefe da DGEO, que abria conexão direta ao
// banco de produção com um usuário read-only. Trazer para cá tira a credencial
// de banco de fora do sistema e, mais importante, põe os invariantes ao lado do
// schema que eles descrevem: o mesmo commit que muda um domínio pode corrigir a
// regra, e o teste acusa quando não corrige.
router.get(
  '/auditoria',
  verifyPerfil('gerente'),
  schemaValidation({ query: acervoSchema.auditoriaQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.getAuditoria({
      severidade: req.query.severidade,
      codigos: req.query.codigos ? req.query.codigos.split(',') : null,
      amostra: req.query.amostra
    })

    const msg = 'Auditoria de invariantes do acervo realizada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router
