'use strict'

// ZONA DE PERIGO. O nome e herdado do SAP 2.3.5 e ele avisa o que e: as 11 rotas
// deste arquivo apagam, e o que elas apagam nao volta.
//
// O PISO E GERENTE EM `producao`, NAS ONZE, INCLUSIVE NAS DUAS LEITURAS.
//
// Pela regua da casa (2026-08-08), `consulta` LE as telas do modulo. Aqui a
// leitura NAO e uma tela: `GET /perigo/propriedades_camada` e
// `GET /perigo/insumo` existem para MONTAR o corpo do PUT e do DELETE que vem em
// seguida -- sao a metade de uma operacao destrutiva, e nao um relatorio. Alem
// disso `producao.insumo.caminho` e pasta de rede da instalacao. Quem so consulta
// producao ve o acompanhamento em `/api/acompanhamento`; aqui nao ha o que ele
// precise ler.
//
// A TRADUCAO DA GUARDA DA ORIGEM E DIRETA, e vem do cabecalho de `routes.js`:
// `verifyAdmin` do SAP vira gerente em `producao`, com o administrador global
// passando por cima como sempre. La `verifyAdmin` era o unico degrau acima de
// "esta logado"; aqui existe o gerente do modulo, que e quem responde pela area.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele e 'acervo': uma
// rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, e o gerente do
// acervo -- que nao responde por producao nenhuma -- apagaria unidade de trabalho.
//
// AS TRES ROTAS QUE VARREM EXIGEM CONFIRMACAO NO CORPO, e o porque esta em
// `perigo_schema.js`, junto da forma. Em resumo: um `DELETE` sem corpo, disparado
// por uma aba aberta ou por uma seta para cima no terminal, e acidente esperando
// acontecer, e a casa ja resolveu isso uma vez no `--confirmar` dos CLIs.
//
// NENHUMA ROTA DAQUI ALCANCA O SCHEMA `acervo`, e isso e decisao registrada em
// `docs/decisoes.md`: as duas que tentariam (`/produtos_sem_unidade_trabalho` e
// `/lote_sem_produto`) deixaram de existir em 2026-08-09, e o porque esta escrito
// no lugar delas, mais abaixo.

const express = require('express')

const { asyncHandler, httpCode, AppError } = require('../utils')

// O validador ESTRITO, e nao o tolerante. Ele recusa a chave desconhecida no
// corpo com 400 e sugere o nome declarado mais parecido, em vez de descarta-la em
// silencio. Numa rota que apaga, a chave descartada em silencio e o pior caso
// possivel: quem escreveu `{"confirmo": "..."}` receberia a recusa certa, mas
// quem escrevesse `{"insumo_id": [3]}` no lugar de `insumo_ids` receberia um erro
// de campo obrigatorio faltando, e nao a pista de que digitou o nome errado.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const perigoCtrl = require('./perigo_ctrl')
const perigoSchema = require('./perigo_schema')

const router = express.Router()

// TODA ROTA LITERAL VEM ANTES DE QUALQUER ROTA COM PARAMETRO. Aqui so
// `/atividades/usuario/:uuid` tem parametro, e ela nao disputa caminho com
// nenhuma outra -- mas a ordem do arquivo segue a regra da casa mesmo assim, para
// que a proxima rota acrescentada nao tenha de descobrir onde entra.

// --- Propriedades de camada ---------------------------------------------------
//
// COMO A CAMADA SE COMPORTA EM CADA SUBFASE: se ela e incomum, se e de
// apontamento, e quais atributos o plugin le. Ela esta aqui, e nao em
// `/api/producao`, porque a origem a pos aqui: uma linha errada nesta tabela
// muda o comportamento do QGIS de todo mundo que abrir aquela subfase.

router.get(
  '/propriedades_camada',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await perigoCtrl.getPropriedadesCamada()
    return res.sendJsonAndLog(
      true, 'Propriedades de camada retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/propriedades_camada',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: perigoSchema.propriedadesCamadaCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await perigoCtrl.criaPropriedadesCamada(
      req.body.propriedades_camada, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Propriedades de camada criadas com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/propriedades_camada',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: perigoSchema.propriedadesCamadaAtualizar }),
  asyncHandler(async (req, res, next) => {
    await perigoCtrl.atualizaPropriedadesCamada(
      req.body.propriedades_camada, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Propriedades de camada atualizadas com sucesso', httpCode.OK
    )
  })
)

// SEM CONFIRMACAO NO CORPO, e a assimetria com as cinco de baixo e deliberada:
// esta recebe a LISTA DE IDS do que apagar. O alvo ja e explicito, e um segundo
// campo de confirmacao viraria ritual -- quem monta a lista dos ids esta olhando
// para o que escolheu.
router.delete(
  '/propriedades_camada',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: perigoSchema.propriedadesCamadaIds }),
  asyncHandler(async (req, res, next) => {
    await perigoCtrl.deletePropriedadesCamada(
      req.body.propriedades_camada_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Propriedades de camada excluídas com sucesso', httpCode.OK
    )
  })
)

// --- Insumo -------------------------------------------------------------------

