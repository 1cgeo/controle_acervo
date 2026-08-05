'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, logger, enviarArquivo, AppError } = require('../utils')

const { verifyAdmin, verifyPerfil } = require('../login')

const acervoCtrl = require('./acervo_ctrl')
const acervoSchema = require('./acervo_schema')
const miniaturaVarredura = require('../utils/miniatura_varredura')

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

/**
 * Miniatura da versão, para a ficha do produto.
 *
 * Responde a IMAGEM crua, e não o envelope JSON: quem consome é uma tag de
 * imagem, não um leitor de `dados`.
 *
 * CACHE. O `noCache()` do app manda "não guarde nada", e vale para dado que
 * muda. A miniatura é derivada e praticamente imutável, e a ficha reabre a cada
 * produto percorrido na seleção: sem cache, a mesma imagem viajaria de novo a
 * cada volta. Por isso esta rota DESFAZ os cabeçalhos do `noCache` e põe os
 * seus. A etiqueta sai da data de geração e do tamanho, então regerar a
 * miniatura invalida o que o navegador guardou, sem ninguém precisar lembrar.
 *
 * Versão sem miniatura responde 404, e é caso NORMAL: produto só vetorial não
 * tem imagem. A tela evita a viagem lendo `tem_miniatura` na ficha detalhada; o
 * 404 é a rede de segurança para quem chama a rota direto.
 */
