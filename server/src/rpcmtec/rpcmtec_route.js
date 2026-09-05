'use strict'

// Rotas do RPCMTec, o relatório mensal da Divisão.
//
// A GUARDA MUDOU EM 2026-08-08, por decisão do chefe, e passou a ter TRÊS
// níveis, porque as três coisas que se fazem aqui são diferentes:
//
//   LER              `verifyGerente`  administrador global OU gerente de
//                    QUALQUER módulo. O relatório inteiro: as 33 subseções, o
//                    documento, o PDF, os anexos e as duas planilhas que sobem
//                    para a DSG no mesmo envio (Anuário e RTM).
//
//   ESCREVER         `verifyGerente` + `verifyModuloSubsecao()`. O gerente
//   UMA SUBSEÇÃO     altera as subseções DO MÓDULO EM QUE ELE É GERENTE, e só
//                    elas. O mapa subseção -> módulo é a chave `modulo` de
//                    `rpcmtec_estrutura.js`, e a conferência é
//                    `verify_modulo_subsecao.js`.
//
//   ASSINAR          `verifyAdmin`. Criar e excluir a edição do mês, editar os
//                    metadados dela (assinante e data de assinatura), FECHAR,
//                    REABRIR e mexer no anexo assinado. Congelar o documento que
//                    o chefe da Divisão assina não é ato de gerente de módulo, e
//                    reabrir depois de assinado, menos ainda.
//
// O QUE ISTO REVERTE. Tudo aqui era `verifyAdmin`, e a razão escrita era que o
// relatório traz valor de crédito, de empenho e de liquidação, e que liberá-lo
// por perfil de UM módulo entregaria o orçamento a quem só cataloga carta. O
// chefe decidiu o contrário para a LEITURA: gerente responde pela área e vê tudo
// dela, e o RPCMTec é a prestação de contas da Divisão inteira, que os gerentes
// conferem antes de o chefe assinar. A objeção continua valendo para a ESCRITA,
// e é exatamente o que o recorte por módulo guarda: o gerente da mapoteca lê a
// seção 4 e não altera uma linha dela.
//
// Não existe "perfil de RPCMTec", porque não existe módulo RPCMTec: ele continua
// sendo rota de PLATAFORMA, sem prefixo de módulo (ver CLAUDE.md, modelo de
// autorização). O que ele ganhou foi um dono POR SUBSEÇÃO.
//
// A CAPACITAÇÃO É A EXCEÇÃO, desde a 1.33.0, e ela mora aqui por endereço e não
// por natureza: capacitação é CADASTRO, e não relatório. Ela virou duas rotas,
// uma por tipo, com guardas diferentes. Ver o bloco dela mais abaixo.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, AppError, enviarArquivo } = require('../utils')
const { domainConstants: { TIPO_CAPACITACAO } } = require('../utils')
const { verifyAdmin, verifyGerente, verifyPerfil } = require('../login')

const verifyModuloSubsecao = require('./verify_modulo_subsecao')
const edicaoCtrl = require('./rpcmtec_edicao_ctrl')
const subsecaoCtrl = require('./rpcmtec_subsecao_ctrl')
const capacitacaoCtrl = require('./rpcmtec_capacitacao_ctrl')
const rpcmtecPdf = require('./rpcmtec_pdf')
const uploadAnexoEdicao = require('./anexo_edicao_upload')
const rpcmtecSchema = require('./rpcmtec_schema')
const instituicaoCtrl = require('../instituicao/instituicao_ctrl')
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
//
// `verifyGerente` como o resto da LEITURA: os dois botões que baixam estas
// planilhas ficam na barra da tela da edição, que qualquer gerente abre. Deixá-
// -los no administrador daria a essa tela dois botões que respondem 403.
// ---------------------------------------------------------------------------

