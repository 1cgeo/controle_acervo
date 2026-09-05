'use strict'

// CAMPO: a atividade que a Divisao executa fora dela.
//
// Reambulacao, voo de drone, ponto de controle, modelo 3D e panoramica 360. E a
// fonte da subsecao 2.5 do RPCMTec, que ate 2026-08-08 era DIGITADA a partir da
// tela do SAP.
//
// O MODULO E `pit`, E NAO UM MODULO NOVO. A tela mora na secao PIT, e
// `dominio.modulo` continua com seis linhas: campo e o trabalho que o PIT
// promete, e nao uma area propria a conceder. Quem tem perfil no PIT (o code 4,
// que se chamou `producao` ate 2026-08-09) alcanca esta rota.
//
// A REGUA DE PERFIL, pela frase da casa (2026-08-08): `consulta` LE as telas do
// modulo, `operador` LANCA, `gerente` responde pela area. Aqui isso quer dizer:
//
//   consulta  - ve a lista, o mapa, a ficha, as fotos e os trajetos
//   operador  - LANCA: cadastra e corrige o campo, sobe foto e video, importa
//               track
//   gerente   - APAGA o campo
//
// A EXCLUSAO E DE GERENTE, e a assimetria e deliberada. O `ON DELETE CASCADE` do
// DDL leva junto as categorias, os militares, as versoes, as fotos, os videos,
// os tracks e os pontos de GPS: apagar um campo de 2019 destroi as unicas copias
// daquelas fotos. E o mesmo criterio que poe a remocao de tipo em
// `equipamento` no piso de gerente -- nao e a escrita que pesa, e o alcance
// dela.
//
// Apagar FOTO e TRACK continua sendo de operador, e nao e incoerencia: quem
// subiu o arquivo errado ha um minuto tem de poder tira-lo, e o alcance e uma
// linha.

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

// O validador ESTRITO, e nao o tolerante de `utils/schema_validation.js`. Ele
// recusa a chave desconhecida no corpo com 400 e sugere o nome declarado mais
// parecido, em vez de descarta-la em silencio. E a escolha do orcamento e do
// equipamento, e aqui nao custa nada: o modulo nasceu hoje e nao ha carregador
// legado mandando campo a mais.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const campoCtrl = require('./campo_ctrl')
const campoSchema = require('./campo_schema')

const router = express.Router()

// TODA ROTA LITERAL VEM ANTES DE `/:id`, e a ordem deste arquivo E o contrato.
// O Express casa na ORDEM DE DECLARACAO: com `/:id` declarada antes, `/dominio`
// e `/geojson` cairiam nela e morreriam no Joi de `idParams` com um 400 dizendo
// que "dominio" nao e numero.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele e 'acervo':
// uma rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro
// de sintaxe, sem teste vermelho e sem nada na tela. Aqui
// `__tests__/routes/modulo_em_toda_rota.test.js` COBRA: este arquivo entrou na
// varredura (`{ nome: 'campo', modulo: 'pit' }`) e e o primeiro a cobrir `pit`.
// No RESTO do modulo `pit` ninguem cobra por voce.

// --- Dominio -----------------------------------------------------------------

router.get(
  '/dominio',
  verifyPerfil('consulta', 'pit'),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.getDominio()
    return res.sendJsonAndLog(
      true, 'Domínios de campo retornados com sucesso', httpCode.OK, dados
    )
  })
)

// --- Mapa --------------------------------------------------------------------

// A MESMA CONSULTA DA LISTA, embrulhada em FeatureCollection. As duas visoes da
// tela leem o MESMO recorte: um filtro que mudasse so numa delas faria a tabela
// e o mapa discordarem sobre quantos campos existem.
router.get(
  '/geojson',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ query: campoSchema.campoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.geojson(req.query)
    return res.sendJsonAndLog(
      true, 'Campos em GeoJSON retornados com sucesso', httpCode.OK, dados
    )
  })
)

// --- Imagem ------------------------------------------------------------------
//
// AS ROTAS DE IMAGEM E DE TRACK POR ID PROPRIO vem antes de `/:id` por seguranca
// de leitura, embora tenham dois segmentos e nao pudessem colidir. Manter os
// blocos juntos e o que evita que alguem acrescente `/imagem` (um segmento so)
// no fim do arquivo e descubra o 400 em producao.