router.get(
  '/versao/:versao_id/miniatura',
  verifyPerfil('consulta'),
  schemaValidation({
    params: acervoSchema.miniaturaVersaoParams
  }),
  asyncHandler(async (req, res, next) => {
    const { versao_id } = req.params;

    const meta = await acervoCtrl.getMiniaturaMeta(versao_id);

    if (!meta || !meta.bytes) {
      throw new AppError(
        'Esta versão não tem miniatura',
        httpCode.NotFound
      );
    }

    const etag = `"${new Date(meta.data_geracao).getTime()}-${meta.bytes}"`;

    // O noCache() roda antes das rotas, então estes cabeçalhos já existem e
    // precisam sair: Pragma e Expires contradizem o Cache-Control abaixo, e
    // navegador que vê a contradição escolhe o mais conservador.
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.removeHeader('Surrogate-Control');

    // `private` porque a imagem exige perfil: ela não pode ficar num cache
    // compartilhado. Um dia de validade, e depois revalidação pela etiqueta.
    res.setHeader('Cache-Control', 'private, max-age=86400, must-revalidate');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(httpCode.NotModified).end();
    }

    const conteudo = await acervoCtrl.getMiniaturaConteudo(versao_id);

    if (!conteudo) {
      throw new AppError('Esta versão não tem miniatura', httpCode.NotFound);
    }

    res.setHeader('Content-Type', `image/${meta.formato}`);
    res.setHeader('Content-Length', String(conteudo.length));

    return res.status(httpCode.OK).end(conteudo);
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

// Download de UM arquivo pelo navegador.
//
// É o caminho WEB, e conviver com o par prepare/confirm-download abaixo é
// deliberado: aquele devolve o CAMINHO do volume para o plugin do QGIS copiar do
// share, o que só funciona em máquina que monta o share. Aqui o servidor lê o
// volume e faz stream, e o navegador nunca vê caminho de rede. Nenhum volume
// precisa de servidor HTTP: volume é caminho de sistema de arquivos.
//
// Não há pasta temporária no caminho: um arquivo do acervo tem mediana de 6 a
// 11 MB e máximo de 500 MB (medido na produção em 2026-07-29), então copiar para
// servir dobraria I/O e criaria lixo para limpar. Pacote de VÁRIOS arquivos é
// outro problema, e aí sim pede preparo assíncrono.
router.get(
  '/arquivo/:uuid_arquivo/download',
  verifyPerfil('consulta'),
  schemaValidation({
    params: acervoSchema.arquivoDownloadParams
  }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await acervoCtrl.getArquivoParaDownload(req.params.uuid_arquivo)

    // A auditoria é escrita DEPOIS da entrega, e falhar nela não pode estragar um
    // arquivo que já chegou: neste ponto a resposta acabou, e lançar aqui faria o
    // Express tentar responder erro sobre uma resposta encerrada.
    const registrar = async (desfecho) => {
      try {
        await acervoCtrl.registrarDownloadWeb(arquivo.arquivo_id, req.usuarioUuid, desfecho)
      } catch (erroRegistro) {
        logger.error('Falha ao registrar o download na auditoria', {
          information: { arquivo: arquivo.nome, erro: erroRegistro.message }
        })
      }
    }

    try {
      const { bytes, parcial } = await enviarArquivo.enviarArquivoDoVolume(req, res, arquivo)
      await registrar({ sucesso: true })
      logger.info('Download de arquivo do acervo', {
        information: { arquivo: arquivo.nome, bytes, parcial }
      })
    } catch (erro) {
      // Registra falha SÓ se a transferência começou de verdade (cabeçalho já
      // enviado). Pedido recusado antes disso, como faixa de bytes inválida, não
      // é download falhado: é requisição inválida, e virar linha na auditoria
      // encheria a tabela de coisa que nunca saiu do servidor.
      if (res.headersSent) {
        await registrar({ sucesso: false, erro: erro.message })
      }
      throw erro
    }
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

// Limpeza do que expirou: downloads E uploads. Era o cron de hora em hora, que
// saiu em 2026-08-04; agora tem sempre uma pessoa por trás, e ela aparece no
// rastro. `verifyAdmin` UMA vez: estava duplicado, o que não protegia mais e
// sugeria uma segunda checagem que não existe.
router.post(
  '/cleanup-expired-downloads',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    // O retorno era DESCARTADO, e a tela anunciava sucesso sem número: a
    // confirmação era eco da chamada, e não medida do que mudou.
    const dados = await acervoCtrl.cleanupExpiredDownloads(req.usuarioUuid, req.contexto)

    const parte = (n, um, varios) => (n === 1 ? `1 ${um}` : `${n} ${varios}`)
    const msg = `${parte(dados.fechados, 'download expirado fechado', 'downloads expirados fechados')}`
      + `, ${parte(dados.uploads_fechados, 'sessão de upload expirada fechada', 'sessões de upload expiradas fechadas')}`

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Varredura da fila de miniaturas. Era o cron da meia hora.
//
// A miniatura NÃO é gerada no cadastro de propósito: renderizar custa segundos e
// roda processo externo, dentro da transação que confirma o upload. Então a fila
// existe, e desde que o cron saiu ela é dívida VISÍVEL: o GET diz quantas
// versões esperam, e o POST paga um lote.
router.get(
  '/miniaturas/pendentes',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const pendentes = await miniaturaVarredura.contarPendentes()

    return res.sendJsonAndLog(
      true,
      pendentes === 1
        ? '1 versão aguarda miniatura'
        : `${pendentes} versões aguardam miniatura`,
      httpCode.OK,
      { pendentes, lote: miniaturaVarredura.LOTE }
    )
  })
)

router.post(
  '/miniaturas/varrer',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    // Pelo controller, e não direto pelo util: é ele que registra quem mandou
    // rodar, do mesmo jeito que o refresh das views materializadas.
    const dados = await acervoCtrl.varrerMiniaturas(req.usuarioUuid, req.contexto)

    // Três desfechos distintos, e a tela precisa saber qual foi. "Pulada" é
    // outra varredura em curso, e anunciar sucesso ali seria anunciar trabalho
    // que não aconteceu.
    if (dados.pulada) {
      return res.sendJsonAndLog(
        true,
        'Uma varredura já está em curso. Nada foi feito agora.',
        httpCode.OK,
        dados
      )
    }
    if (dados.abortada) {
      return res.sendJsonAndLog(
        true,
        `Varredura interrompida: ${dados.abortada}. ${dados.sucessos} miniatura(s) gerada(s) antes disso.`,
        httpCode.OK,
        dados
      )
    }

    const msg = `${dados.sucessos} miniatura(s) gerada(s), ${dados.falhas} falha(s)`
      + `, ${dados.restante} na fila`

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/refresh_materialized_views',
  verifyAdmin,
  verifyAdmin,  // Apenas administradores podem executar esta operação
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.refreshAllMaterializedViews(req.usuarioUuid, req.contexto);
    const msg = 'Atualização de views materializadas concluída com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/create_materialized_views',
  verifyAdmin,
  verifyAdmin,  // Apenas administradores podem executar esta operação
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.createMaterializedViews(req.usuarioUuid, req.contexto);
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
    
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="situacao-geral.zip"',
      'Content-Length': zipData.length
    });
    
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

// Opcoes dos filtros da busca, com o quantitativo de produtos de cada uma.
//
// Rota separada das feicoes de proposito: a tela pede as duas em paralelo, e
// juntar faria a lista de opcoes esperar a busca inteira para aparecer.
router.get(
  '/busca/facetas',
  verifyPerfil('consulta'),
  schemaValidation({
    query: acervoSchema.buscaFacetas
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.buscaFacetas(req.query);

    return res.sendJsonAndLog(
      true,
      'Opções dos filtros da busca retornadas com sucesso',
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
