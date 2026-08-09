'use strict'

// Aproveitamento do efetivo: quem esteve na Divisão, quando, e o que o impediu.
//
// ROTA DE PLATAFORMA, sob `/api/efetivo`, e não de módulo: o efetivo não é dado
// de acervo, de mapoteca nem de orçamento. Ela alimenta a subseção 6.1 do
// RPCMTec, mas não mora sob `/api/rpcmtec` porque "quem esteve na Divisão" não
// existe por causa do relatório -- o relatório é um leitor.
//
// GUARDA: o módulo EFETIVO, desde a 1.33.0. Antes era `verifyAdmin` nas dez
// rotas, inclusive na leitura, e a razão está de pé: a resposta traz licença de
// saúde e função acumulada de cada militar, nominalmente. O que mudou é que
// agora existe um compartimento para esse dado, em vez de só a flag global.
//
// A RÉGUA DOS NÍVEIS mudou em 2026-08-08, e ela vale igual nos três módulos:
// quem tem CONSULTA no módulo LÊ as telas do módulo; quem tem OPERADOR lança o
// que é dele; quem tem GERENTE responde pela área toda. Aqui isso deslocou as
// rotas nos DOIS sentidos, e é deliberado:
//
//   LEITURA DESCE PARA CONSULTA. O mapa anual, o resumo mensal, as divergências,
//   a lista de passagens e a de impedimentos eram de gerente ou de operador. O
//   efeito era que ninguém conseguia OLHAR o aproveitamento da Divisão sem poder
//   também escrevê-lo, e a tela do efetivo continuava fechada para quem só
//   precisa conferir o próprio quadro.
//
//   ESCRITA SOBE PARA GERENTE. Lançar a passagem pela DGEO e o impedimento DOS
//   OUTROS passou a ser ato de quem responde pelo efetivo: é dado de pessoal
//   alheio, nominal, e quem o digita decide o número que a 6.1 publica sobre
//   terceiros. O OPERADOR de efetivo passa a cuidar só do PRÓPRIO
//   aproveitamento, pelas rotas `/meu_periodo` e `/meu_impedimento` daqui de
//   baixo, que a tela `#/perfil` consome.
//
// GERENTE, e não administrador global, continua sendo o teto: trancar o
// aproveitamento atrás da flag global foi o que fez 5 das 7 contas que trabalham
// no sistema virarem administradoras (medido em 2026-08-06).
//
// O QUE SAIU DO CAMINHO, na mesma data: `verifyPerfil` recusava com 401
// ("Usuário só pode acessar sua própria informação") quem não fosse administrador
// global e mandasse um `usuario_uuid` de OUTRA pessoa no corpo. Como
// `criarPeriodo` e `criarImpedimento` levam o `usuario_uuid` do militar no corpo,
// a trava fazia justamente o gerente de Efetivo não conseguir lançar pelos
// outros, que é o trabalho que a régua nova põe nele. A leitura inteira do caso
// está em `login/verify_perfil.js`, onde a trava era.
//
// O administrador global continua passando em todas, porque o `verifyPerfil` o
// aceita antes de olhar perfil nenhum.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, csvExport } = require('../utils')
// `verifyAcesso` guarda as rotas do PRÓPRIO aproveitamento, e não `verifyPerfil`:
// declarar o próprio impedimento não é trabalho do módulo Efetivo, é obrigação de
// quem está na Divisão. Ver o bloco no fim deste arquivo.
const { verifyPerfil, verifyAcesso } = require('../login')

const efetivoCtrl = require('./efetivo_ctrl')
const efetivoSchema = require('./efetivo_schema')

const router = express.Router()

// ---------------------------------------------------------------------------
// Leitura agregada. As três saem da MESMA base por dia, agregada de três
// jeitos: o mapa por semana, o fechamento por ano e a 6.1 por mês.
// ---------------------------------------------------------------------------

router.get(
  '/mapa',
  verifyPerfil('consulta', 'efetivo'),
  schemaValidation({ query: efetivoSchema.anoObrigatorioQuery }),
  asyncHandler(async (req, res, next) => {
    const [semanas, anual] = await Promise.all([
      efetivoCtrl.mapaAnual(req.query.ano),
      efetivoCtrl.resumoAnual(req.query.ano)
    ])

    return res.sendJsonAndLog(
      true, 'Mapa do efetivo retornado com sucesso', httpCode.OK,
      { ano: Number(req.query.ano), semanas, anual }
    )
  })
)

