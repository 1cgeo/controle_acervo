'use strict'

// O FLUXO da produção: linha de produção, fase, subfase, etapa e camadas. É o
// CADASTRO que descreve como uma folha vai do insumo ao produto pronto, e ele
// atravessou do `/api/projeto` do SAP 2.3.5 em 2026-08-09.
//
// A RÉGUA DE PERFIL: as CATORZE rotas são `verifyPerfil('gerente', 'producao')`,
// sem exceção, e isso é a TRADUÇÃO das guardas do SAP, e não uma escolha nova.
// Lá o `projeto_route.js` tinha `router.use(verifyLogin)` no topo e cada uma
// destas rotas acrescentava `verifyAdmin`: eram todas de administrador. Aqui o
// equivalente honesto é o gerente do módulo `producao`, que é quem responde pela
// área -- o administrador global continua passando por curto-circuito, como em
// qualquer módulo.
//
// A LEITURA TAMBÉM É DE GERENTE, e isto PARECE contrariar a frase da casa
// ("`consulta` LÊ as telas do módulo"). Não contraria: o que estas rotas de GET
// devolvem não é a produção, é o DESENHO dela -- a matriz de fases, subfases e
// etapas que a tela de configuração edita. Quem só consulta produção lê o
// ACOMPANHAMENTO, que é outra fatia, com outro piso. Abrir o desenho para
// `consulta` daria a lista completa de camadas e do schema do banco de produção
// a quem não vai mexer em nenhuma delas. Rebaixar alguma destas rotas é decisão,
// e decisão se registra em `docs/decisoes.md`.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele é 'acervo':
// uma rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro
// de sintaxe, sem teste vermelho e sem nada na tela. Quem cobra isso é
// `__tests__/routes/producao/fluxo.test.js`, lendo este fonte.

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

// O validador ESTRITO, e não o tolerante de `utils/schema_validation.js`: chave
// desconhecida no corpo vira 400 com sugestão do nome declarado mais parecido,
// em vez de ser descartada em silêncio. O corpo de `POST /linha_producao` tem
// quatro níveis de aninhamento, e é exatamente ali que um campo com o nome
// errado passaria despercebido -- a linha de produção nasceria sem o
// pré-requisito que quem digitou achou que tinha declarado.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const fluxoCtrl = require('./fluxo_ctrl')
const fluxoSchema = require('./fluxo_schema')

const router = express.Router()

// --- Linha de produção -------------------------------------------------------

router.get(
  '/linha_producao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ query: fluxoSchema.ativoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.getLinhasProducao(req.query.status === 'ativo')
    return res.sendJsonAndLog(
      true, 'Linhas de produção retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// CRIA A LINHA COM AS FASES E AS SUBFASES DE UMA VEZ, num corpo só. Uma linha de
// produção sem fase não produz nada, e criar as partes em requisições separadas
// deixaria o cadastro pela metade quando a segunda falhasse. Tudo numa
// transação: ver `fluxo_ctrl.js`.
router.post(
  '/linha_producao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: fluxoSchema.linhaProducao }),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.insereLinhaProducao(
      req.body.linha_producao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Linha de produção inserida com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/linha_producao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: fluxoSchema.linhaProducaoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await fluxoCtrl.atualizaLinhaProducao(
      req.body.linhas_producao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Linhas de produção atualizadas com sucesso', httpCode.OK
    )
  })
)

// --- Fase, subfase e etapa ---------------------------------------------------

router.get(
  '/fases',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.getFases()
    return res.sendJsonAndLog(true, 'Fases retornadas com sucesso', httpCode.OK, dados)
  })
)

// AS SUBFASES COM O LOTE QUE AS EXECUTA. O par (lote, linha de produção) é
// DERIVADO da etapa, e não lido de uma coluna do lote como no SAP: ver a
// explicação inteira em `fluxo_ctrl.js`.
router.get(
  '/subfases',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ query: fluxoSchema.ativoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.getSubfases(req.query.status === 'ativo')
    return res.sendJsonAndLog(
      true, 'Subfases retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// A LISTA SEM LOTE, e ela não é a de cima com uma coluna a menos: a subfase
// recém-criada, que ainda não tem etapa em lote nenhum, só aparece AQUI. É a
// lista que a tela de cadastro da linha de produção abre.
router.get(
  '/todas_subfases',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.getAllSubfases()
    return res.sendJsonAndLog(
      true, 'Todas as subfases retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/etapas',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.getEtapas()
    return res.sendJsonAndLog(
      true, 'Etapas retornadas com sucesso', httpCode.OK, dados
    )
  })
)

// AS ETAPAS PADRÃO de todas as subfases de uma fase, num lote, a partir de um
// `dominio.tipo_controle_qualidade`. O `padrao_cq` do SAP virou
// `tipo_controle_qualidade_id`, que é o nome do domínio que ele lê.
//
// Declarada DEPOIS de `GET /etapas`, e não há conflito entre as duas: o Express
// casa método e caminho exatos, e '/etapas' não casa '/etapas/padrao'. A ordem
// aqui é a de leitura, não a de necessidade.
router.post(
  '/etapas/padrao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: fluxoSchema.etapasPadrao }),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.criarEtapasPadrao(
      req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Etapas padrão criadas com sucesso', httpCode.Created, dados
    )
  })
)

