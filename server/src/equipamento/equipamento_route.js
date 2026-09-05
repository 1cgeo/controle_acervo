'use strict'

// Modulo EQUIPAMENTO: o parque de material da Divisao (estacao total, GNSS,
// plotter, drone), a situacao de cada bem HOJE e o Relatorio DMT que a Secao
// entrega.
//
// A REGUA DE PERFIL, pela frase da casa (2026-08-08): `consulta` LE as telas do
// modulo, `operador` LANCA, `gerente` responde pela area. Aqui isso quer dizer:
//
//   consulta  - ve o parque, a ficha de cada bem, o painel e tira o relatorio
//   operador  - lanca o que ACONTECE com o bem (indisponibilidade, afastamento,
//               manutencao)
//   gerente   - mexe na CARGA e no CATALOGO: cria, altera e remove o bem e o
//               TIPO, e lanca transferencia e descarga, que sao movimentacao de
//               patrimonio
//
// O TIPO E DE GERENTE NAS TRES ESCRITAS, e nao so na remocao. O motivo (a
// `vida_util_meses` que todo bem HERDA do tipo) esta escrito na secao da tela de
// Configuracao, mais abaixo, e quem faz cumprir e
// `__tests__/routes/equipamento_perfil.test.js`.

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

// O validador ESTRITO, e nao o tolerante de `utils/schema_validation.js`. Ele
// recusa a chave desconhecida no corpo com 400 e sugere o nome declarado mais
// parecido, em vez de descarta-la em silencio. E a escolha do orcamento, que e o
// molde deste modulo, e aqui ela nao custa nada: nao ha carregador em massa
// legado mandando campo a mais, porque o modulo nasceu hoje.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const equipamentoCtrl = require('./equipamento_ctrl')
const equipamentoSchema = require('./equipamento_schema')

// O gerador do .ods vive em arquivo proprio: ele monta um pacote ZIP com XML
// dentro, e nada disso e assunto de rota.
const { gerarRelatorioDmt } = require('./dmt_ods')

const router = express.Router()

// TODA ROTA LITERAL VEM ANTES DE `/:id`, e a ordem deste arquivo E o contrato.
// O Express casa na ORDEM DE DECLARACAO: com `/:id` declarada antes,
// `/tipo`, `/dashboard`, `/dominio` e `/relatorio/dmt_ods` cairiam nela e
// morreriam no Joi de `idParams` com um 400 dizendo que "tipo" nao e numero.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele e 'acervo':
// uma rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro
// de sintaxe, sem teste vermelho e sem nada na tela.

// --- Dominio -----------------------------------------------------------------

router.get(
  '/dominio',
  verifyPerfil('consulta', 'equipamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.getDominio()
    return res.sendJsonAndLog(
      true, 'Domínios do módulo equipamento retornados com sucesso', httpCode.OK, dados
    )
  })
)

// --- Tipo de equipamento (a tela "Configuracao") ------------------------------
//
// A TELA E DE GERENTE, e a LEITURA nao. Decisao do chefe em 2026-08-08: quem
// mexe no catalogo de tipos e quem responde pela area, porque `vida_util_meses`
// do tipo e HERDADA por todo bem que nao declare a propria -- alterar uma linha
// aqui muda a vida util de dezenas de bens de uma vez, sem passar por nenhum
// deles.
//
// Mas o GET fica em `consulta`, e nao e incoerencia: quem le a lista de bens
// precisa do catalogo para montar o FILTRO por tipo (`pages/bens/list.js` chama
// `getTipos()` para as opcoes). Cobrar gerente no GET deixaria o filtro de tipo
// vazio para todo mundo abaixo dele, de forma permanente, e a tela ja trata isso
// como FALHA ("O filtro de tipo ficou vazio"). Esconder a tela e uma coisa;
// tirar uma coluna de filtro de quem so consulta e outra.