// As colunas do CSV, na ordem em que o chefe as lê ao fechar o mês. O nome por
// extenso entra porque a 6.1 o escreve, e é isso que faz o arquivo servir de
// rascunho do documento em vez de só de espelho da tela.
//
// `impedimentos` é uma LISTA de objetos na resposta JSON, e o `toCsv` escreveria
// '[object Object]'. A frase é montada aqui, no mesmo formato do gerador da 6.1.
const COLUNAS_EFETIVO_MES = [
  { key: 'posto_abrev', label: 'Posto' },
  { key: 'nome_guerra', label: 'Nome de guerra' },
  { key: 'nome', label: 'Nome completo' },
  { key: 'dias_na_dgeo', label: 'Dias na DGEO' },
  { key: 'dias_do_mes', label: 'Dias do mês' },
  { key: 'aproveitamento', label: 'Aproveitamento no mês (%)' },
  { key: 'dias_decorridos', label: 'Dias decorridos' },
  { key: 'aproveitamento_decorrido', label: 'Aproveitamento até hoje (%)' },
  { key: 'dias_perdidos', label: 'Dias-militar perdidos' },
  { key: 'impedimentos', label: 'Impedimentos' }
]

const paraLinhaCsv = e => ({
  ...e,
  impedimentos: (e.impedimentos || [])
    .map(i => `${i.descricao} (${i.percentual}%)`)
    .join(', ')
})

router.get(
  '/mes',
  verifyPerfil('consulta', 'efetivo'),
  schemaValidation({ query: efetivoSchema.anoMesRelatorioQuery }),
  asyncHandler(async (req, res, next) => {
    const { ano, mes, formato } = req.query
    const dados = await efetivoCtrl.resumoMensal(ano, mes)

    return csvExport.sendReport(
      res, formato, 'Efetivo do mês retornado com sucesso',
      formato === 'csv' ? dados.map(paraLinhaCsv) : dados,
      {
        filename: `efetivo_${ano}_${String(mes).padStart(2, '0')}.csv`,
        columns: COLUNAS_EFETIVO_MES
      }
    )
  })
)

// Conta ativa sem passagem pela DGEO no mês. NO EFETIVO, e não em `/usuarios`:
// a resposta é do EFETIVO, e trancá-la atrás da flag global foi o que obrigou o
// dashboard inteiro a ser de administrador (ver `divergenciasDoMes`).
router.get(
  '/divergencias',
  verifyPerfil('consulta', 'efetivo'),
  schemaValidation({ query: efetivoSchema.anoMesQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.divergenciasDoMes(req.query.ano, req.query.mes)

    return res.sendJsonAndLog(
      true, 'Divergências entre cadastro e efetivo retornadas com sucesso',
      httpCode.OK, dados
    )
  })
)

// ---------------------------------------------------------------------------
// O cadastro mínimo de militar, para esta tela
//
// POR QUE ELA NÃO É `GET /api/usuarios`. A tela do aproveitamento precisa da
// lista de gente para montar o seletor de militar e para nomear a divergência, e
// pedia isso a `/api/usuarios`, que é `verifyAdmin`. As chamadas saem no mesmo
// `Promise.all` das rotas daqui, então o gerente do efetivo tomava 403 numa
// delas e a tela inteira quebrava avisando que é preciso ser administrador.
//
// O RECORTE DE CAMPO É O QUE PERMITE A GUARDA MAIS BAIXA. Daqui sai só o que a
// tela desenha; `login`, `administrador`, `senha_definida` e os perfis por
// módulo continuam exclusivamente em `/api/usuarios`, porque são cadastro de
// PLATAFORMA e dizem quem manda no sistema. Ver `listarMilitares`.
// ---------------------------------------------------------------------------

router.get(
  '/militares',
  verifyPerfil('consulta', 'efetivo'),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.listarMilitares()

    return res.sendJsonAndLog(
      true, 'Militares retornados com sucesso', httpCode.OK, dados
    )
  })
)

// ---------------------------------------------------------------------------
// Passagem pela DGEO
//
// LER é de CONSULTA e ESCREVER é de GERENTE, e a distância entre os dois níveis
// é o ponto. Cadastrar a passagem de OUTRA pessoa é dizer desde quando ela conta
// para o efetivo da Divisão, e esse número vai assinado na 6.1 do RPCMTec: é ato
// de quem responde pelo efetivo. O operador do módulo lança o PRÓPRIO
// aproveitamento, por `/meu_periodo`, e não o dos outros.
// ---------------------------------------------------------------------------

