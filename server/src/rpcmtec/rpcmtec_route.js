'use strict'

// Rotas do RPCMTec, o relatório mensal da Divisão.
//
// GUARDA DA EDIÇÃO: `verifyAdmin`, e não `verifyPerfil`. O relatório cruza os
// TRÊS módulos numa peça só, e traz valor de crédito, de empenho e de
// liquidação. Um `verifyPerfil('consulta', 'acervo')` entregaria o orçamento
// inteiro a quem só cataloga carta; e não existe "perfil de RPCMTec", porque não
// existe módulo RPCMTec -- ele é rota de PLATAFORMA, como usuários e views
// materializadas (ver CLAUDE.md, modelo de autorização). Quem assina o relatório
// é o chefe, e quem o gera administra o sistema.
//
// A CAPACITAÇÃO É A EXCEÇÃO, desde a 1.33.0, e ela mora aqui por endereço e não
// por natureza: capacitação é CADASTRO, e não relatório. Ela virou duas rotas,
// uma por tipo, com guardas diferentes. Ver o bloco dela mais abaixo.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, AppError } = require('../utils')
const { domainConstants: { TIPO_CAPACITACAO } } = require('../utils')
const { verifyAdmin, verifyPerfil } = require('../login')

const edicaoCtrl = require('./rpcmtec_edicao_ctrl')
const subsecaoCtrl = require('./rpcmtec_subsecao_ctrl')
const capacitacaoCtrl = require('./rpcmtec_capacitacao_ctrl')
const rpcmtecPdf = require('./rpcmtec_pdf')
const uploadAnexoEdicao = require('./anexo_edicao_upload')
const rpcmtecSchema = require('./rpcmtec_schema')
const anuarioCtrl = require('../mapoteca/anuario_ctrl')
const mapotecaRelatorioCtrl = require('../mapoteca/relatorio_ctrl')
const { gerarAnuarioOds } = require('./anuario_ods')
const { gerarRtmOds } = require('./rtm_ods')

const router = express.Router()

const doisDigitos = mes => String(mes).padStart(2, '0')

// ---------------------------------------------------------------------------
// Anuário Estatístico (Tabela 5.4.9)
//
// Sai junto do RPCMTec porque é a MESMA tarefa mensal: os dois sobem para a DSG
// no mesmo envio, do mesmo mês. Ele não é uma subseção do relatório, e por isso
// tem rota própria em vez de entrar no DOCX -- o destino dele é uma aba de
// planilha, não um parágrafo.
//
// Os dados vêm de `mapoteca/anuario_ctrl`, que é onde a entrega é registrada, e
// o arquivo sai da planilha-semente da DSG (ver rpcmtec/anuario_ods.js).
// ---------------------------------------------------------------------------

