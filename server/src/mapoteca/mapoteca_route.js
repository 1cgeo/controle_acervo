'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, csvExport, enviarArquivo } = require('../utils')

const { verifyPerfil } = require('../login')

const mapotecaCtrl = require('./mapoteca_ctrl')
const relatorioCtrl = require('./relatorio_ctrl')
const { gerarRtmOds } = require('../rpcmtec/rtm_ods')
const mapotecaSchema = require('./mapoteca_schema')
// O par prepare/confirm do download do plugin mora em acervo.download, que e
// uma tabela so. Ver POST '/impressao/confirmar_download', abaixo.
const acervoCtrl = require('../acervo/acervo_ctrl')
const acervoSchema = require('../acervo/acervo_schema')
const anexoPedidoCtrl = require('./anexo_pedido_ctrl')
// O rastro do pedido mora em `auditoria.evento`, e nao numa tabela da mapoteca.
// Este router nao o LE: quem le e GET /api/auditoria/mapoteca/pedido/:id. Ver o
// bloco "Auditoria do pedido" no fim do arquivo. Quem GRAVA o rastro sao os
// controladores, cada um com o auditoriaCtrl que ja importa.
const etiquetaEnvioCtrl = require('./etiqueta_envio_ctrl')
const uploadAnexoPedido = require('./anexo_pedido_upload')

const { AppError } = require('../utils')

const router = express.Router()