router.get(
  '/periodos',
  verifyPerfil('consulta', 'efetivo'),
  schemaValidation({ query: efetivoSchema.anoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.listarPeriodos(req.query.ano)

    return res.sendJsonAndLog(
      true, 'Passagens pela DGEO retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/periodos',
  verifyPerfil('gerente', 'efetivo'),
  schemaValidation({ body: efetivoSchema.criarPeriodo }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.criarPeriodo(
      req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Passagem cadastrada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/periodos/:id',
  verifyPerfil('gerente', 'efetivo'),
  schemaValidation({
    params: efetivoSchema.idParams,
    body: efetivoSchema.atualizarPeriodo
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.atualizarPeriodo(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Passagem atualizada com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/periodos/:id',
  verifyPerfil('gerente', 'efetivo'),
  schemaValidation({ params: efetivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await efetivoCtrl.deletarPeriodo(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Passagem excluída com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// Impedimento
//
// MESMA régua da passagem, e por motivo mais forte: `impedimento.descricao` é
// texto livre e costuma nomear licença de saúde. Escrever o impedimento de
// terceiro é do gerente; ler a lista já agregada da Divisão é de consulta,
// porque é o mesmo dado que o mapa e a 6.1 já mostram a esse nível.
// ---------------------------------------------------------------------------

router.get(
  '/impedimentos',
  verifyPerfil('consulta', 'efetivo'),
  schemaValidation({ query: efetivoSchema.anoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.listarImpedimentos(req.query.ano)

    return res.sendJsonAndLog(
      true, 'Impedimentos retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/impedimentos',
  verifyPerfil('gerente', 'efetivo'),
  schemaValidation({ body: efetivoSchema.criarImpedimento }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.criarImpedimento(
      req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Impedimento cadastrado com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/impedimentos/:id',
  verifyPerfil('gerente', 'efetivo'),
  schemaValidation({
    params: efetivoSchema.idParams,
    body: efetivoSchema.atualizarImpedimento
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.atualizarImpedimento(
      req.params.id, req.body, req.usuarioUuid, req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Impedimento atualizado com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/impedimentos/:id',
  verifyPerfil('gerente', 'efetivo'),
  schemaValidation({ params: efetivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await efetivoCtrl.deletarImpedimento(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Impedimento excluído com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// O PRÓPRIO aproveitamento
//
// POR QUE ESTAS NOVE ROTAS EXISTEM. Em 2026-08-08 a escrita das oito de cima
// subiu para GERENTE e a tela `#/aproveitamento` deixou de abrir para o operador.
// Sem estas, o efeito colateral seria que ninguém abaixo do gerente teria como
// declarar o PRÓPRIO impedimento -- e o aproveitamento da subseção 6.1 do RPCMTec
// depende de cada um declarar o seu. A régua nova tirou o alheio de quem não
// responde por ele, e devolveu o próprio a todo mundo.
//
// A GUARDA É `verifyAcesso`, e não `verifyPerfil('...', 'efetivo')'. Declarar a
// própria passagem e o próprio impedimento não é trabalho DO MÓDULO Efetivo: é
// obrigação de quem está na Divisão, e quem trabalha só no acervo ou só no
// orçamento tem de conseguir cumpri-la sem ganhar linha em `dgeo.usuario_perfil`
// de um módulo em que não mexe. Exigir perfil aqui reabriria, num degrau mais
// baixo, a mesma armadilha que fez 5 das 7 contas virarem administradoras.
//
// `verifyAcesso` E NÃO `verifyLogin`: quem ainda não tem perfil em módulo nenhum
// não é ninguém no sistema, e também não conta para o efetivo da Divisão. Ele
// alcança a própria página, o próprio cadastro e a própria senha, e nada mais.
//
// A PROPRIEDADE DE SEGURANÇA, e ela é o motivo de o bloco ser separado em vez de
// um parâmetro a mais nas rotas de cima:
//
//   O DONO NUNCA VEM DO PEDIDO. `usuario_uuid` sai sempre de `req.usuarioUuid`,
//   que o token já validado escreveu, e o corpo não o declara (o Joi o descarta).
//
//   O `:id` DO PUT E DO DELETE NÃO AUTORIZA NADA SOZINHO. `PUT
//   /efetivo/periodos/:id` autoriza pelo `:id` e só, e pode: para chegar lá é
//   preciso ser gerente do Efetivo, cujo trabalho é mexer no registro alheio.
//   Aqui a guarda só diz "esta pessoa tem perfil em algum módulo", então o
//   controlador confere que a linha é DELA antes de tocá-la, e responde 404 --
//   não 403 -- quando não for, para a resposta não confirmar a existência do
//   registro de terceiro. Quem faz isso é `exigirDono`, dentro da mesma
//   transação da escrita.
//
// SEM RECORTE DE ANO nas duas LISTAS, ao contrário das da Divisão: uma pessoa
// tem poucas linhas, e recortá-las faria a passagem antiga sumir da própria ficha
// sem nada na tela explicando o sumiço. A grade (`/meu_aproveitamento`) é a
// exceção, e por definição: ela É o ano.
// ---------------------------------------------------------------------------

// A GRADE DO PRÓPRIO ANO: as 53 semanas e o fechamento anual de UMA pessoa.
//
// POR QUE ELA NÃO É `GET /efetivo/mapa`. Aquela é `verifyPerfil('consulta',
// 'efetivo')` e devolve a Divisão inteira, nominalmente. Quem trabalha só no
// acervo não tem perfil em Efetivo e mesmo assim precisa ver o próprio ano, que
// é a mesma razão pela qual `/meu_periodo` e `/meu_impedimento` ficaram em
// `verifyAcesso`: a obrigação é de quem está na Divisão, não do módulo.
//
// AS DUAS CONSULTAS SÃO AS MESMAS do mapa da Divisão, recortadas por pessoa
// (ver `SO_ESTA_PESSOA` no controlador). Um par de consultas próprio calcularia
// aproveitamento de novo, e a primeira correção aplicada a um lado só faria a
// pessoa ler um número na própria página e outro no mapa da Divisão.
//
// O UUID SAI DO TOKEN. Ele não é parâmetro desta rota, e mandá-lo na query cai no
// Joi como chave desconhecida: o `anoObrigatorioQuery` só conhece `ano`, e a
// validação de query RECUSA com 400 em vez de descartar.
//
// COM RECORTE DE ANO, ao contrário das duas listas do próprio logo abaixo: a
// grade É o ano, e sem o parâmetro não haveria as 53 colunas.
router.get(
  '/meu_aproveitamento',
  verifyAcesso,
  schemaValidation({ query: efetivoSchema.anoObrigatorioQuery }),
  asyncHandler(async (req, res, next) => {
    const [semanas, anual] = await Promise.all([
      efetivoCtrl.mapaAnual(req.query.ano, req.usuarioUuid),
      efetivoCtrl.resumoAnual(req.query.ano, req.usuarioUuid)
    ])

    return res.sendJsonAndLog(
      true, 'Meu aproveitamento retornado com sucesso', httpCode.OK,
      { ano: Number(req.query.ano), semanas, anual }
    )
  })
)

router.get(
  '/meu_periodo',
  verifyAcesso,
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.listarPeriodos(null, req.usuarioUuid)

    return res.sendJsonAndLog(
      true, 'Minhas passagens pela DGEO retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/meu_periodo',
  verifyAcesso,
  schemaValidation({ body: efetivoSchema.meuPeriodo }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.criarPeriodo(
      // O uuid vai DEPOIS do espalhamento do corpo. Assim, mesmo que um dia o
      // schema volte a aceitar a chave, o que grava continua sendo o do token.
      { ...req.body, usuario_uuid: req.usuarioUuid },
      req.usuarioUuid,
      req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Passagem cadastrada com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/meu_periodo/:id',
  verifyAcesso,
  schemaValidation({
    params: efetivoSchema.idParams,
    body: efetivoSchema.meuPeriodo
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.atualizarPeriodo(
      req.params.id, req.body, req.usuarioUuid, req.contexto,
      // O quinto argumento é o dono EXIGIDO. Sem ele, esta rota autorizaria pelo
      // `:id` sozinho, que é o que a de cima faz e que aqui seria um buraco.
      req.usuarioUuid
    )

    return res.sendJsonAndLog(
      true, 'Passagem atualizada com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/meu_periodo/:id',
  verifyAcesso,
  schemaValidation({ params: efetivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await efetivoCtrl.deletarPeriodo(
      req.params.id, req.usuarioUuid, req.contexto, req.usuarioUuid
    )

    return res.sendJsonAndLog(true, 'Passagem excluída com sucesso', httpCode.OK)
  })
)

router.get(
  '/meu_impedimento',
  verifyAcesso,
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.listarImpedimentos(null, req.usuarioUuid)

    return res.sendJsonAndLog(
      true, 'Meus impedimentos retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/meu_impedimento',
  verifyAcesso,
  schemaValidation({ body: efetivoSchema.meuImpedimento }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.criarImpedimento(
      { ...req.body, usuario_uuid: req.usuarioUuid },
      req.usuarioUuid,
      req.contexto
    )

    return res.sendJsonAndLog(
      true, 'Impedimento cadastrado com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/meu_impedimento/:id',
  verifyAcesso,
  schemaValidation({
    params: efetivoSchema.idParams,
    body: efetivoSchema.meuImpedimento
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await efetivoCtrl.atualizarImpedimento(
      req.params.id, req.body, req.usuarioUuid, req.contexto, req.usuarioUuid
    )

    return res.sendJsonAndLog(
      true, 'Impedimento atualizado com sucesso', httpCode.OK, dados
    )
  })
)

router.delete(
  '/meu_impedimento/:id',
  verifyAcesso,
  schemaValidation({ params: efetivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await efetivoCtrl.deletarImpedimento(
      req.params.id, req.usuarioUuid, req.contexto, req.usuarioUuid
    )

    return res.sendJsonAndLog(true, 'Impedimento excluído com sucesso', httpCode.OK)
  })
)

module.exports = router