// Prévia em tela, no envelope JSON.
router.get(
  '/anuario',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await anuarioCtrl.getAnuarioEstatistico({
      ano: req.query.ano,
      mes: req.query.mes
    })

    return res.sendJsonAndLog(
      true, 'Anuário Estatístico gerado com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/anuario/ods',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    const { ano, mes } = req.query
    const anuario = await anuarioCtrl.getAnuarioEstatistico({ ano, mes })
    const buffer = gerarAnuarioOds(
      anuario,
      anuarioCtrl.COLUNAS_ANUARIO,
      anuarioCtrl.paraPlanilha(anuario)
    )

    // O nome segue o dos arquivos que já subiram para a DSG
    // (Anuario_Estatistico_1CGEO_06_Junho_2026.ods): número E nome do mês.
    const nome = `Anuario_Estatistico_1CGEO_${doisDigitos(mes)}_${anuarioCtrl.NOME_MES[mes - 1]}_${ano}.ods`
    res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// ---------------------------------------------------------------------------
// RTM: a aba META4_DETALHADA
//
// Sai daqui pelo mesmo motivo do Anuário: é a MESMA tarefa mensal, e os três
// arquivos (RPCMTec, Anuário e RTM) sobem para a DSG no mesmo envio. O dado vem
// de `mapoteca/relatorio_ctrl`, que é onde a impressão é registrada, e o arquivo
// sai da planilha-semente (ver rpcmtec/rtm_ods.js).
//
// A aba é do ANO inteiro, e não do mês: ela é o detalhamento da Meta 4 do PIT,
// e quem a cola no RTM cola o ano corrente. Por isso o `mes` é ignorado aqui.
// ---------------------------------------------------------------------------

router.get(
  '/rtm/ods',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    // O RTM e ACUMULADO ate o mes escolhido: 2026 com marco traz janeiro,
    // fevereiro e marco. E o unico download desta tela que acumula, e os outros
    // sao do MES.
    const { ano, mes } = req.query
    const dados = await mapotecaRelatorioCtrl.getRelatorioPedidosDetalhado(ano, mes)
    const buffer = gerarRtmOds(mapotecaRelatorioCtrl.paraAbaMeta4(dados))

    // O mes entra no NOME porque o conteudo depende dele: dois arquivos de 2026
    // com o mesmo nome e conteudo diferente e o jeito certo de mandar o errado
    // para a DSG.
    const nome = `META4_DETALHADA_${ano}_ate_${doisDigitos(mes)}.ods`
    res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// ---------------------------------------------------------------------------
// Capacitação: DUAS rotas, uma por tipo (2.6 ministrada, 6.2 recebida)
//
// POR QUE SEPARADAS. A permissão é POR TIPO, e a guarda de rota não enxerga o
// corpo nem a query. Um `POST /capacitacao` só criava qualquer uma das duas,
// porque o `tipo_id` vinha no corpo: com a ministrada sendo do operador de
// Produção e a recebida do de Efetivo, não havia guarda que soubesse qual das
// duas estava chegando. O tipo virou o CAMINHO, e é o servidor que o fixa.
//
// É a mesma forma do par `/produto_versao_historica` e
// `/produto_versao_planejada`, no módulo produto, e pela mesma razão escrita
// lá: um nome por coisa evita o corpo que muda de significado por um inteiro
// escondido.
//
// A LEITURA TAMBÉM SE SEPARA, e não só a escrita. Três razões, nesta ordem:
//   1. `GET /capacitacao` SEM `tipo_id` devolvia as duas. Uma guarda por tipo
//      numa rota que responde os dois tipos não guarda nada.
//   2. `/capacitacao/:id` respondia qualquer id. Ler a ministrada pelo caminho
//      da recebida seria a porta lateral da guarda nova.
//   3. `/capacitacao/anos` mentia. Em 2026-08-06 a produção tinha MINISTRADA em
//      oito anos e RECEBIDA só em 2026: a tela da recebida oferecia os oito, e
//      sete deles respondiam "nenhum registro para estes filtros".
//
// A TABELA CONTINUA UMA. O que se separou foi o endereço, não o dado: os dois
// tipos dividem `rpcmtec.capacitacao`, e duas tabelas com dez colunas iguais
// divergiriam na primeira que fosse acrescentada a uma só.
//
// O CONTROLADOR RECORTA POR TIPO, e a guarda da rota não basta sozinha: sem
// isso, o operador de Efetivo apagaria uma capacitação ministrada mandando o id
// dela para o caminho da recebida. Ver `rpcmtec_capacitacao_ctrl.js`.
// ---------------------------------------------------------------------------

/**
 * As seis rotas de um tipo de capacitação, num molde só.
 *
 * MOLDE, e não doze blocos escritos à mão: o que muda entre ministrada e
 * recebida é o caminho, o `tipo_id` e a guarda. Doze cópias divergiriam na
 * primeira correção aplicada a uma só, e o preço dessa divergência aqui é uma
 * das duas ficar sem recorte de tipo.
 *
 * A ORDEM IMPORTA: '/anos' é declarada antes de '/:id', senão 'anos' cairia na
 * rota do id e reprovaria na validação de parâmetro.
 *
 * @param {string} caminho - 'ministrada' ou 'recebida'
 * @param {number} tipoId - dominio.tipo_capacitacao
 * @param {Function} guarda - o middleware de autorização daquele tipo
 */
const rotasDeCapacitacao = (caminho, tipoId, guarda) => {
  const base = `/capacitacao/${caminho}`

  router.get(
    base,
    guarda,
    schemaValidation({ query: rpcmtecSchema.capacitacaoQuery }),
    asyncHandler(async (req, res, next) => {
      const dados = await capacitacaoCtrl.listar(req.query.ano, tipoId)

      return res.sendJsonAndLog(
        true, 'Capacitações retornadas com sucesso', httpCode.OK, dados
      )
    })
  )

  router.get(
    `${base}/anos`,
    guarda,
    asyncHandler(async (req, res, next) => {
      const dados = await capacitacaoCtrl.anos(tipoId)

      return res.sendJsonAndLog(
        true, 'Anos com capacitação retornados com sucesso', httpCode.OK, dados
      )
    })
  )

  router.get(
    `${base}/:id`,
    guarda,
    schemaValidation({ params: rpcmtecSchema.idParams }),
    asyncHandler(async (req, res, next) => {
      const dados = await capacitacaoCtrl.getPorId(req.params.id, tipoId)

      // Vale para o id que não existe E para o id do OUTRO tipo: por este
      // caminho, a capacitação do outro tipo não está lá.
      if (!dados) {
        throw new AppError('Capacitação não encontrada', httpCode.NotFound)
      }

      return res.sendJsonAndLog(
        true, 'Capacitação retornada com sucesso', httpCode.OK, dados
      )
    })
  )

  router.post(
    base,
    guarda,
    schemaValidation({ body: rpcmtecSchema.criarCapacitacao }),
    asyncHandler(async (req, res, next) => {
      const dados = await capacitacaoCtrl.criar(
        req.body, tipoId, req.usuarioUuid, req.contexto
      )

      return res.sendJsonAndLog(
        true, 'Capacitação criada com sucesso', httpCode.Created, dados
      )
    })
  )

  router.put(
    `${base}/:id`,
    guarda,
    schemaValidation({
      params: rpcmtecSchema.idParams,
      body: rpcmtecSchema.atualizarCapacitacao
    }),
    asyncHandler(async (req, res, next) => {
      const dados = await capacitacaoCtrl.atualizar(
        req.params.id, tipoId, req.body, req.usuarioUuid, req.contexto
      )

      return res.sendJsonAndLog(
        true, 'Capacitação atualizada com sucesso', httpCode.OK, dados
      )
    })
  )

  router.delete(
    `${base}/:id`,
    guarda,
    schemaValidation({ params: rpcmtecSchema.idParams }),
    asyncHandler(async (req, res, next) => {
      await capacitacaoCtrl.deletar(
        req.params.id, tipoId, req.usuarioUuid, req.contexto
      )

      return res.sendJsonAndLog(
        true, 'Capacitação excluída com sucesso', httpCode.OK
      )
    })
  )
}

// MINISTRADA é serviço que a Divisão PRESTA, e alimenta a 2.6: é trabalho de
// produção, e o módulo é Produção.
rotasDeCapacitacao(
  'ministrada',
  TIPO_CAPACITACAO.MINISTRADA,
  verifyPerfil('operador', 'producao')
)

// RECEBIDA é gente nossa EM CURSO, e alimenta a 6.2: é dado de pessoal, e o
// módulo é Efetivo.
rotasDeCapacitacao(
  'recebida',
  TIPO_CAPACITACAO.RECEBIDA,
  verifyPerfil('operador', 'efetivo')
)

// ---------------------------------------------------------------------------
// A edição mensal (rpcmtec.edicao)
//
// A ORDEM IMPORTA: '/anos' e '/anexo/...' são declaradas antes de '/:id',
// senão 'anos' cairia na rota do id.
// ---------------------------------------------------------------------------

router.get(
  '/',
  verifyAdmin,
  schemaValidation({ query: rpcmtecSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.listar({ ano: req.query.ano })

    return res.sendJsonAndLog(
      true, 'Edições do RPCMTec retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/anos',
  verifyAdmin,
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.anos()

    return res.sendJsonAndLog(
      true, 'Anos com edição retornados com sucesso', httpCode.OK, dados
    )
  })
)

// Download do RPCMTec assinado, fora do envelope JSON.
router.get(
  '/anexo/:anexoId/download',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await edicaoCtrl.getAnexoParaDownload(req.params.anexoId)

    res.setHeader('Content-Type', arquivo.mimetype || 'application/octet-stream')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(arquivo.nome_original)}"`
    )
    return res.end(arquivo.conteudo)
  })
)

