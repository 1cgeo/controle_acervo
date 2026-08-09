'use strict'

// O TRABALHO do módulo PRODUÇÃO: bloco, unidade de trabalho, atividade e dado de
// produção. É o CADASTRO da produção, e atravessa do `/api/projeto` do SAP
// 2.3.5.
//
// A RÉGUA DE PERFIL, e ela é uma frase só neste arquivo: TUDO É `gerente`.
//
// Pela régua da casa (2026-08-08), `consulta` LÊ as telas do módulo, `operador`
// LANÇA e `gerente` responde pela área. As 22 rotas daqui são `verifyAdmin` no
// SAP 2.3.5, e a tradução para o SCA é `gerente` do módulo `producao`: elas
// desenham a GRADE de trabalho -- que recorte existe, em que bloco ele cai, que
// etapa se executa sobre ele e em que banco isso é editado. Quem lança é o
// operador na tela de execução, que é de OUTRO módulo; aqui ninguém lança nada,
// configura-se o que os outros vão lançar.
//
// `administrador` continua entrando em tudo, e é global: `verifyPerfil` o
// curto-circuita por desenho, e não existe administrador de módulo.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele é 'acervo':
// uma rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro
// de sintaxe, sem teste vermelho e sem nada na tela. O teste
// `__tests__/routes/producao/trabalho.test.js` lê este fonte e cobra os 22.

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

// O validador ESTRITO, e não o tolerante de `utils/schema_validation.js`. Ele
// recusa a chave desconhecida no corpo com 400 e sugere o nome declarado mais
// parecido, em vez de descartá-la em silêncio. Aqui ele vale mais do que em
// qualquer outro módulo: o corpo destas rotas é ARRAY, e uma chave errada dentro
// do item 700 de uma carga em massa passaria despercebida para sempre.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const trabalhoCtrl = require('./trabalho_ctrl')
const trabalhoSchema = require('./trabalho_schema')

const router = express.Router()

// A ORDEM DE DECLARAÇÃO DESTE ARQUIVO É O CONTRATO, e não estética.
//
// O Express casa na ORDEM em que as rotas são declaradas, e não pela
// especificidade do caminho. Nenhuma rota desta fatia tem parâmetro de caminho
// HOJE, então nada seria capturado por engano agora; mas `/unidade_trabalho` e
// `/atividades` são exatamente os prefixos que ganhariam um `/:id` amanhã, e
// nesse dia `/unidade_trabalho/bloco` cairia em `/unidade_trabalho/:id` e
// morreria no Joi dizendo que "bloco" não é número.
//
// Por isso as rotas de DOIS SEGMENTOS vêm antes das de um, já:
//
//   /unidade_trabalho/bloco, /atividades, /copiar, /reshape, /cut, /merge
//     antes de  /unidade_trabalho
//   /atividades/todas
//     antes de  /atividades
//
// A regra da casa é "rota literal ANTES de rota com parâmetro"; escrevê-la antes
// de existir o parâmetro é o que evita ter de descobri-la depois.

// --- Bloco -------------------------------------------------------------------
//
// O bloco é o recorte de DISTRIBUIÇÃO dentro do lote do acervo, e é a ele que o
// operador é habilitado: quem trabalha no bloco Sul não recebe atividade do
// bloco Norte.

router.get(
  '/bloco',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ query: trabalhoSchema.blocoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.getBlocos(req.query.status)
    return res.sendJsonAndLog(
      true, 'Blocos retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/bloco',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.blocoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.criarBlocos(
      req.body.blocos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Blocos criados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/bloco',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.blocoAtualizar }),
  asyncHandler(async (req, res, next) => {
    await trabalhoCtrl.atualizarBlocos(
      req.body.blocos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Blocos atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/bloco',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.blocoIds }),
  asyncHandler(async (req, res, next) => {
    await trabalhoCtrl.deletarBlocos(
      req.body.bloco_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Blocos excluídos com sucesso', httpCode.OK)
  })
)

// --- Unidade de trabalho: os dois segmentos primeiro --------------------------
//
// Ver o bloco de comentário do topo: estas seis vêm antes de `/unidade_trabalho`
// de propósito.

router.put(
  '/unidade_trabalho/bloco',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.unidadeTrabalhoBloco }),
  asyncHandler(async (req, res, next) => {
    await trabalhoCtrl.unidadeTrabalhoBloco(
      req.body.unidade_trabalho_ids,
      req.body.bloco_id,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Bloco das unidades de trabalho atualizado com sucesso', httpCode.OK
    )
  })
)

// A EXCLUSÃO É DAS ATIVIDADES, e não da unidade de trabalho: ela limpa as
// atividades não iniciadas (1) e não finalizadas (5) das unidades informadas.
router.delete(
  '/unidade_trabalho/atividades',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.unidadeTrabalhoIds }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.deletarAtividadesUnidadeTrabalho(
      req.body.unidade_trabalho_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true,
      'Atividades não iniciadas das unidades de trabalho excluídas com sucesso',
      httpCode.OK,
      dados
    )
  })
)

router.post(
  '/unidade_trabalho/copiar',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.unidadeTrabalhoCopiar }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.copiarUnidadesTrabalho(
      req.body.subfase_ids,
      req.body.unidade_trabalho_ids,
      req.body.associar_insumos,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Unidades de trabalho copiadas com sucesso', httpCode.Created, dados
    )
  })
)

