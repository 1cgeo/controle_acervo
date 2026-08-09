'use strict'

// O INSUMO, no módulo PRODUÇÃO: o grupo de insumo, o insumo e a associação dele
// com a unidade de trabalho. Atravessou do `/api/projeto` do SAP 2.3.5 em
// 2026-08-09.
//
// A RÉGUA DE PERFIL É TRADUÇÃO DAS GUARDAS DO SAP, e não uma régua nova. Lá o
// `projeto_route.js` põe `router.use(verifyLogin)` no topo e a maioria das rotas
// acrescenta `verifyAdmin`. A tradução é direta:
//
//   verifyAdmin           ->  verifyPerfil('gerente', 'producao')
//   só o verifyLogin      ->  verifyPerfil('operador', 'producao')
//
// NESTA FATIA HÁ EXATAMENTE UMA ROTA SEM `verifyAdmin` no SAP:
// `GET /unidade_trabalho/insumos`, que é a lista que o operador abre para saber
// com que dado ele vai trabalhar. Ela é `operador`; as outras ONZE são
// `gerente`, porque carregar, editar e associar insumo é ato de quem responde
// pela produção.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele é 'acervo':
// uma rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro
// de sintaxe, sem teste vermelho e sem nada na tela. Quem cobra isso é
// `__tests__/routes/producao/insumo.test.js` e
// `__tests__/routes/modulo_em_toda_rota.test.js`.
//
// SOBRE A ORDEM DE DECLARAÇÃO, para quem vier depois não se assustar: este
// arquivo declara `/unidade_trabalho/insumos` e `/bloco/insumos`, e os routers
// vizinhos de `producao/` declaram `/unidade_trabalho` e `/bloco`. Não há
// colisão, e não há ordem a respeitar entre os arquivos: o Express casa o
// caminho INTEIRO, não o prefixo, e nenhuma das quatro tem parâmetro. A regra da
// casa ("rota literal antes de rota com parâmetro") vale contra `/:id`, e aqui
// não existe nenhum `/:id`.

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

// O validador ESTRITO, como no equipamento: chave desconhecida no corpo vira 400
// com sugestão do nome mais parecido, em vez de ser descartada em silêncio. O
// módulo nasce nesta versão e não há carregador legado mandando campo a mais.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const insumoCtrl = require('./insumo_ctrl')
const insumoSchema = require('./insumo_schema')

const router = express.Router()

// --- Grupo de insumo ---------------------------------------------------------

router.get(
  '/grupo_insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ query: insumoSchema.grupoInsumoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await insumoCtrl.getGrupoInsumo(req.query)
    return res.sendJsonAndLog(
      true, 'Grupos de insumo retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/grupo_insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: insumoSchema.grupoInsumoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await insumoCtrl.gravaGrupoInsumo(
      req.body.grupo_insumos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Grupos de insumo criados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/grupo_insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: insumoSchema.grupoInsumoAtualizar }),
  asyncHandler(async (req, res, next) => {
    await insumoCtrl.atualizaGrupoInsumo(
      req.body.grupo_insumos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Grupos de insumo atualizados com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/grupo_insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: insumoSchema.grupoInsumoIds }),
  asyncHandler(async (req, res, next) => {
    await insumoCtrl.deletaGrupoInsumo(
      req.body.grupo_insumos_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Grupos de insumo excluídos com sucesso', httpCode.OK
    )
  })
)

// --- Insumo ------------------------------------------------------------------

router.get(
  '/insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ query: insumoSchema.insumoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await insumoCtrl.getInsumos(req.query)
    return res.sendJsonAndLog(
      true, 'Insumos retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: insumoSchema.insumoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await insumoCtrl.criaInsumos(
      req.body.insumos,
      req.body.tipo_insumo_id,
      req.body.grupo_insumo_id,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Insumos criados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: insumoSchema.insumoAtualizar }),
  asyncHandler(async (req, res, next) => {
    await insumoCtrl.atualizaInsumos(
      req.body.insumos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Insumos atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: insumoSchema.insumoIds }),
  asyncHandler(async (req, res, next) => {
    await insumoCtrl.deletaInsumos(
      req.body.insumo_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Insumos excluídos com sucesso', httpCode.OK)
  })
)

// --- A associação com a unidade de trabalho ----------------------------------

// A ÚNICA ROTA DE `operador` DA FATIA, e é a que o SAP deixou sem `verifyAdmin`.
// Ela responde "com que dado eu trabalho nesta unidade", que é pergunta de quem
// executa. As três abaixo são `gerente`: elas escrevem a associação em massa.
router.get(
  '/unidade_trabalho/insumos',
  verifyPerfil('operador', 'producao'),
  schemaValidation({ query: insumoSchema.unidadeTrabalhoInsumoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await insumoCtrl.getInsumosUnidadeTrabalho(
      req.query.unidade_trabalho_id
    )
    return res.sendJsonAndLog(
      true, 'Insumos da unidade de trabalho retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/unidade_trabalho/insumos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: insumoSchema.associaInsumos }),
  asyncHandler(async (req, res, next) => {
    const dados = await insumoCtrl.associaInsumos(
      req.body.unidade_trabalho_ids,
      req.body.grupo_insumo_id,
      req.body.estrategia_id,
      req.body.caminho_padrao,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Insumos associados com sucesso', httpCode.Created, dados
    )
  })
)

router.post(
  '/bloco/insumos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: insumoSchema.associaInsumosBloco }),
  asyncHandler(async (req, res, next) => {
    const dados = await insumoCtrl.associaInsumosBloco(
      req.body.bloco_id,
      req.body.subfase_ids,
      req.body.grupo_insumo_id,
      req.body.estrategia_id,
      req.body.caminho_padrao,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Insumos do bloco associados com sucesso', httpCode.Created, dados
    )
  })
)

router.delete(
  '/unidade_trabalho/insumos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: insumoSchema.deletaInsumosAssociados }),
  asyncHandler(async (req, res, next) => {
    const dados = await insumoCtrl.deletaInsumosAssociados(
      req.body.unidade_trabalho_ids,
      req.body.grupo_insumo_id,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Insumos associados excluídos com sucesso', httpCode.OK, dados
    )
  })
)

module.exports = router
