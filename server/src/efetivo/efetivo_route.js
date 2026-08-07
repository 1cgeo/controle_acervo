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
// OPERADOR na passagem pela DGEO e no impedimento, que é o cadastro do
// aproveitamento (subseção 6.1 do RPCMTec). Quem preenche o aproveitamento
// precisava da MESMA flag que libera o orçamento e o cadastro de usuários, e foi
// isso que fez 5 das 7 contas que trabalham no sistema virarem administradoras
// (medido em 2026-08-06).
//
// GERENTE no mapa anual e no resumo mensal. As duas leituras AGREGAM a Divisão
// inteira num quadro só, e responder "quem esteve disponível em cada semana do
// ano" é pergunta de quem responde pelo efetivo, não de quem digita a licença de
// uma pessoa. É a mesma régua da grade do PIT, que também é agregada e também é
// de gerente.
//
// O administrador global continua passando nas dez, porque o `verifyPerfil` o
// aceita antes de olhar perfil nenhum.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, csvExport } = require('../utils')
const { verifyPerfil } = require('../login')

const efetivoCtrl = require('./efetivo_ctrl')
const efetivoSchema = require('./efetivo_schema')

const router = express.Router()

// ---------------------------------------------------------------------------
// Leitura agregada. As três saem da MESMA base por dia, agregada de três
// jeitos: o mapa por semana, o fechamento por ano e a 6.1 por mês.
// ---------------------------------------------------------------------------

router.get(
  '/mapa',
  verifyPerfil('gerente', 'efetivo'),
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
  verifyPerfil('gerente', 'efetivo'),
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

// Conta ativa sem passagem pela DGEO no mês. GERENTE, e não administrador
// global: a resposta é do EFETIVO, e trancá-la atrás da flag global foi o que
// obrigou o dashboard inteiro a ser de administrador (ver `divergenciasDoMes`).
router.get(
  '/divergencias',
  verifyPerfil('gerente', 'efetivo'),
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
// Passagem pela DGEO
// ---------------------------------------------------------------------------

router.get(
  '/periodos',
  verifyPerfil('operador', 'efetivo'),
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
  verifyPerfil('operador', 'efetivo'),
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
  verifyPerfil('operador', 'efetivo'),
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
  verifyPerfil('operador', 'efetivo'),
  schemaValidation({ params: efetivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await efetivoCtrl.deletarPeriodo(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Passagem excluída com sucesso', httpCode.OK)
  })
)

// ---------------------------------------------------------------------------
// Impedimento
// ---------------------------------------------------------------------------

router.get(
  '/impedimentos',
  verifyPerfil('operador', 'efetivo'),
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
  verifyPerfil('operador', 'efetivo'),
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
  verifyPerfil('operador', 'efetivo'),
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
  verifyPerfil('operador', 'efetivo'),
  schemaValidation({ params: efetivoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    await efetivoCtrl.deletarImpedimento(req.params.id, req.usuarioUuid, req.contexto)

    return res.sendJsonAndLog(true, 'Impedimento excluído com sucesso', httpCode.OK)
  })
)

module.exports = router