router.delete(
  '/anexo/:anexoId',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    await edicaoCtrl.deletarAnexo(
      req.params.anexoId, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(true, 'Anexo excluído com sucesso', httpCode.OK)
  })
)

router.get(
  '/:id',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.getPorId(req.params.id)

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec retornada com sucesso', httpCode.OK, dados
    )
  })
)

// O DOCUMENTO INTEIRO: os 34 blocos, com o calculado do banco (edição aberta)
// ou o congelado (edição fechada). É o que a tela desenha e o que vira PDF, do
// mesmo objeto -- com a tela lendo de um lugar e o arquivo de outro, os dois
// divergiriam e quem confere veria diferença onde não há.
router.get(
  '/:id/documento',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.montar(req.params.id)

    return res.sendJsonAndLog(
      true, 'Documento do RPCMTec montado com sucesso', httpCode.OK, dados
    )
  })
)

// Download binário do PDF, fora do envelope JSON.
router.get(
  '/:id/pdf',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const edicao = await edicaoCtrl.montar(req.params.id)
    const buffer = await rpcmtecPdf.montarDocumento(edicao)

    const nome = `RPCMTec-${edicao.ano}-${doisDigitos(edicao.mes)}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// O que o banco diria HOJE, ao lado do congelado. Só em edição fechada.
router.get(
  '/:id/conferir',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.conferirHoje(req.params.id)

    return res.sendJsonAndLog(
      true, 'Conferência realizada com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/',
  verifyAdmin,
  schemaValidation({ body: rpcmtecSchema.criar }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.criar(req.body, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec criada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/:id',
  verifyAdmin,
  schemaValidation({
    body: rpcmtecSchema.atualizar,
    params: rpcmtecSchema.idParams
  }),
  asyncHandler(async (req, res, next) => {
    await edicaoCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec atualizada com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/:id',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await edicaoCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec excluída com sucesso', httpCode.OK
    )
  })
)

// ---------------------------------------------------------------------------
// Fechamento e reabertura
//
// POST, e não PUT: fechar e reabrir são ATOS, e não a gravação de um campo. O
// fechamento congela os 34 blocos e recusa a edição com subseção por
// preencher; a reabertura descongela e preserva o digitado.
// ---------------------------------------------------------------------------

// O corpo carrega SÓ o "eu li o aviso da conferência". Sem ele, a rota responde
// 409 listando as subseções nunca conferidas e as conferidas antes de mudarem.
router.post(
  '/:id/fechar',
  verifyAdmin,
  schemaValidation({
    params: rpcmtecSchema.idParams,
    body: rpcmtecSchema.fecharEdicao
  }),
  asyncHandler(async (req, res, next) => {
    // `req.body?.` e nao `req.body.`: quem chama sem corpo nenhum (o `curl -X
    // POST` sem `Content-Type`, e o supertest sem `.send()`) chega aqui com
    // `req.body` indefinido, e a leitura direta virava 500. O fechamento e a
    // acao mais importante desta tela, e ela quebrava por um corpo ausente.
    const dados = await edicaoCtrl.fechar(
      req.params.id, req.usuarioUuid, req.contexto, req.body?.ciente_revisao
    )

    return res.sendJsonAndLog(
      true, 'Edição fechada e congelada com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/:id/reabrir',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.reabrir(
      req.params.id, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Edição reaberta com sucesso', httpCode.OK, dados
    )
  })
)