// Rotas para Domínios
router.get(
  '/dominio/tipo_cliente',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTipoCliente()
    const msg = 'Tipos de cliente retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/situacao_pedido',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getSituacaoPedido()
    const msg = 'Situações de pedido retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_midia',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTipoMidia()
    const msg = 'Tipos de mídia retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/canal_recebimento',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getCanalRecebimento()
    const msg = 'Canais de recebimento retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_localizacao',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTipoLocalizacao()
    const msg = 'Tipos de localização retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/forma_entrega',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getFormaEntrega()
    const msg = 'Formas de entrega retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Rotas para Cliente
router.get(
  '/cliente',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getClientes()
    const msg = 'Clientes retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/cliente/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.clienteId
  }),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params
    const dados = await mapotecaCtrl.getClienteById(id)
    const msg = 'Detalhes do cliente retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/cliente',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.cliente
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.criaCliente(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Cliente criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/cliente',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.clienteAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaCliente(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Cliente atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/cliente',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.clienteIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteClientes(req.body.cliente_ids, req.usuarioUuid, req.contexto)
    const msg = 'Clientes deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Pedido
// Do ANO consultado, pela data do pedido. O ano vem do contexto do módulo
// (seletor da navbar) e cai no ano corrente quando não vem na query.
//
// `palavra_chave` é OPCIONAL e casa a etiqueta INTEIRA de
// `pedido.palavras_chave`, usando o índice GIN que a coluna tem desde a
// instalação e que até 2026-08-08 não servia consulta nenhuma. Ele NÃO
// substitui o filtro de ano: os dois somam, porque a etiqueta se repete de um
// ano para o outro ('Extra-PIT', '5ª DE') e a lista continua sendo do ano.
router.get(
  '/pedido',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.pedidoListaQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getPedidos(
      req.query.ano,
      req.query.palavra_chave
    )
    const msg = 'Pedidos retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// PUBLICA de proposito (sem guarda): e o acompanhamento que o proprio cliente
// faz do pedido dele pelo localizador, sem ter conta no sistema. So devolve
// situacao, observacao e itens daquele pedido, e o localizador e o segredo.
router.get(
  '/pedido/localizador/:localizador',
  schemaValidation({
    params: mapotecaSchema.pedidoLocalizador
  }),
  asyncHandler(async (req, res, next) => {
    const { localizador } = req.params
    const dados = await mapotecaCtrl.getPedidoByLocalizador(localizador)
    const msg = 'Pedido encontrado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// A FILA de pedidos abertos, do mais urgente para o menos.
//
// ANTES de '/pedido/:id', e não junto das outras: '/pedido/em_aberto' casaria com
// ':id' e o erro apareceria como "id de pedido inválido", que não diz nada a quem
// chamou. Mesma disciplina de '/pedido/localizador/:localizador' acima.
//
// Perfil OPERADOR, e não consulta: esta é a tela de quem executa o atendimento
// (imprimir, etiquetar, registrar). Quem só consulta usa a lista de pedidos.
//
// DUAS FILAS, e `?incluir_remetidos=true` escolhe a segunda. Sem a query a rota
// devolve a fila de IMPRESSÃO (1, 2 e 3), que é o contrato que o plugin do QGIS
// já instalado espera. Com ela devolve a fila de ATENDIMENTO, que traz também o
// pedido Remetido (4), ainda à espera da marca de Concluído. Ver
// `query_fragments.js` para a razão de as duas listas serem diferentes.
router.get(
  '/pedido/em_aberto',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({ query: mapotecaSchema.filaQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getPedidosEmAberto({
      incluirRemetidos: req.query.incluir_remetidos
    })
    const msg = 'Pedidos em aberto retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/pedido/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.pedidoId
  }),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params
    const dados = await mapotecaCtrl.getPedidoById(id)
    const msg = 'Detalhes do pedido retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// O que IMPRIMIR de um pedido, com a carta de cada item.
//
// Leitura pura, ao contrário de '/pedido/:id/download_impressao', que cria token e
// devolve caminho de volume para o plugin do QGIS. Aqui vem o uuid_arquivo, e o
// navegador baixa por GET /acervo/arquivo/:uuid/download.
router.get(
  '/pedido/:id/impressao',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.pedidoId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getImpressaoDoPedido(req.params.id)
    const msg = 'Itens para impressão retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Baixa a CARTA de um item do pedido, pelo navegador.
//
// Existe apesar de '/acervo/arquivo/:uuid/download' fazer o mesmo stream, e a
// razão é a permissão: quem atende pedido tem operador na MAPOTECA e pode não ter
// perfil nenhum no acervo. Pela rota do acervo ele levava 403 no meio da tela
// feita para ele. A permissão segue o MÓDULO do trabalho, não o do dado.
//
// O par (pedido, arquivo) é conferido no banco: sem isso, esta rota viraria um
// download do acervo inteiro com perfil de mapoteca, bastando trocar o uuid.
router.get(
  '/pedido/:id/arquivo/:uuid_arquivo/download',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.arquivoImpressaoParams
  }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await mapotecaCtrl.getArquivoDeImpressao(
      req.params.id,
      req.params.uuid_arquivo
    )
    await enviarArquivo.enviarArquivoDoVolume(req, res, arquivo)
  })
)

router.post(
  '/pedido',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.pedido
  }),
  asyncHandler(async (req, res, next) => {
    const result = await mapotecaCtrl.criaPedido(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Pedido criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, result)
  })
)

router.put(
  '/pedido',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.pedidoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaPedido(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Pedido atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/pedido',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.pedidoIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deletePedidos(req.body.pedido_ids, req.usuarioUuid, req.contexto)
    const msg = 'Pedidos deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Impressão de Pedidos (plugin QGIS da mapoteca)

// Prepara o download dos PDFs das cartas do pedido para impressão.
// Cria tokens em acervo.download; o plugin confirma via /api/acervo/confirm-download.
router.post(
  '/pedido/:id/download_impressao',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.pedidoId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.prepareDownloadImpressao(req.params.id, req.usuarioUuid)
    const msg = 'Download para impressão preparado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Fecha o par aberto por '/pedido/:id/download_impressao'.
//
// Existe pela MESMA razão de '/pedido/:id/arquivo/:uuid_arquivo/download': a
// permissão segue o MÓDULO do trabalho, e não o do dado. A rota gêmea do acervo
// (POST /acervo/confirm-download) é `verifyPerfil('consulta')` SEM módulo, ou
// seja, consulta no ACERVO, e quem atende pedido tem operador na mapoteca e
// pode não ter perfil nenhum no acervo.
//
// O que isso custava, medido no plugin: o prepare passava (mapoteca), os PDFs
// eram copiados do volume, e o confirm levava 403. O operador via dois diálogos
// de erro em cima de um download que tinha dado certo, e os tokens ficavam
// 'pending' até alguém rodar a limpeza pela tela de Manutenção. O histórico de
// download passava a registrar falha em toda impressão bem-sucedida.
//
// O controlador é o MESMO do acervo, de propósito: `acervo.download` é uma
// tabela só, e duas implementações de "confirmar download" divergiriam na
// primeira coluna nova.
router.post(
  '/impressao/confirmar_download',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({ body: acervoSchema.downloadConfirmations }),
  asyncHandler(async (req, res, next) => {
    const dados = await acervoCtrl.confirmDownload(req.body.confirmations)
    const msg = 'Status de download atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Registra sessões de impressão (log operacional, qualquer usuário logado)
router.post(
  '/impressao',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.registroImpressao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.registrarImpressao(req.body.registros, req.usuarioUuid, req.contexto)
    const msg = 'Impressão registrada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

// Corrige a DATA de um registro de impressao ja gravado.
//
// GERENTE, e nao operador: registrar impressao e operacao do dia, mas mudar
// QUANDO um gasto aconteceu muda o numero que o RPCMTec reporta naquele mes. E
// PUT numa rota propria, e nao um campo do POST, porque nao e o mesmo ato --
// mesma razao que separa a correcao de transcricao da alteracao do PIT.
router.put(
  '/impressao/:id/data',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.impressaoId,
    body: mapotecaSchema.corrigirImpressao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.corrigirDataImpressao(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    const msg = 'Data da impressão corrigida com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Histórico de impressão de um item do pedido
router.get(
  '/produto_pedido/:id/impressao',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.produtoPedidoId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getImpressoesItem(req.params.id)
    const msg = 'Histórico de impressão retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Remove registros de impressão (correções)
router.delete(
  '/impressao',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.impressaoIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteImpressoes(req.body.impressao_ids, req.usuarioUuid, req.contexto)
    const msg = 'Registros de impressão deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Produto do Pedido
router.post(
  '/produto_pedido',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.produtoPedido
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.criaProdutoPedido(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Produto adicionado ao pedido com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/produto_pedido',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.produtoPedidoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaProdutoPedido(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Produto do pedido atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/produto_pedido',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.produtoPedidoIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteProdutosPedido(req.body.produto_pedido_ids, req.usuarioUuid, req.contexto)
    const msg = 'Produtos do pedido deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Plotter
router.get(
  '/plotter',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getPlotters()
    const msg = 'Plotters retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/plotter/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.plotterId
  }),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params
    const dados = await mapotecaCtrl.getPlotterById(id)
    const msg = 'Detalhes do plotter retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/plotter',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.plotter
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.criaPlotter(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Plotter criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/plotter',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.plotterAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaPlotter(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Plotter atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/plotter',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.plotterIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deletePlotters(req.body.plotter_ids, req.usuarioUuid, req.contexto)
    const msg = 'Plotters deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Manutenção de Plotter
router.get(
  '/manutencao_plotter',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getManutencoesPlotter()
    const msg = 'Manutenções de plotter retornadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/manutencao_plotter/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.manutencaoPlotterId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getManutencaoPlotterById(req.params.id)
    const msg = 'Manutenção de plotter retornada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/manutencao_plotter',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.manutencaoPlotter
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.criaManutencaoPlotter(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Manutenção de plotter registrada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created)
  })
)

router.put(
  '/manutencao_plotter',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.manutencaoPlotterAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaManutencaoPlotter(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Manutenção de plotter atualizada com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/manutencao_plotter',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.manutencaoPlotterIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteManutencoesPlotter(req.body.manutencao_ids, req.usuarioUuid, req.contexto)
    const msg = 'Manutenções de plotter deletadas com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Tipo de Material
//
// O CADASTRO DE MATERIAL É DO OPERADOR desde 2026-08-08, e era de gerente.
//
// A régua da casa diz que `consulta` LÊ as telas do módulo, `operador` LANÇA e
// `gerente` responde pela área. Cadastrar insumo é lançar: quem lança consumo e
// faz contagem na prateleira é a mesma pessoa que descobre, ali, que o cartucho
// novo ainda não existe no sistema. Exigir gerente para essa linha fazia a
// contagem parar e esperar.
//
// Morreu junto a LISTA NÃO HIERÁRQUICA que servia a tela de material
// (`perfis: ['consulta','gerente']`, que exclui o operador): ela existia porque
// a tela era de cadastro e o operador não a via. Com a tela única do livro, o
// operador é justamente quem mais a usa.
router.get(
  '/tipo_material',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getTiposMaterial()
    const msg = 'Tipos de material retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/tipo_material/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.tipoMaterialId
  }),
  asyncHandler(async (req, res, next) => {
    const { id } = req.params
    const dados = await mapotecaCtrl.getTipoMaterialById(id)
    const msg = 'Detalhes do tipo de material retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/tipo_material',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.tipoMaterial
  }),
  asyncHandler(async (req, res, next) => {
    const id = await mapotecaCtrl.criaTipoMaterial(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Tipo de material criado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, { id })
  })
)

router.put(
  '/tipo_material',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.tipoMaterialAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaTipoMaterial(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Tipo de material atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/tipo_material',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.tipoMaterialIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteTiposMaterial(req.body.tipo_material_ids, req.usuarioUuid, req.contexto)
    const msg = 'Tipos de material deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// Rotas para Estoque de Material
//
// SÓ LEITURA desde 2026-08-08. O saldo é o ACUMULADO do livro de movimentos,
// aplicado por gatilho, e por isso não tem mais porta própria de escrita: as
// antigas `POST`, `PUT`, `DELETE` e `POST /transferir` mexiam na quantidade sem
// data e sem motivo, e uma delas sobrevivendo ao lado do livro faria a soma do
// livro deixar de bater com o saldo no primeiro uso.
//
// Quem quer mudar o saldo lança um movimento: Entrada, Transferência, Consumo ou
// Contagem. Ver `POST /movimento_material`, logo abaixo.
router.get(
  '/estoque_material',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getEstoqueMaterial()
    const msg = 'Estoque de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/estoque_por_localizacao',
  verifyPerfil('consulta', 'mapoteca'),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getEstoquePorLocalizacao()
    const msg = 'Estoque por localização retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/estoque_material/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.estoqueMaterialId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getEstoqueMaterialById(req.params.id)
    const msg = 'Estoque de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// O LIVRO DE MOVIMENTOS
//
// Entrada, Transferência, Consumo e Contagem, numa tabela só e cada linha com
// data. Ele substituiu `/consumo_material`, que guardava só um dos quatro
// movimentos e por isso nunca explicou um saldo inteiro.
//
// LER é de CONSULTA e LANÇAR é de OPERADOR, inclusive a Contagem. A régua manda
// separar quem lê de quem lança, e não esconder de quem lê o que o agregado
// mensal dele já mostra somado: a lista de lançamentos deixar de abrir para a
// consulta seria regressão, e foi um 403 vivo em 2026-08-08.
//
// A ROTA LITERAL VEM ANTES da rota com parâmetro: o Express casa na ordem de
// declaração, e `/consumo_mensal` cairia em `/movimento_material/:id` se as duas
// dividissem prefixo.
router.get(
  '/movimento_material',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.movimentoMaterialFiltro
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getMovimentosMaterial(req.query)
    const msg = 'Movimentos de material retornados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/consumo_mensal',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getConsumoMensalPorTipo(req.query.ano)
    const msg = 'Consumo mensal por tipo de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/movimento_material/:id',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.movimentoMaterialId
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await mapotecaCtrl.getMovimentoMaterialById(req.params.id)
    const msg = 'Movimento de material retornado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.post(
  '/movimento_material',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.movimentoMaterial
  }),
  asyncHandler(async (req, res, next) => {
    const id = await mapotecaCtrl.criaMovimentoMaterial(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Movimento de material registrado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.Created, { id })
  })
)

router.put(
  '/movimento_material',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.movimentoMaterialAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.atualizaMovimentoMaterial(req.body, req.usuarioUuid, req.contexto)
    const msg = 'Movimento de material atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/movimento_material',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    body: mapotecaSchema.movimentoMaterialIds
  }),
  asyncHandler(async (req, res, next) => {
    await mapotecaCtrl.deleteMovimentosMaterial(req.body.movimento_material_ids, req.usuarioUuid, req.contexto)
    const msg = 'Movimentos de material deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)


// Rotas de relatórios anuais (reproduzem as abas da planilha de controle).
// Aceitam ?ano= (default ano corrente) e ?formato=csv para download.
router.get(
  '/relatorio/pedidos_mil',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosMil(ano)
    const msg = 'Relatório de pedidos militares retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `pedidos_mil_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_MIL
    })
  })
)

router.get(
  '/relatorio/pedidos_detalhado',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosDetalhado(ano)
    const msg = 'Relatório detalhado de pedidos retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `pedidos_detalhado_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_DETALHADO
    })
  })
)

router.get(
  '/relatorio/pedidos_civ',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosCiv(ano)
    const msg = 'Relatório de pedidos civis retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `pedidos_civ_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_CIV
    })
  })
)

router.get(
  '/relatorio/tematicos',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioTematicos(ano)
    const msg = 'Relatório de produção temática retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `tematicos_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_TEMATICOS
    })
  })
)

