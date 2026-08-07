'use strict'

const express = require('express')

const { asyncHandler, httpCode, schemaValidation } = require('../utils')

const { verifyPerfil } = require('../login')

const dashboardCtrl = require('./dashboard_ctrl')
const dashboardSchema = require('./dashboard_schema')

const router = express.Router()

router.get(
  '/produtos_total',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalProdutos();
  const msg = 'Total de produtos retornado com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/arquivos_total_gb',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalArquivosGb();
  const msg = 'Total de gb retornado com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

// A PRODUZIR: a folha prometida que ainda nao virou edicao regular.
//
// CONSULTA, como o resto deste arquivo, e o recorte e o ACERVO: quem consulta o
// acervo ve o acervo. A grade de metas, o lote em andamento e o Extra-PIT, que a
// aba "Plano do Ano" juntava aqui, moram nas telas do PIT e da administracao do
// acervo, cada uma com o guarda que lhe cabe.
//
// SEM PARAMETRO DE ANO. A versao planejada e um ESTADO, e nao um fato datado: a
// folha prometida para dezembro continua devida em janeiro. O `ano` que esta
// rota exigia nunca entrou nesta consulta, e so servia aos blocos que sairam.
router.get(
  '/a_produzir',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getAProduzir()
    const msg = 'Versões planejadas retornadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  }))

router.get(
  '/produtos_tipo',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getProdutosPorTipo();
  const msg = 'Total de produtos por tipo com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/gb_tipo_produto',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getGbPorTipoProduto();
  const msg = 'Gb por tipo de produto retornado com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/usuarios_total',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getTotalUsuarios();
  const msg = 'Total de usuários retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/arquivos_dia',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getArquivosPorDia();
  const msg = 'Arquivos carregados por dia retornadas com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/downloads_dia',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getDownloadsPorDia();
  const msg = 'Download por dia retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/gb_volume',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getGbPorVolume();
  const msg = 'Gb por volume retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

// As tres abaixo aceitam `total`, e o `acervo_cli` ja o oferece
// (`recursos.js`, query: 'totalQuery'). Sem a validacao e sem o repasse ao
// controlador, quem pedia 50 recebia 10 com 200 e sem aviso.
router.get(
  '/ultimos_carregamentos',
  verifyPerfil('consulta'),
  schemaValidation({ query: dashboardSchema.totalQuery }),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getUltimosCarregamentos(req.query.total);
  const msg = 'Ultimos carregamentos de arquivo retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/ultimas_modificacoes',
  verifyPerfil('consulta'),
  schemaValidation({ query: dashboardSchema.totalQuery }),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getUltimasModificacoes(req.query.total);
  const msg = 'Ultimas modificações de arquivo retornadas com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/ultimos_deletes',
  verifyPerfil('consulta'),
  schemaValidation({ query: dashboardSchema.totalQuery }),
  asyncHandler(async (req, res, next) => {
  const dados = await dashboardCtrl.getUltimosDeletes(req.query.total);
  const msg = 'Ultimos delete de arquivo retornados com sucesso'

  return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
}));

router.get(
  '/download',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getDownload()

    const msg = 'Informação de download retornadas com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/produto_activity_timeline',
  verifyPerfil('consulta'),
  schemaValidation({ query: dashboardSchema.timelineParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getProdutoActivityTimeline(req.query.months);
    const msg = 'Timeline de atividade de produtos retornada com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/version_statistics',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getVersionStatistics();
    const msg = 'Estatísticas de versões retornadas com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/storage_growth_trends',
  verifyPerfil('consulta'),
  schemaValidation({ query: dashboardSchema.timelineParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getStorageGrowthTrends(req.query.months);
    const msg = 'Tendências de crescimento de armazenamento retornadas com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/project_status_summary',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getProjectStatusSummary();
    const msg = 'Resumo de status de projetos retornado com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/user_activity_metrics',
  verifyPerfil('consulta'),
  schemaValidation({ query: dashboardSchema.limitParam }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getUserActivityMetrics(req.query.limit);
    const msg = 'Métricas de atividade de usuários retornadas com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.get(
  '/system_health',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getSystemHealth()
    const msg = 'Resumo de saude do sistema retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/produtos_escala',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getProdutosPorEscala()
    const msg = 'Produtos por escala retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/arquivos_tipo_arquivo',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getArquivosPorTipoArquivo()
    const msg = 'Arquivos por tipo retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/situacao_carregamento',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getSituacaoCarregamento()
    const msg = 'Situacao de carregamento retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/versao_activity_timeline',
  verifyPerfil('consulta'),
  schemaValidation({ query: dashboardSchema.timelineParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getVersaoActivityTimeline(req.query.months)
    const msg = 'Timeline de atividade de versoes retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/ultimos_produtos',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getUltimosProdutos()
    const msg = 'Ultimos produtos retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/ultimas_versoes',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await dashboardCtrl.getUltimasVersoes()
    const msg = 'Ultimas versoes retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router