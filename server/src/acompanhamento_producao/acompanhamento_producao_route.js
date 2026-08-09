'use strict'

// ACOMPANHAMENTO DA PRODUCAO: as telas que respondem "como esta indo", e nada
// mais. As 25 rotas deste arquivo sao TODAS de LEITURA -- nao ha POST, PUT nem
// DELETE, e nao e omissao: quem lanca producao e `/api/distribuicao`, quem
// configura e `/api/producao`, e quem apaga e `/api/perigo`. Por isso nao ha
// `db.conn.tx()` nem `auditoriaCtrl.registrar` aqui: ler nao muda dado, e evento
// de auditoria por leitura encheria a trilha de ruido justamente onde ela precisa
// ser lida.
//
// A REGUA DE PERFIL, pela frase da casa (2026-08-08): `consulta` LE as telas do
// modulo, `operador` LANCA, `gerente` responde pela area e ve tudo dela. Aqui
// isso da:
//
//   consulta  - o acompanhamento inteiro: informacoes de lote e subfase, grade,
//               linhas do tempo, situacao das subfases, painel, PIT, mapa,
//               projetos e a tile
//   gerente   - as TRES rotas que respondem sobre PESSOAS e sobre a Divisao, e
//               nao sobre o trabalho: o ultimo login de cada um, quem esta sem
//               habilitacao, e o pacote do site publico de acompanhamento
//
// O piso das tres e o da AREA, e nao o do administrador que elas tinham no SAP
// 2.3.5. Ali as guardas eram duas (`verifyLogin` e `verifyAdmin`), e `verifyAdmin`
// era o unico degrau acima de "esta logado" -- era isso, e nao uma decisao sobre
// quem deve ver, que punha a lista de logins na mao do administrador global. Aqui
// existe o gerente do modulo, que e exatamente "quem responde pela area".
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele e 'acervo': uma
// rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro de
// sintaxe, sem teste vermelho e sem nada na tela.

const express = require('express')

const archiver = require('archiver')

const { schemaValidation, asyncHandler, httpCode, logger } = require('../utils')

// `verifyLoginTile` e a UNICA guarda do sistema que aceita token por query, e ela
// entra em UMA rota deste arquivo. Ver o comentario dela la embaixo.
const { verifyPerfil, verifyLoginTile } = require('../login')

const acompanhamentoCtrl = require('./acompanhamento_producao_ctrl')
const acompanhamentoSchema = require('./acompanhamento_producao_schema')

const router = express.Router()

// --- Os seletores das telas ---------------------------------------------------
//
// AS DUAS VEM ANTES DE `/informacoes/:lote`, e a ordem aqui e a regra da casa:
// rota literal antes de rota com parametro. `/lotes` nao colide com
// `/informacoes/:lote` hoje, mas a disciplina e posicional e nao condicional.
//
// Elas devolvem id e NOME, e nada mais. O porque de existirem, em vez de a tela
// usar `/api/projetos/lote` ou `/api/producao/lote/:id/subfases`, esta no
// comentario de `lotesComProducao` no controlador: as duas de la cobram outro
// modulo ou outro piso, e baixar o piso delas entregaria de lambuja o que elas
// carregam a mais.