// Impressão detalhada: mesmos dados do relatório Detalhado, recortados nas 15
// colunas da planilha de impressão.
router.get(
  '/relatorio/impressao_detalhada',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosDetalhado(ano)
    const msg = 'Relatório de impressão detalhada retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `impressao_detalhada_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_IMPRESSAO_DETALHADA
    })
  })
)

// Impressão detalhada em .ods, na FORMA da aba META4_DETALHADA do RTM.
//
// Rota SEPARADA da de cima, e não um ?formato=ods nela, de propósito: as duas
// não devolvem o mesmo conteúdo. O CSV traz o dado cru do banco ('Sulfite 90g',
// booleano); o .ods traz o vocabulário da aba ('sulfite', 'sim'/'não'), a data
// como DATA, a quantidade como NÚMERO e a ordem cronológica de entrega. Servir
// as duas coisas pelo mesmo endereço esconderia essa diferença.
//
// Sempre baixa (não tem ?formato=json): o corpo é um arquivo binário.
router.get(
  '/relatorio/impressao_detalhada_ods',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.anoQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosDetalhado(ano)
    // MESMO gerador da rota /api/rpcmtec/rtm/ods, de proposito: dois caminhos
    // para o mesmo arquivo com formatos diferentes e a divergencia que a fusao
    // do RPCMTec existiu para acabar. Ele mora em `rpcmtec/` porque e onde ficam
    // as planilhas-semente; nao ha ciclo, o modulo dele so importa `utils`.
    const buffer = gerarRtmOds(relatorioCtrl.paraAbaMeta4(dados))
    res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
    res.setHeader('Content-Disposition', `attachment; filename="META4_DETALHADA_${ano}.ods"`)
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// O Anuário Estatístico NÃO tem rota aqui: ele sai por /api/rpcmtec/anuario,
// porque os dois sobem para a DSG no mesmo envio mensal e da mesma tela. O
// `anuario_ctrl` fica NESTE módulo, que é onde a entrega é registrada.

// Resumo de pedidos: uma linha por pedido (todos os clientes) com dados de envio
// e o consolidado de produtos entregues por tipo e escala.
router.get(
  '/relatorio/pedidos_resumo',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({
    query: mapotecaSchema.relatorioQuery
  }),
  asyncHandler(async (req, res, next) => {
    const { ano, formato } = req.query
    const dados = await relatorioCtrl.getRelatorioPedidosResumo(ano)
    const msg = 'Relatório-resumo de pedidos retornado com sucesso'
    return csvExport.sendReport(res, formato, msg, dados, {
      filename: `pedidos_resumo_${ano}.csv`,
      columns: relatorioCtrl.COLUNAS_PEDIDOS_RESUMO
    })
  })
)

// --- Anexos do pedido (documento de solicitação + arquivos) -----------------

// Lista os anexos (só metadados) de um pedido.
router.get(
  '/pedido/:id/anexos',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.anexoPedidoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await anexoPedidoCtrl.listarPorPedido(req.params.id)

    const msg = 'Anexos do pedido retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Anexa um arquivo a um pedido. O arquivo vem no campo multipart "arquivo";
// tipo_anexo_id e descricao (opcionais) vêm no corpo. Ordem: auth -> valida
// params -> multer -> valida corpo -> handler.
router.post(
  '/pedido/:id/anexos',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.anexoPedidoParams }),
  uploadAnexoPedido,
  schemaValidation({ body: mapotecaSchema.anexoUploadBody }),
  asyncHandler(async (req, res, next) => {
    if (!req.file) {
      throw new AppError(
        'Nenhum arquivo enviado (campo "arquivo")',
        httpCode.BadRequest
      )
    }

    const dados = await anexoPedidoCtrl.criar(
      req.params.id,
      req.file,
      req.body,
      req.usuarioUuid,
      req.contexto
    )

    const msg = 'Anexo do pedido cadastrado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.Created, dados)
  })
)