// OS BYTES SAEM AQUI, e so aqui. Uma imagem por vez, e nunca numa listagem:
// sao 186 MB de foto e video no acervo do SAP, e trafega-los para desenhar uma
// tabela de nomes seria pagar o arquivo inteiro por engano.
router.get(
  '/imagem/:imagemId/arquivo',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ params: campoSchema.imagemIdParams }),
  asyncHandler(async (req, res, next) => {
    const imagem = await campoCtrl.lerImagem(req.params.imagemId)
    // `res.send` CRU, e nao `sendJsonAndLog`: o corpo aqui e binario. E a mesma
    // excecao que as rotas de anexo do orcamento e da mapoteca ja abrem.
    //
    // O TIPO SO SAI DAQUI SE ESTIVER NA LISTA, e a conferencia se repete na
    // saida por um motivo: o schema fecha a porta de ENTRADA, e as 143 linhas do
    // dump do SAP entraram por outra (a carga adivinha o tipo pelo numero
    // magico). Sem esta linha, um `mime_type` gravado antes da lista continuaria
    // sendo declarado ao navegador na origem da propria aplicacao.
    //
    // O tipo generico cobre os dois casos: `mime_type` nulo (133 das 143 imagens
    // do dump estao sem ele) e tipo fora da lista. 'application/octet-stream'
    // faz o navegador baixar em vez de tentar desenhar -- ou EXECUTAR -- algo
    // que nao sabe o que e.
    const tipo = campoSchema.MIME_IMAGEM_PERMITIDOS.includes(imagem.mime_type)
      ? imagem.mime_type
      : 'application/octet-stream'
    res.setHeader('Content-Type', tipo)
    return res.send(imagem.conteudo)
  })
)

router.put(
  '/imagem/:imagemId',
  verifyPerfil('operador', 'pit'),
  schemaValidation({
    params: campoSchema.imagemIdParams,
    body: campoSchema.imagemUpdate
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.atualizarImagem(
      req.params.imagemId, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Imagem atualizada com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/imagem/:imagemId',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ params: campoSchema.imagemIdParams }),
  asyncHandler(async (req, res, next) => {
    await campoCtrl.apagarImagem(
      req.params.imagemId, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Imagem removida com sucesso', httpCode.OK)
  })
)

// --- Track -------------------------------------------------------------------

router.put(
  '/track/:trackId',
  verifyPerfil('operador', 'pit'),
  schemaValidation({
    params: campoSchema.trackIdParams,
    body: campoSchema.trackUpdate
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.atualizarTrack(
      req.params.trackId, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Track atualizado com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/track/:trackId',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ params: campoSchema.trackIdParams }),
  asyncHandler(async (req, res, next) => {
    await campoCtrl.apagarTrack(
      req.params.trackId, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Track removido com sucesso', httpCode.OK)
  })
)

// --- Campo -------------------------------------------------------------------

router.get(
  '/',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ query: campoSchema.campoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.listar(req.query)
    return res.sendJsonAndLog(
      true, 'Campos retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ body: campoSchema.campo }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.criar(req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(
      true, 'Campo criado com sucesso', httpCode.Created, dados
    )
  })
)

// As rotas FILHAS de um campo vem antes de `/:id` sozinha? Nao precisam: elas
// tem dois segmentos, e `/:id` casa um so. A ordem aqui e a da LEITURA.

router.get(
  '/:id/imagem',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ params: campoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.listarImagens(req.params.id)
    return res.sendJsonAndLog(
      true, 'Imagens do campo retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/:id/imagem',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ params: campoSchema.idParams, body: campoSchema.imagem }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.criarImagem(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Imagem enviada com sucesso', httpCode.Created, dados
    )
  })
)

router.get(
  '/:id/track',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ params: campoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.listarTracks(req.params.id)
    return res.sendJsonAndLog(
      true, 'Trajetos do campo retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/:id/track',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ params: campoSchema.idParams, body: campoSchema.track }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.criarTrack(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Trajeto importado com sucesso', httpCode.Created, dados
    )
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'pit'),
  schemaValidation({ params: campoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.buscarPorId(req.params.id)
    return res.sendJsonAndLog(
      true, 'Campo retornado com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/:id',
  verifyPerfil('operador', 'pit'),
  schemaValidation({ params: campoSchema.idParams, body: campoSchema.campo }),
  asyncHandler(async (req, res, next) => {
    const dados = await campoCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Campo atualizado com sucesso', httpCode.OK, dados
    )
  })
)

// GERENTE, e nao operador. Ver o cabecalho deste arquivo: o CASCADE leva as
// fotos e os trajetos junto.
router.delete(
  '/:id',
  verifyPerfil('gerente', 'pit'),
  schemaValidation({ params: campoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await campoCtrl.apagar(req.params.id, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Campo removido com sucesso', httpCode.OK)
  })
)

module.exports = router