router.get(
  '/lotes',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.lotesComProducao()
    return res.sendJsonAndLog(
      true, 'Lotes com produção retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/lotes/:lote/subfases',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.loteParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.subfasesDoLote(req.params.lote)
    return res.sendJsonAndLog(
      true, 'Subfases do lote retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// --- Informações de lote e de subfase ----------------------------------------

router.get(
  '/informacoes/:lote/:subfase',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.loteSubfaseParams }),
  asyncHandler(async (req, res, next) => {
    // A ORDEM DOS ARGUMENTOS E (lote, subfase), a mesma do caminho. Na origem a
    // funcao recebia (subfaseId, loteId) e a rota passava o lote primeiro: os
    // dois filtros iam para a coluna errada e a resposta vinha vazia, sem erro.
    const dados = await acompanhamentoCtrl.getInfoSubfaseLote(
      req.params.lote, req.params.subfase
    )
    return res.sendJsonAndLog(
      true, 'Informações da subfase do lote retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/informacoes/:lote',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.loteParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getInfoLote(req.params.lote)
    return res.sendJsonAndLog(
      true, 'Informações do lote retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// --- Atividades ---------------------------------------------------------------

router.get(
  '/grade_acompanhamento',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.acompanhamentoGrade()
    return res.sendJsonAndLog(
      true, 'Grades de acompanhamento retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/atividade_subfase',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.atividadeSubfase()
    return res.sendJsonAndLog(
      true, 'Atividade por subfase retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/atividade_usuario',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.atividadeUsuario()
    return res.sendJsonAndLog(
      true, 'Atividade por usuário retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/situacao_subfase',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.situacaoSubfase()
    return res.sendJsonAndLog(
      true, 'Situação das subfases retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/resumo_usuario',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.resumoUsuario()
    return res.sendJsonAndLog(
      true, 'Resumo dos usuários retornado com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/atividades_em_execucao',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.atividadesEmExecucao()
    return res.sendJsonAndLog(
      true, 'Atividades em execução retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/ultimas_atividades_finalizadas',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.ultimasAtividadesFinalizadas()
    return res.sendJsonAndLog(
      true, 'Últimas atividades finalizadas retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// --- Pessoas ------------------------------------------------------------------
//
// AS DUAS DE GERENTE. Elas nao falam do trabalho, e sim de QUEM trabalha: quem
// apareceu por ultimo e quem ainda nao tem habilitacao. Sao a resposta da area
// sobre a propria tropa, e por isso o piso e o de quem responde pela area.

router.get(
  '/ultimos_login',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.ultimosLogin()
    return res.sendJsonAndLog(
      true, 'Últimos logins retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/usuarios_sem_perfil',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.usuariosSemPerfil()
    return res.sendJsonAndLog(
      true, 'Usuários sem habilitação retornados com sucesso', httpCode.OK, dados
    )
  })
)

// --- Painel -------------------------------------------------------------------
//
// `/dashboard/execucao` NAO COLIDE com `/dashboard/quantidade/:ano`: os caminhos
// tem numeros de segmentos diferentes, e o literal `quantidade` casa antes de
// qualquer parametro. A ordem aqui e a da tela, e nao uma exigencia do Express.

router.get(
  '/dashboard/quantidade/:ano',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.anoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getQuantidadeAno(req.params.ano)
    return res.sendJsonAndLog(
      true, 'Quantidade prevista no ano retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/dashboard/finalizadas/:ano',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.anoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getFinalizadasAno(req.params.ano)
    return res.sendJsonAndLog(
      true, 'Versões finalizadas no ano retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/dashboard/execucao',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getExecucao()
    return res.sendJsonAndLog(
      true, 'Versões em execução retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// --- O PIT --------------------------------------------------------------------
//
// `/pit/subfase/:ano` VEM ANTES DE `/pit/:ano`, E A ORDEM E O CONTRATO.
//
// Hoje as duas nao disputam nada, porque `/pit/:ano` so casa DOIS segmentos e a
// outra tem tres. Mas basta alguem trocar `:ano` por um parametro coringa, ou
// acrescentar um `/pit/:ano/:algo`, para `subfase` passar a ser lido como um ano
// -- e a falha seria um 400 do Joi dizendo que "subfase" nao e numero, num
// caminho em que ninguem escreveu ano nenhum. O Express casa na ORDEM DE
// DECLARACAO: a rota literal antes da rota com parametro nao custa nada e fecha
// a porta.

router.get(
  '/pit/subfase/:ano',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.anoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getInfoSubfasePIT(req.params.ano)
    return res.sendJsonAndLog(
      true, 'Informações do PIT por subfase retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/pit/:ano',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.anoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getInfoPIT(req.params.ano)
    return res.sendJsonAndLog(
      true, 'Informações do PIT retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// --- Mapa ---------------------------------------------------------------------

router.get(
  '/mapa/:nome',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.nomeParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getLayerGeoJSON(req.params.nome)
    return res.sendJsonAndLog(
      true, 'GeoJSON da camada retornado com sucesso', httpCode.OK, dados
    )
  })
)

// --- Projetos -----------------------------------------------------------------
//
// `/projetos` (plural) e a LISTA daqui; `/projeto/:id/...` (singular) e o
// detalhe. Sao caminhos distintos de proposito, e nenhum dos dois se confunde
// com `/api/projetos` do acervo, que e o CADASTRO do projeto -- este modulo nao
// cria, nao altera e nao apaga projeto nenhum.

router.get(
  '/projetos',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ query: acompanhamentoSchema.finalizadoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getInfoProjetos(req.query.finalizado)
    return res.sendJsonAndLog(
      true, 'Informações dos projetos retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/projeto/:id/informacao_anual/:ano',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.projetoAnoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getInfoProjetoAnual(
      req.params.id, req.params.ano
    )
    return res.sendJsonAndLog(
      true, 'Informação anual do projeto retornada com sucesso', httpCode.OK, dados
    )
  })
)

// SEM ANO ANTES DE COM ANO. As duas se distinguem pelo numero de segmentos, mas
// a ordem segue a regra da casa: o caminho mais curto e o mais literal primeiro.
router.get(
  '/projeto/:id/informacao_detalhada',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.projetoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getInfoProjetoDetalhada(req.params.id)
    return res.sendJsonAndLog(
      true, 'Informação detalhada do projeto retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/projeto/:id/informacao_detalhada/:ano',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: acompanhamentoSchema.projetoAnoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getInfoProjetoDetalhada(
      req.params.id, req.params.ano
    )
    return res.sendJsonAndLog(
      true, 'Informação detalhada do projeto retornada com sucesso', httpCode.OK, dados
    )
  })
)

// --- O pacote do site de acompanhamento ---------------------------------------

router.get(
  '/dados_site_acompanhamento',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await acompanhamentoCtrl.getDadosSiteAcompanhamento()

    // A UNICA RESPOSTA DESTE MODULO QUE NAO SAI POR `res.sendJsonAndLog`, e a
    // excecao e a mesma dos downloads do acervo: o corpo e um ZIP binario, e o
    // envelope JSON da casa nao tem onde carrega-lo.
    const arquivo = archiver('zip')

    // O `error` do archiver chega DEPOIS que os cabecalhos ja foram enviados, e
    // por isso ele nao pode virar `next(err)`: a resposta ja comecou, e o
    // `errorHandler` tentaria escrever um JSON por cima do zip. O que resta e
    // registrar e ABORTAR a conexao, para o cliente perceber o truncamento em
    // vez de guardar um zip incompleto que abre com erro.
    arquivo.on('error', err => {
      logger.error('Falha ao montar o pacote do site de acompanhamento', {
        error: err.message
      })
      res.destroy(err)
    })

    res.setHeader(
      'Content-Disposition', 'attachment; filename=dados_acompanhamento.zip'
    )
    res.setHeader('Content-Type', 'application/zip')

    arquivo.pipe(res)
    dados.forEach(d => {
      arquivo.append(JSON.stringify(d.dados, null, 2), { name: d.nome })
    })
    return arquivo.finalize()
  })
)

// --- A tile vetorial ----------------------------------------------------------
//
// A UNICA ROTA DO SISTEMA QUE NAO PASSA POR CABECALHO DE AUTORIZACAO, e a razao
// e do cliente, nao nossa: o QGIS e o MapLibre pedem tile por URL crua, sem
// `Authorization`. Uma camada XYZ nao tem onde por cabecalho.
//
// POR ISSO `verifyLoginTile`, E SO AQUI. Ele aceita o token por `?token=`, que e
// o unico canal que a URL de uma camada oferece. Toda outra rota deste arquivo
// continua com `verifyPerfil`, e nenhuma delas aceita token por query -- abrir
// essa porta em rota de JSON poria o token no log do servidor e no historico do
// navegador sem necessidade nenhuma.
//
// ELE VEM DE `server/src/login/`, E NAO HA UM SEGUNDO AQUI. Dois guardas de
// token divergiriam no primeiro ajuste, e o mais fraco seria o que ninguem
// estaria olhando.
//
// E ELE VEM SOZINHO, sem `verifyPerfil` encadeado depois -- o cabecalho do
// proprio `verify_login_tile.js` recomenda o encadeamento, e ele NAO se aplica
// aqui: `verifyPerfil` le `req.headers.authorization`, que numa requisicao de
// tile do QGIS nao existe. Encadea-lo devolveria 401 a todo pedido de tile, que
// e exatamente o problema que esta guarda existe para resolver. Quem quiser
// cobrar perfil em rota de tile tera de ensinar `verifyPerfil` a ler a query, e
// isso e mudanca em `login/`, nao aqui.
//
// A CONSEQUENCIA E DECLARADA: quem tem conta ATIVA e um token valido busca a
// tile, mesmo sem perfil no modulo `producao`. O que a tile carrega e o recorte
// da folha e o nome dela -- a mesma geometria que `/api/produtos` ja publica ao
// acervo. Nenhuma coluna de execucao, de operador ou de prazo entra nela.
router.get(
  '/linha_producao/:id/:z/:x/:y.pbf',
  verifyLoginTile,
  schemaValidation({ params: acompanhamentoSchema.mvtParams }),
  asyncHandler(async (req, res, next) => {
    const tile = await acompanhamentoCtrl.getMvtLinhaProducao(
      req.params.id, req.params.z, req.params.x, req.params.y
    )

    // 204 EM DOIS CASOS, e os dois sao normais: a linha de producao ainda nao
    // tem view materializada nenhuma (nenhum lote com etapa nela), ou a tile
    // pedida nao cobre feicao alguma. Um 404 faria o MapLibre marcar a camada
    // como quebrada; o 204 e o que ele entende como "aqui nao ha nada".
    if (!tile || tile.length === 0) {
      return res.status(httpCode.NoContent).end()
    }

    res.setHeader('Content-Type', 'application/x-protobuf')
    return res.send(tile)
  })
)

module.exports = router