// Baixa o arquivo de um anexo (bytes do banco) com o nome original.
router.get(
  '/pedido/anexo/:anexoId/download',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    const arquivo = await anexoPedidoCtrl.getParaDownload(req.params.anexoId)

    res.setHeader(
      'Content-Type',
      arquivo.mimetype || 'application/octet-stream'
    )
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(arquivo.nome_original)}`
    )

    return res.send(arquivo.conteudo)
  })
)

// Remove um anexo do pedido.
router.delete(
  '/pedido/anexo/:anexoId',
  verifyPerfil('gerente', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.anexoIdParams }),
  asyncHandler(async (req, res, next) => {
    await anexoPedidoCtrl.deletar(req.params.anexoId, req.usuarioUuid, req.contexto)

    const msg = 'Anexo do pedido excluído com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

// --- Etiqueta de envio do pedido --------------------------------------------

// Etiqueta salva do pedido, ou dados nulo quando ainda não houver.
//
// Perfil de CONSULTA: quem lê o pedido lê a etiqueta dele, que é só o endereço
// já cadastrado, com a correção aplicada.
router.get(
  '/pedido/:id/etiqueta',
  verifyPerfil('consulta', 'mapoteca'),
  schemaValidation({ params: mapotecaSchema.etiquetaPedidoParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await etiquetaEnvioCtrl.getPorPedido(req.params.id)

    const msg = 'Etiqueta de envio retornada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// Grava a etiqueta do pedido (cria na primeira vez, substitui nas seguintes).
//
// Perfil de OPERADOR, e não gerente: quem embala o pacote é quem descobre que o
// endereço do DIEx está errado, e é ele quem corrige. Mesmo perfil das outras
// rotas do atendimento (imprimir, registrar impressão).
router.put(
  '/pedido/:id/etiqueta',
  verifyPerfil('operador', 'mapoteca'),
  schemaValidation({
    params: mapotecaSchema.etiquetaPedidoParams,
    body: mapotecaSchema.etiquetaEnvio
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await etiquetaEnvioCtrl.salvar(
      req.params.id,
      req.body,
      req.usuarioUuid,
      req.contexto
    )

    const msg = 'Etiqueta de envio salva com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// --- Auditoria do pedido ----------------------------------------------------
//
// NÃO MORA MAIS AQUI, e não é para voltar. Havia um
// `GET /pedido/:id/auditoria` que servia o MESMO conteúdo de
// `GET /api/auditoria/mapoteca/pedido/:id`, pelo caminho antigo. O comentário
// dele dizia que a tela do pedido o consumia, e não consumia mais: o histórico
// das seis fichas do sistema saiu para `@components/historico/` do client, que
// lê a rota de plataforma. Nem o plugin nem o mapoteca_cli chamavam o caminho
// antigo. Duas rotas para o mesmo dado divergem na primeira que alguém corrigir.
//
// A rota de plataforma tem a MESMA guarda: quem lê o pedido lê o histórico dele
// (o `guardaDoHistorico` de auditoria_route.js tira o módulo do próprio
// caminho, e para 'mapoteca' cobra perfil de consulta na mapoteca).

module.exports = router