// Prévia em tela, no envelope JSON.
router.get(
  '/anuario',
  verifyGerente,
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
  verifyGerente,
  schemaValidation({ query: rpcmtecSchema.gerarQuery }),
  asyncHandler(async (req, res, next) => {
    const { ano, mes } = req.query
    const instituicao = await instituicaoCtrl.paraDocumento()
    const anuario = await anuarioCtrl.getAnuarioEstatistico({ ano, mes })
    const buffer = gerarAnuarioOds(
      anuario,
      anuarioCtrl.COLUNAS_ANUARIO,
      anuarioCtrl.paraPlanilha(anuario)
    )

    // O nome segue o dos arquivos que já subiram para a DSG
    // (Anuario_Estatistico_1CGEO_06_Junho_2026.ods): número E nome do mês.
    //
    // A SIGLA VEM DE `dgeo.instituicao` desde 2026-08-09, e entra pelo SLUG. A
    // sigla é '1º CGEO', com espaço e com o ordinal, e nome de arquivo não os
    // aceita bem: o 'º' viaja mal por `Content-Disposition`, e o espaço parte o
    // nome em dois na linha de comando de quem baixa. `sigla_slug` é a mesma
    // ideia de `acervo.slug_nome()`, e o porquê da diferença está em
    // `instituicao/instituicao_ctrl.js`. Para o 1º CGEO ele dá exatamente o
    // '1CGEO' que a DSG já recebe -- o nome de hoje não muda.
    //
    // A LEITURA VEM ANTES da montagem da planilha, de propósito: se a
    // instituição não responder, o pedido para sem ter gasto as consultas do
    // Anuário.
    const nome = `Anuario_Estatistico_${instituicao.sigla_slug}_${doisDigitos(mes)}_${anuarioCtrl.NOME_MES[mes - 1]}_${ano}.ods`
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
// A aba é ACUMULADA NO ANO até o mês escolhido, e é o único download desta tela
// que acumula: os outros são do MÊS. Ela é o detalhamento da Meta 4 do PIT, e
// quem a cola no RTM cola o ano até ali.
//
// O `mes` NÃO é decorativo, então: ele recorta o acumulado e entra no nome do
// arquivo. Este cabeçalho dizia o contrário ("por isso o `mes` é ignorado
// aqui"), contra os dois comentários de dentro do handler, que estão certos.
// Quem lesse o de cima e "consertasse" o nome do arquivo faria a Divisão mandar
// para a DSG dois arquivos de 2026 com o mesmo nome e conteúdos diferentes.
// ---------------------------------------------------------------------------

router.get(
  '/rtm/ods',
  verifyGerente,
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
 * recebida é o caminho, o `tipo_id` e as guardas. Doze cópias divergiriam na
 * primeira correção aplicada a uma só, e o preço dessa divergência aqui é uma
 * das duas ficar sem recorte de tipo.
 *
 * DUAS GUARDAS, E NÃO UMA, desde 2026-08-08. O molde recebia UM middleware e o
 * repetia nas seis rotas, o que amarrava ler e escrever ao mesmo nível: quem
 * pudesse LISTAR os cursos podia também APAGÁ-LOS. A régua nova dos módulos
 * separa as duas coisas (consulta LÊ, operador lança, gerente responde pela
 * área), e um molde de guarda única não sabe expressá-la.
 *
 * O PARÂMETRO CONTINUA SENDO O MIDDLEWARE PRONTO, e não o nome do nível: é o que
 * mantém o módulo VISÍVEL na chamada, onde `modulo_em_toda_rota.test.js` o lê.
 * Um molde que montasse `verifyPerfil(nivel, modulo)` por dentro esconderia o
 * módulo do único teste que cobra o argumento esquecido.
 *
 * A ORDEM IMPORTA: '/anos' é declarada antes de '/:id', senão 'anos' cairia na
 * rota do id e reprovaria na validação de parâmetro.
 *
 * @param {string} caminho - 'ministrada' ou 'recebida'
 * @param {number} tipoId - dominio.tipo_capacitacao
 * @param {Function} leitura - autorização das três rotas que só respondem
 * @param {Function} escrita - autorização das três que gravam
 */
const rotasDeCapacitacao = (caminho, tipoId, leitura, escrita) => {
  const base = `/capacitacao/${caminho}`

  router.get(
    base,
    leitura,
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
    leitura,
    asyncHandler(async (req, res, next) => {
      const dados = await capacitacaoCtrl.anos(tipoId)

      return res.sendJsonAndLog(
        true, 'Anos com capacitação retornados com sucesso', httpCode.OK, dados
      )
    })
  )

  router.get(
    `${base}/:id`,
    leitura,
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
    escrita,
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
    escrita,
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
    escrita,
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

// MINISTRADA é serviço que a Divisão PRESTA, e alimenta a 2.6: é trabalho que o
// plano promete, e o módulo é o PIT (o code 4, que se chamou `producao` até
// 2026-08-09).
//
// A LEITURA DESCEU PARA CONSULTA em 2026-08-08, e a escrita ficou onde estava. O
// curso que a Divisão deu não é segredo dentro dela, e exigir o nível de quem
// LANÇA para quem só CONFERE fechava a tela da 2.6 para o resto do PIT.
rotasDeCapacitacao(
  'ministrada',
  TIPO_CAPACITACAO.MINISTRADA,
  verifyPerfil('consulta', 'pit'),
  verifyPerfil('operador', 'pit')
)

// RECEBIDA é gente nossa EM CURSO, e alimenta a 6.2: é dado de pessoal, e o
// módulo é Efetivo. Mesma separação da ministrada, no compartimento do Efetivo.
rotasDeCapacitacao(
  'recebida',
  TIPO_CAPACITACAO.RECEBIDA,
  verifyPerfil('consulta', 'efetivo'),
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
  verifyGerente,
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
  verifyGerente,
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.anos()

    return res.sendJsonAndLog(
      true, 'Anos com edição retornados com sucesso', httpCode.OK, dados
    )
  })
)

// Download do RPCMTec assinado, fora do envelope JSON. LER o assinado é ler o
// relatório: quem confere o mês precisa do documento que foi de fato assinado, e
// não só do PDF que o sistema emite hoje.
router.get(
  '/anexo/:anexoId/download',
  verifyGerente,
  schemaValidation({ params: rpcmtecSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await edicaoCtrl.getAnexoParaDownload(req.params.anexoId)

    res.setHeader('Content-Type', arquivo.mimetype || 'application/octet-stream')
    // `disposicao()` de `utils/enviar_arquivo.js`, que é a função da casa para
    // isto e manda os DOIS parâmetros. Só `filename*` (RFC 6266) resolve o
    // acento -- com `filename="..."` percent-encoded dentro, o encoding chega
    // LITERAL ao disco, e "RPCMTec Julho 2026 assinado.pdf" era salvo como
    // "RPCMTec%20Julho%202026%20assinado.pdf" --, mas só ele deixa cliente antigo
    // baixar "download" sem extensão. O `filename` ASCII é a reserva.
    res.setHeader('Content-Disposition', enviarArquivo.disposicao(arquivo.nome_original))
    // O TAMANHO SE DECLARA, como nas três rotas de download vizinhas deste
    // arquivo. Sem ele a resposta sai em chunked, e quem baixa o PDF assinado
    // (que vai a 20 MB pelo teto do upload) vê "tamanho desconhecido" e nenhuma
    // estimativa de tempo.
    res.setHeader('Content-Length', String(arquivo.conteudo.length))
    return res.end(arquivo.conteudo)
  })
)

// APAGAR o anexo continua do administrador: o arquivo aqui é o documento
// assinado, e sumir com ele é desfazer a assinatura.
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
  verifyGerente,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.getPorId(req.params.id)

    return res.sendJsonAndLog(
      true, 'Edição do RPCMTec retornada com sucesso', httpCode.OK, dados
    )
  })
)

// O DOCUMENTO INTEIRO: os 33 blocos, com o calculado do banco (edição aberta)
// ou o congelado (edição fechada). É o que a tela desenha e o que vira PDF, do
// mesmo objeto -- com a tela lendo de um lugar e o arquivo de outro, os dois
// divergiriam e quem confere veria diferença onde não há.
router.get(
  '/:id/documento',
  verifyGerente,
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
  verifyGerente,
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
  verifyGerente,
  schemaValidation({ params: rpcmtecSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await edicaoCtrl.conferirHoje(req.params.id)

    return res.sendJsonAndLog(
      true, 'Conferência realizada com sucesso', httpCode.OK, dados
    )
  })
)

// CRIAR, EDITAR OS METADADOS E EXCLUIR a edição do mês continuam do
// ADMINISTRADOR. A edição é o documento, e não o conteúdo de uma área: abrir o
// mês, dizer QUEM ASSINA e em que data, e apagar o mês inteiro são atos de quem
// responde pelo relatório, não de quem responde por uma das nove seções dele.
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
// fechamento congela os 33 blocos e recusa a edição com subseção por
// preencher; a reabertura descongela e preserva o digitado.
//
// OS DOIS SÃO DO ADMINISTRADOR, e ficaram de fora do recorte por módulo de
// propósito. Fechar é congelar o documento que o chefe da Divisão assina, e a
// peça é UMA: um gerente de módulo congelaria também as oito seções que não são
// dele. Reabrir é o inverso, e mexe no que já foi assinado.
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
// Subseções: o RECORTE POR MÓDULO
//
// As quatro rotas abaixo mudam UMA subseção, e é nelas que o `modulo` da
// estrutura vira permissão. A dupla é sempre a mesma, e nesta ordem:
//
//   `verifyGerente`            autentica, lê `dgeo.usuario` do banco e exige
//                              gerente em ALGUM módulo;
//   `verifyModuloSubsecao()`   exige gerente NO MÓDULO DAQUELA subseção.
//
// Duas guardas, e não uma, porque são duas perguntas: a primeira é quem a pessoa
// é, a segunda é de quem é a subseção. Ver `verify_modulo_subsecao.js`.
// ---------------------------------------------------------------------------

router.put(
  '/:id/subsecao/:numero',
  verifyGerente,
  verifyModuloSubsecao(),
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
//
// A GUARDA RECEBE O NÚMERO PRONTO, porque aqui ele está no caminho e não em
// `req.params`. Hoje a 5.1 é `modulo: null` (não existe módulo de TI), então
// isto continua valendo só para o administrador -- mas por CONSEQUÊNCIA do mapa,
// e não por um `verifyAdmin` escrito à mão que ficaria para trás no dia em que a
// 5.1 ganhar dono.
router.post(
  '/:id/subsecao/5.1/importar',
  verifyGerente,
  verifyModuloSubsecao('5.1'),
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
// percorre os 33 blocos, e até aqui não tinha onde registrar por onde já passou.
//
// É AQUI QUE O RECORTE POR MÓDULO RENDE MAIS. Conferir vale para as três
// origens, então esta rota alcança os 33 blocos, e não os 13 digitados: com ela
// recortada, cada gerente carimba o que é da área dele e o administrador deixa
// de ser o único par de olhos antes da assinatura.
router.put(
  '/:id/subsecao/:numero/revisao',
  verifyGerente,
  verifyModuloSubsecao(),
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
  verifyGerente,
  verifyModuloSubsecao(),
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
  verifyGerente,
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
//
// ANEXAR é do ADMINISTRADOR: o arquivo que sobe aqui é o RPCMTec ASSINADO, e
// dizer "este é o documento assinado do mês" é ato de assinatura, não de área.
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