// ---------------------------------------------------------------------------
// Subseções digitadas
// ---------------------------------------------------------------------------

router.put(
  '/:id/subsecao/:numero',
  verifyAdmin,
  schemaValidation({
    params: rpcmtecSchema.subsecaoParams,
    body: rpcmtecSchema.gravarSubsecao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await subsecaoCtrl.gravar(
      req.params.id, req.params.numero, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Subseção gravada com sucesso', httpCode.OK, dados
    )
  })
)

// A IMPORTAÇÃO DO CSV DO github_dashboard, para a subseção 5.1.
//
// O NÚMERO ESTÁ NO CAMINHO, e não num parâmetro. O formato lido é o do painel do
// GitHub (repositório, commits, efetivo), e o painel só alimenta a 5.1: um
// `:numero` aqui ofereceria despejar essa tabela em qualquer uma das dezoito
// subseções digitadas, e a 9.3 aceitaria três colunas de commits sem reclamar.
// É a mesma escolha do par `/capacitacao/ministrada` e `/capacitacao/recebida`:
// quem fixa o alvo é a rota, no servidor.
//
// POST, e não PUT: a importação não grava o corpo que recebeu. Ela LÊ o CSV,
// cruza com o que já está na tabela e decide o que muda. O Resumo, que é a
// coluna escrita por pessoa, não vem no corpo e não se perde.
router.post(
  '/:id/subsecao/5.1/importar',
  verifyAdmin,
  schemaValidation({
    params: rpcmtecSchema.idParams,
    body: rpcmtecSchema.importarRepositorios
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await subsecaoCtrl.importarRepositorios(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true,
      `Subseção 5.1 importada: ${dados.total} repositório(s)`,
      httpCode.OK,
      dados
    )
  })
)