// --- Camadas -----------------------------------------------------------------
//
// AS CAMADAS MORAM EM DUAS TABELAS: `producao.camada` é o par (schema, nome), e
// `producao.propriedades_camada` diz como aquela camada se comporta NUMA
// subfase. Estas cinco rotas cuidam da PRIMEIRA. As propriedades entram junto da
// linha de produção, em `POST /linha_producao`, e o Joi de lá é quem cobra a
// regra de tudo-ou-nada do apontamento antes de o CHECK do banco cobrá-la.

// A rota mais específica primeiro, embora não haja conflito: `/configuracao/
// camadas` não casa `/configuracao/camadas/linha_producao`, porque o Express
// compara o caminho inteiro. A ordem é para quem lê.
router.get(
  '/configuracao/camadas/linha_producao',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.getCamadasLinhaProducao()
    return res.sendJsonAndLog(
      true, 'Linhas de produção das camadas retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/configuracao/camadas',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.getCamadas()
    return res.sendJsonAndLog(
      true, 'Camadas retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/configuracao/camadas',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: fluxoSchema.camadas }),
  asyncHandler(async (req, res, next) => {
    const dados = await fluxoCtrl.criaCamadas(
      req.body.camadas, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Camadas criadas com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/configuracao/camadas',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: fluxoSchema.camadasAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await fluxoCtrl.atualizaCamadas(
      req.body.camadas, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Camadas atualizadas com sucesso', httpCode.OK)
  })
)

// O DELETE LEVA CORPO, e não uma lista na URL: são N ids de uma vez, vindos da
// seleção múltipla da tela. É a forma do SAP, e mantê-la evita reescrever o
// cliente do QGIS quando ele apontar para cá.
router.delete(
  '/configuracao/camadas',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: fluxoSchema.camadasIds }),
  asyncHandler(async (req, res, next) => {
    await fluxoCtrl.deleteCamadas(
      req.body.camadas_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Camadas excluídas com sucesso', httpCode.OK)
  })
)

// --- O estado das subfases de um lote ----------------------------------------

// ESTA É A ÚNICA ROTA COM PARÂMETRO DESTE ARQUIVO, E ELA VEM POR ÚLTIMO.
//
// O Express casa na ORDEM DE DECLARAÇÃO. `/lote/:lote_id/subfases` não colide
// com nenhuma das treze rotas literais acima hoje, mas a regra da casa é
// posicional e não condicional: rota com parâmetro depois de rota literal,
// sempre. Uma rota literal nova acrescentada no fim deste arquivo -- digamos
// `/lote/pendentes` -- cairia aqui e morreria no Joi de `loteIdParams` com um
// 400 dizendo que "pendentes" não é número, e o defeito ficaria no arquivo que
// NÃO foi editado. Deixá-la por último faz a rota nova entrar no lugar certo sem
// que ninguém precise lembrar disto.
//
// `lote_id` é `acervo.lote (id)`, BIGINT, e não um lote de produção: não existe
// `producao.lote` neste banco.
router.get(
  '/lote/:lote_id/subfases',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({
    params: fluxoSchema.loteIdParams,
    query: fluxoSchema.subfasesLoteQuery
  }),
  asyncHandler(async (req, res, next) => {
    const subfaseIds = req.query.subfase_ids
      ? req.query.subfase_ids.split(',').map(Number)
      : null

    const dados = await fluxoCtrl.getSubfasesLote(Number(req.params.lote_id), {
      subfaseIds,
      incluirGeom: req.query.incluir_geom === true
    })

    return res.sendJsonAndLog(
      true, 'Estado das subfases do lote retornado com sucesso', httpCode.OK, dados
    )
  })
)

module.exports = router