router.get(
  '/tipo',
  verifyPerfil('consulta', 'equipamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.listarTipo()
    return res.sendJsonAndLog(
      true, 'Tipos de equipamento retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/tipo',
  verifyPerfil('gerente', 'equipamento'),
  schemaValidation({ body: equipamentoSchema.tipoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.criarTipo(req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(
      true, 'Tipo de equipamento criado com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/tipo/:id',
  verifyPerfil('gerente', 'equipamento'),
  schemaValidation({
    params: equipamentoSchema.idParams,
    body: equipamentoSchema.tipoAtualizar
  }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.atualizarTipo(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Tipo de equipamento atualizado com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/tipo/:id',
  verifyPerfil('gerente', 'equipamento'),
  schemaValidation({ params: equipamentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.deletarTipo(req.params.id, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(
      true, 'Tipo de equipamento excluído com sucesso', httpCode.OK
    )
  })
)

// --- Painel ------------------------------------------------------------------

router.get(
  '/dashboard',
  verifyPerfil('consulta', 'equipamento'),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.getDashboard()
    return res.sendJsonAndLog(
      true, 'Painel do módulo equipamento retornado com sucesso', httpCode.OK, dados
    )
  })
)

// --- O Relatorio DMT ---------------------------------------------------------

// A UNICA ROTA DO MODULO QUE NAO USA `sendJsonAndLog`, e isto parece defeito.
//
// `sendJsonAndLog` embrulha a resposta no envelope da casa
// (`{version, success, message, dados, error}`) e a serializa como JSON. Um
// Buffer de .ods dentro de um JSON viraria um objeto `{type:'Buffer', data:[...]}`
// ou uma string com bytes reinterpretados: o arquivo que o navegador salvasse
// nao abriria no LibreOffice. O corpo AQUI E o arquivo, e por isso ele sai por
// `res.end(buffer)`, como o PDF do RPCMTec e o .ods do RTM ja fazem.
//
// Sempre baixa, e nao tem `?formato=json`: quem quer o dado em JSON tem
// `GET /` e `GET /:id`, que devolvem o modelo do banco em vez das 26 colunas da
// planilha.
router.get(
  '/relatorio/dmt_ods',
  verifyPerfil('consulta', 'equipamento'),
  asyncHandler(async (req, res, next) => {
    const linhas = await equipamentoCtrl.linhasDoRelatorioDmt()
    const buffer = await gerarRelatorioDmt(linhas)

    res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
    res.setHeader('Content-Disposition', 'attachment; filename="relatorio_dmt.ods"')
    res.setHeader('Content-Length', String(buffer.length))
    return res.end(buffer)
  })
)

// --- Indisponibilidade -------------------------------------------------------

router.get(
  '/indisponibilidade',
  verifyPerfil('consulta', 'equipamento'),
  schemaValidation({ query: equipamentoSchema.historicoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.indisponibilidade.listar(req.query)
    return res.sendJsonAndLog(
      true, 'Indisponibilidades retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/indisponibilidade',
  verifyPerfil('operador', 'equipamento'),
  schemaValidation({ body: equipamentoSchema.indisponibilidadeCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.indisponibilidade.criar(
      req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Indisponibilidade criada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/indisponibilidade/:id',
  verifyPerfil('operador', 'equipamento'),
  schemaValidation({
    params: equipamentoSchema.idParams,
    body: equipamentoSchema.indisponibilidadeAtualizar
  }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.indisponibilidade.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Indisponibilidade atualizada com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/indisponibilidade/:id',
  verifyPerfil('operador', 'equipamento'),
  schemaValidation({ params: equipamentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.indisponibilidade.deletar(
      req.params.id, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Indisponibilidade excluída com sucesso', httpCode.OK
    )
  })
)

// --- Afastamento -------------------------------------------------------------

router.get(
  '/afastamento',
  verifyPerfil('consulta', 'equipamento'),
  schemaValidation({ query: equipamentoSchema.historicoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.afastamento.listar(req.query)
    return res.sendJsonAndLog(
      true, 'Afastamentos retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/afastamento',
  verifyPerfil('operador', 'equipamento'),
  schemaValidation({ body: equipamentoSchema.afastamentoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.afastamento.criar(
      req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Afastamento criado com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/afastamento/:id',
  verifyPerfil('operador', 'equipamento'),
  schemaValidation({
    params: equipamentoSchema.idParams,
    body: equipamentoSchema.afastamentoAtualizar
  }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.afastamento.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Afastamento atualizado com sucesso', httpCode.OK)
  })
)

router.delete(
  '/afastamento/:id',
  verifyPerfil('operador', 'equipamento'),
  schemaValidation({ params: equipamentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.afastamento.deletar(
      req.params.id, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Afastamento excluído com sucesso', httpCode.OK)
  })
)

// --- Manutencao --------------------------------------------------------------

router.get(
  '/manutencao',
  verifyPerfil('consulta', 'equipamento'),
  schemaValidation({ query: equipamentoSchema.historicoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.manutencao.listar(req.query)
    return res.sendJsonAndLog(
      true, 'Manutenções retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/manutencao',
  verifyPerfil('operador', 'equipamento'),
  schemaValidation({ body: equipamentoSchema.manutencaoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.manutencao.criar(
      req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Manutenção criada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/manutencao/:id',
  verifyPerfil('operador', 'equipamento'),
  schemaValidation({
    params: equipamentoSchema.idParams,
    body: equipamentoSchema.manutencaoAtualizar
  }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.manutencao.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Manutenção atualizada com sucesso', httpCode.OK)
  })
)

router.delete(
  '/manutencao/:id',
  verifyPerfil('operador', 'equipamento'),
  schemaValidation({ params: equipamentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.manutencao.deletar(
      req.params.id, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Manutenção excluída com sucesso', httpCode.OK)
  })
)

// --- Transferencia e descarga ------------------------------------------------

// AS TRES ESCRITAS SAO DE GERENTE, e nao de operador como as de cima: uma
// transferencia tira o bem da carga da Divisao (ou o traz para ela), e uma
// descarga o retira do patrimonio. E ato de quem responde pela area.

router.get(
  '/transferencia',
  verifyPerfil('consulta', 'equipamento'),
  schemaValidation({ query: equipamentoSchema.historicoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.transferencia.listar(req.query)
    return res.sendJsonAndLog(
      true, 'Transferências retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/transferencia',
  verifyPerfil('gerente', 'equipamento'),
  schemaValidation({ body: equipamentoSchema.transferenciaCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.transferencia.criar(
      req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Transferência criada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/transferencia/:id',
  verifyPerfil('gerente', 'equipamento'),
  schemaValidation({
    params: equipamentoSchema.idParams,
    body: equipamentoSchema.transferenciaAtualizar
  }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.transferencia.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Transferência atualizada com sucesso', httpCode.OK)
  })
)

router.delete(
  '/transferencia/:id',
  verifyPerfil('gerente', 'equipamento'),
  schemaValidation({ params: equipamentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.transferencia.deletar(
      req.params.id, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Transferência excluída com sucesso', httpCode.OK)
  })
)

// --- O bem -------------------------------------------------------------------

router.get(
  '/',
  verifyPerfil('consulta', 'equipamento'),
  schemaValidation({ query: equipamentoSchema.listarQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.listar(req.query)
    return res.sendJsonAndLog(
      true, 'Equipamentos retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/',
  verifyPerfil('gerente', 'equipamento'),
  schemaValidation({ body: equipamentoSchema.equipamentoCriar }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.criar(req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(
      true, 'Equipamento criado com sucesso', httpCode.Created, dados
    )
  })
)

router.get(
  '/:id',
  verifyPerfil('consulta', 'equipamento'),
  schemaValidation({ params: equipamentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await equipamentoCtrl.getPorId(req.params.id)
    return res.sendJsonAndLog(
      true, 'Equipamento retornado com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/:id',
  verifyPerfil('gerente', 'equipamento'),
  schemaValidation({
    params: equipamentoSchema.idParams,
    body: equipamentoSchema.equipamentoAtualizar
  }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.atualizar(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Equipamento atualizado com sucesso', httpCode.OK)
  })
)

router.delete(
  '/:id',
  verifyPerfil('gerente', 'equipamento'),
  schemaValidation({ params: equipamentoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await equipamentoCtrl.deletar(req.params.id, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Equipamento excluído com sucesso', httpCode.OK)
  })
)

module.exports = router