// A MARCA DE CONFERÊNCIA, e ela vale para as TRÊS origens.
//
// Não é a mesma pergunta que "preenchida". Uma subseção calculada nasce
// preenchida e continua precisando de olho humano: o número pode estar certo e
// o CADASTRO que o alimenta, errado. Quem confere o relatório antes de assinar
// percorre os 34 blocos, e até aqui não tinha onde registrar por onde já passou.
router.put(
  '/:id/subsecao/:numero/revisao',
  verifyAdmin,
  schemaValidation({
    params: rpcmtecSchema.subsecaoParams,
    body: rpcmtecSchema.revisarSubsecao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.revisar(
      req.params.id, req.params.numero, req.body.revisado,
      req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true,
      req.body.revisado
        ? `Subseção ${req.params.numero} marcada como conferida`
        : `Conferência da subseção ${req.params.numero} desfeita`,
      httpCode.OK,
      dados
    )
  })
)

// Apaga o conteúdo digitado. A subseção volta a NÃO EXISTIR, que não é o mesmo
// que ficar vazia: o fechamento a cobra de novo.
router.delete(
  '/:id/subsecao/:numero',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.subsecaoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await subsecaoCtrl.limpar(
      req.params.id, req.params.numero, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Subseção limpa com sucesso', httpCode.OK, dados
    )
  })
)

// NÃO EXISTE ROTA QUE TRAGA O CONTEÚDO DO MÊS PASSADO, e isso é decisão de
// 2026-08-06. Havia aqui um POST que trazia as subseções digitadas da edição
// anterior para esta. Ele saiu inteiro, com o schema e o controlador.
//
// A RAZÃO: o RPCMTec é o relatório DAQUELE mês. O que a cópia produzia era pior
// que digitar de novo, porque o documento assinado passava a afirmar sobre
// agosto o que aconteceu em julho, e ninguém revisava linha que já chegou
// preenchida. Cada subseção se preenche pelo mês que ela reporta.
//
// Foi PODA, e não desativação: quem chamar esse endereço recebe 404.

// ---------------------------------------------------------------------------
// Anexo: o RPCMTec assinado
// ---------------------------------------------------------------------------

router.get(
  '/:id/anexos',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.listarAnexos(req.params.id)

    return res.sendJsonAndLog(
      true, 'Anexos retornados com sucesso', httpCode.OK, dados
    )
  })
)

// O multer vem ANTES da validação do corpo: sem ele, `req.body` do multipart
// chega vazio. Mesma ordem do anexo da revisão do PIT.
router.post(
  '/:id/anexos',
  verifyAdmin,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  uploadAnexoEdicao,
  schemaValidation({ body: rpcmtecSchema.anexoUploadBody }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.criarAnexo(
      req.params.id, req.file, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'RPCMTec assinado anexado com sucesso', httpCode.Created, dados
    )
  })
)

module.exports = router