router.get(
  '/insumo',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await perigoCtrl.getInsumo()
    return res.sendJsonAndLog(
      true, 'Insumos retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: perigoSchema.insumoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await perigoCtrl.criaInsumo(
      req.body.insumo, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Insumos criados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: perigoSchema.insumoAtualizar }),
  asyncHandler(async (req, res, next) => {
    await perigoCtrl.atualizaInsumo(
      req.body.insumo, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Insumos atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/insumo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: perigoSchema.insumoIds }),
  asyncHandler(async (req, res, next) => {
    await perigoCtrl.deleteInsumo(
      req.body.insumo_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Insumos excluídos com sucesso', httpCode.OK)
  })
)

// --- As três que varrem -------------------------------------------------------

router.delete(
  '/log',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: perigoSchema.limpaLogBody }),
  asyncHandler(async (req, res, next) => {
    const dados = await perigoCtrl.limpaLog(
      req.usuarioUuid, req.contexto, req.body.motivo
    )
    return res.sendJsonAndLog(
      true, 'Log anterior a três dias apagado com sucesso', httpCode.OK, dados
    )
  })
)

// NÃO EXISTEM `/produtos_sem_unidade_trabalho` NEM `/lote_sem_produto`, e a
// ausência é a regra (chefe, 2026-08-09).
//
// As duas vieram do SAP 2.3.5 e a PREMISSA delas morreu na travessia. Lá, o
// produto e o lote pertenciam a `macrocontrole` e só existiam para a produção:
// produto sem unidade de trabalho era lixo de cadastro, e apagá-lo era faxina.
//
// Aqui o produto é `acervo.versao` e o lote é `acervo.lote`, e os dois existem
// SEM produção nenhuma: registro histórico, carga externa, folha que a Divisão
// recebeu pronta. Medido em 2026-08-08, no dump de produção: são 7.638 versões
// e 105 lotes, e o schema `producao` nasceu VAZIO. Uma varredura por "versão sem
// unidade de trabalho" selecionaria o acervo INTEIRO, e o `DELETE` dela seria a
// perda total, com o rastro dizendo que alguém pediu.
//
// Não se trata de baixar o alcance da rota nem de acrescentar confirmação: o
// critério em si deixou de significar o que significava. Rota cuja premissa
// morreu não vira rota mais cuidadosa, vira rota que não existe.
//
// `/ut_sem_atividade` CONTINUA, e a diferença é essa mesma: unidade de trabalho
// é objeto de `producao`, criada para ser trabalhada, e uma sem atividade
// nenhuma é de fato configuração órfã. O alcance dela para dentro do schema.

router.delete(
  '/ut_sem_atividade',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: perigoSchema.utSemAtividadeBody }),
  asyncHandler(async (req, res, next) => {
    const dados = await perigoCtrl.deleteUtSemAtividade(
      req.usuarioUuid, req.contexto, req.body.motivo, req.body.lote_id
    )
    return res.sendJsonAndLog(
      true,
      req.body.lote_id != null
        ? `Unidades de trabalho sem atividade do lote ${req.body.lote_id} removidas com sucesso`
        : 'Unidades de trabalho sem atividade removidas com sucesso',
      httpCode.OK, dados
    )
  })
)

router.delete(
  '/atividades/usuario/:uuid',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({
    params: perigoSchema.limpaAtividadesParams,
    body: perigoSchema.limpaAtividadesBody
  }),
  asyncHandler(async (req, res, next) => {
    // A CONFIRMACAO REPETE O ALVO, e a conferencia mora aqui porque o
    // `schemaValidation` valida `params` e `body` SEPARADAMENTE: um `Joi.ref`
    // dentro do corpo nao enxerga o caminho da rota.
    //
    // COMPARACAO SEM DIFERENCIAR MAIUSCULA: um uuid e o mesmo uuid em qualquer
    // caixa, e recusar por causa disso ensinaria a copiar e colar sem ler.
    if (
      String(req.body.confirmar).toLowerCase() !==
      String(req.params.uuid).toLowerCase()
    ) {
      throw new AppError(
        'A confirmação precisa repetir o uuid do usuário do caminho da rota',
        httpCode.BadRequest
      )
    }

    const dados = await perigoCtrl.limpaAtividades(
      req.params.uuid, req.usuarioUuid, req.contexto, req.body.motivo
    )
    // A MENSAGEM DIZ O QUE SOBROU. Soltar a atividade nao devolve a unidade a
    // fila quando ela saiu de circulacao por apontamento de problema
    // (`disponivel = FALSE`), e a rota existe justamente para "a fila voltar a
    // andar": responder sucesso sem citar o passo que falta e o que faz a
    // unidade ficar fora para sempre.
    const mensagem =
      dados.unidades_indisponiveis > 0
        ? `Atividades do usuário soltas com sucesso. ${dados.unidades_indisponiveis} ` +
          'destas unidades de trabalho estão indisponíveis (saíram da distribuição por ' +
          'apontamento de problema) e não voltam à fila até alguém as liberar em ' +
          'Gerência da Produção'
        : 'Atividades do usuário soltas com sucesso'

    return res.sendJsonAndLog(true, mensagem, httpCode.OK, dados)
  })
)

module.exports = router
