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
    // O Joi ja validou e normalizou tudo; passar o objeto inteiro evita a fila
    // de argumentos posicionais que ja custou um 500 quando um filtro novo
    // entrou no meio dela.
    const dados = await acervoCtrl.buscaProdutos(req.query);

    const msg = 'Busca de produtos realizada com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

// Camada do mapa: os MESMOS filtros da busca, sem paginacao.
//
// Rota separada de proposito. A lista pagina porque ninguem le 800 cartoes; o
// mapa NAO pode paginar, porque 20 poligonos numa tela de 800 resultados
// afirmam visualmente que o acervo tem 20 cartas ali.
router.get(
  '/busca/geometrias',
  verifyPerfil('consulta'),
  schemaValidation({
    query: acervoSchema.buscaGeometrias
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.buscaGeometrias(req.query);

    return res.sendJsonAndLog(
      true,
      'Geometrias da busca retornadas com sucesso',
      httpCode.OK,
      dados
    );
  })
);

// CSV do resultado da busca, ou so dos produtos selecionados (`ids`).
//
// Sai como arquivo, e nao como JSON: o destino e a planilha de quem pediu, e o
// navegador ja sabe salvar `text/csv` com Content-Disposition.
router.get(
  '/busca/csv',
  verifyPerfil('consulta'),
  schemaValidation({
    query: acervoSchema.buscaCsv
  }),
  asyncHandler(async (req, res, next) => {
    const csv = await acervoCtrl.buscaCsv(req.query);

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="busca-acervo.csv"'
    });

    return res.send(csv);
  })
);

// Sugestao de palavras-chave para a busca. Consulta, como o resto da leitura do
// acervo: quem pode buscar pode saber por quais etiquetas buscar.
router.get(
  '/palavras_chave',
  verifyPerfil('consulta'),
  schemaValidation({
    query: acervoSchema.palavrasChave
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.palavrasChave(
      req.query.termo,
      req.query.limit || 20
    );

    return res.sendJsonAndLog(
      true,
      'Palavras-chave retornadas com sucesso',
      httpCode.OK,
      dados
    );
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
