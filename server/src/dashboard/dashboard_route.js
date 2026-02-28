// Path: dashboard\dashboard_route.js
'use strict'

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

const { verifyLogin } = require('../login')

const dashboardCtrl = require('./dashboard_ctrl')

const router = express.Router()

router.get(
  '/produtos_total',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalProdutos();
  const msg = 'Total de produtos retornado com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/arquivos_total_gb',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalArquivosGb();
  const msg = 'Total de gb retornado com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/produtos_tipo',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getProdutosPorTipo();
  const msg = 'Total de produtos por tipo com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/gb_tipo_produto',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getGbPorTipoProduto();
  const msg = 'Gb por tipo de produto retornado com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/usuarios_total',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalUsuarios();
  const msg = 'Total de usuários retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/arquivos_dia',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getArquivosPorDia();
  const msg = 'Arquivos carregados por dia retornadas com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/downloads_dia',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getDownloadsPorDia();
  const msg = 'Download por dia retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/gb_volume',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getGbPorVolume();
  const msg = 'Gb por volume retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/ultimos_carregamentos',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getUltimosCarregamentos();
  const msg = 'Ultimos carregamentos de arquivo retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/ultimas_modificacoes',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getUltimasModificacoes();
  const msg = 'Ultimas modificações de arquivo retornadas com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/ultimos_deletes',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getUltimosDeletes();
  const msg = 'Ultimos delete de arquivo retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/download',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getDownload()

    const msg = 'Informação de download retornadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/produto_activity_timeline',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const months = req.query.months ? parseInt(req.query.months) : 12;
    const dados = await dashboardCtrl.getProdutoActivityTimeline(months);
    const msg = 'Timeline de atividade de produtos retornada com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/version_statistics',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getVersionStatistics();
    const msg = 'Estatísticas de versões retornadas com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/storage_growth_trends',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const months = req.query.months ? parseInt(req.query.months) : 12;
    const dados = await dashboardCtrl.getStorageGrowthTrends(months);
    const msg = 'Tendências de crescimento de armazenamento retornadas com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/project_status_summary',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getProjectStatusSummary();
    const msg = 'Resumo de status de projetos retornado com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/user_activity_metrics',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const dados = await dashboardCtrl.getUserActivityMetrics(limit);
    const msg = 'Métricas de atividade de usuários retornadas com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/system_health',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getSystemHealth()
    const msg = 'Resumo de saude do sistema retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/produtos_escala',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getProdutosPorEscala()
    const msg = 'Produtos por escala retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/arquivos_tipo_arquivo',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getArquivosPorTipoArquivo()
    const msg = 'Arquivos por tipo retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/situacao_carregamento',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getSituacaoCarregamento()
    const msg = 'Situacao de carregamento retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/versao_activity_timeline',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const months = req.query.months ? parseInt(req.query.months) : 12
    const dados = await dashboardCtrl.getVersaoActivityTimeline(months)
    const msg = 'Timeline de atividade de versoes retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/ultimos_produtos',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getUltimosProdutos()
    const msg = 'Ultimos produtos retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/ultimas_versoes',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getUltimasVersoes()
    const msg = 'Ultimas versoes retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router