// AS TRÊS GEOMÉTRICAS. A geometria chega em EWKT e o Joi cobra
// "SRID=4674;POLYGON" antes de o SQL tocar no banco; a coluna
// `geometry(POLYGON, 4674)` é a segunda guarda.

router.put(
  '/unidade_trabalho/reshape',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.unidadeTrabalhoReshape }),
  asyncHandler(async (req, res, next) => {
    await trabalhoCtrl.reshapeUnidadeTrabalho(
      req.body.unidade_trabalho_id,
      req.body.reshape_geom,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Unidade de trabalho remodelada com sucesso', httpCode.OK
    )
  })
)

router.put(
  '/unidade_trabalho/cut',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.unidadeTrabalhoCut }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.cutUnidadeTrabalho(
      req.body.unidade_trabalho_id,
      req.body.cut_geoms,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Unidade de trabalho cortada com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/unidade_trabalho/merge',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.unidadeTrabalhoMerge }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.mergeUnidadeTrabalho(
      req.body.unidade_trabalho_ids,
      req.body.merge_geom,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Unidades de trabalho fundidas com sucesso', httpCode.OK, dados
    )
  })
)

// --- Unidade de trabalho: o segmento único ------------------------------------

router.get(
  '/unidade_trabalho',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ query: trabalhoSchema.unidadeTrabalhoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.getUnidadesTrabalho(+req.query.lote_id)
    return res.sendJsonAndLog(
      true, 'Unidades de trabalho retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/unidade_trabalho',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.unidadeTrabalhoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.criarUnidadesTrabalho(
      req.body.unidades_trabalho,
      req.body.lote_id,
      req.body.subfase_ids,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Unidades de trabalho criadas com sucesso', httpCode.Created, dados
    )
  })
)

router.delete(
  '/unidade_trabalho',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.unidadeTrabalhoIds }),
  asyncHandler(async (req, res, next) => {
    await trabalhoCtrl.deletarUnidadesTrabalho(
      req.body.unidade_trabalho_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Unidades de trabalho excluídas com sucesso', httpCode.OK
    )
  })
)

// --- Atividade: o segmento duplo primeiro -------------------------------------

router.post(
  '/atividades/todas',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.todasAtividades }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.criarTodasAtividades(
      req.body.lote_id,
      {
        atividades_revisao: req.body.atividades_revisao,
        atividades_revisao_correcao: req.body.atividades_revisao_correcao,
        atividades_revisao_final: req.body.atividades_revisao_final
      },
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Atividades do lote criadas com sucesso', httpCode.Created, dados
    )
  })
)

router.post(
  '/atividades',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.atividadesCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.criarAtividades(
      req.body.unidade_trabalho_ids,
      req.body.etapa_ids,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Atividades criadas com sucesso', httpCode.Created, dados
    )
  })
)

router.delete(
  '/atividades',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.atividadesIds }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.deletarAtividades(
      req.body.atividades_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Atividades não iniciadas excluídas com sucesso', httpCode.OK, dados
    )
  })
)

// --- Dado de produção ---------------------------------------------------------
//
// `configuracao_producao` é o NOME do banco de produção, e NUNCA o endereço
// dele: o DDL de `er/producao.sql` diz isso com todas as letras, e este
// repositório é público.

router.get(
  '/dado_producao',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.getDadoProducao()
    return res.sendJsonAndLog(
      true, 'Dados de produção retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/dado_producao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.dadoProducaoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.criarDadoProducao(
      req.body.dado_producao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Dados de produção criados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/dado_producao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.dadoProducaoAtualizar }),
  asyncHandler(async (req, res, next) => {
    await trabalhoCtrl.atualizarDadoProducao(
      req.body.dado_producao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Dados de produção atualizados com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/dado_producao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: trabalhoSchema.dadoProducaoIds }),
  asyncHandler(async (req, res, next) => {
    await trabalhoCtrl.deletarDadoProducao(
      req.body.dado_producao_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Dados de produção excluídos com sucesso', httpCode.OK
    )
  })
)

// --- As duas leituras de conexão ----------------------------------------------

// A LISTA DE BANCOS DE PRODUÇÃO, sem servidor e sem porta. No SAP 2.3.5 esta
// rota fatia `configuracao_producao` em três com `split_part`, porque LÁ a
// coluna guarda 'servidor:porta/nome'. AQUI ela guarda só o NOME do banco, e o
// controlador explica por quê: o endereço vem da conexão que o cliente já tem, e
// este repositório é público.
router.get(
  '/banco_dados',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.getBancoDados()
    return res.sendJsonAndLog(
      true, 'Bancos de dados de produção retornados com sucesso', httpCode.OK, dados
    )
  })
)

// O LOGIN DA CONEXÃO DE EDIÇÃO, e SÓ o login.
//
// No SAP 2.3.5 esta rota devolve o par de credenciais do `config` para o cliente
// mandar o QGIS abrir a conexão do banco de produção. Aqui só o login sai, e o
// corte está explicado inteiro em `trabalho_ctrl.js`: devolver o resto do par é
// DECISÃO do chefe, e decisão se registra em `docs/decisoes.md`. O teste desta
// fatia lê o fonte do controlador e prende o corte.
router.get(
  '/login',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await trabalhoCtrl.getLogin()
    return res.sendJsonAndLog(
      true, 'Login de acesso ao banco de produção retornado com sucesso', httpCode.OK, dados
    )
  })
)

module.exports = router
