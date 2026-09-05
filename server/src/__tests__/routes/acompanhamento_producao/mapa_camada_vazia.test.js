'use strict'

// A CAMADA DE ACOMPANHAMENTO VAZIA DEVOLVE `features: []`, E NUNCA `null`.
//
// POR QUE ISTO PRECISA DO PostgreSQL, e por que o caso de unidade ao lado
// (`unit/acompanhamento_producao_ctrl.test.js`) não bastava: aquele mede o TEXTO
// da consulta e prova que a palavra `COALESCE` está escrita. O que ele não pode
// provar é que ela resolve o caso -- que `array_agg` sobre zero linhas devolve
// NULL, que `array_to_json(NULL)` também devolve NULL, e que é por isso que a
// resposta saía `{"type":"FeatureCollection","features":null}`. Isso é
// comportamento do banco, e só o banco responde.
//
// A VIEW VAZIA NÃO É ACIDENTE, É O PRIMEIRO ESTADO DE TODO LOTE. Os gatilhos de
// `er/acompanhamento_producao.sql` criam `acompanhamento.lote_<L>_subfase_<S>` e
// `acompanhamento.lote_<L>_linha_<P>` no INSERT da primeira `producao.etapa`, e
// nesse instante o lote ainda não tem uma única `producao.unidade_trabalho`. A
// semeadura abaixo é exatamente esse instante, e por isso ela PARA na etapa: uma
// unidade de trabalho a mais tornaria o caso incapaz de falhar.
//
// O `features: null` quebrava a tela de mapas do client, que lê `features.length`
// para decidir se dá zoom no que veio. A coleção vazia é a resposta honesta: mapa
// em branco para um lote sem geometria.
//
// O CONTROLE NEGATIVO É O 404. Sem ele, um `[]` devolvido por engano para uma
// camada INEXISTENTE passaria por acerto: as duas respostas leem igual na tela e
// querem dizer coisas opostas -- "o lote ainda não tem geometria" e "esta camada
// nunca existiu".

const request = require('supertest')

const { getApp } = require('../../helpers/app')
const { conn, cleanTestData } = require('../../helpers/db')
const { generateUserToken, USER_UUID, ADMIN_UUID } = require('../../helpers/auth')
const {
  STATUS_EXECUCAO, SUBTIPO_PRODUTO, TIPO_FASE, TIPO_ETAPA
} = require('../../../utils/domain_constants')

// `dominio.modulo.code`, o mesmo mapa de `login/verify_perfil.js`: 7 é a produção
// CARTOGRÁFICA, e não o 4, que é o PIT. `dominio.tipo_perfil`: 3 é o gerente.
const MODULO_PRODUCAO = 7
const PERFIL_GERENTE = 3

let app

beforeAll(async () => {
  app = await getApp()
})

// A CONCESSÃO SE DESFAZ NOS DOIS LADOS, e é a mesma disciplina de
// `routes/equipamento_perfil.test.js`: `cleanTestData` só apaga
// `dgeo.usuario_perfil` de quem está FORA da semente, e o usuário de teste está
// DENTRO. A linha de `producao` sobreviveria e vazaria para todo arquivo que
// rodasse depois neste worker. O `beforeEach` defende este arquivo de quem veio
// antes; o `afterEach`, quem vem depois.
const semPerfilNaProducao = () =>
  conn.none(
    `DELETE FROM dgeo.usuario_perfil
      WHERE modulo_id = $2 AND usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
    [USER_UUID, MODULO_PRODUCAO]
  )

const gerenteNaProducao = () =>
  conn.none(
    `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
     SELECT id, $2, $3 FROM dgeo.usuario WHERE uuid = $1
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
    [USER_UUID, MODULO_PRODUCAO, PERFIL_GERENTE]
  )

/**
 * O lote que acabou de ganhar a primeira etapa, e nada além disso.
 *
 * SÃO SEIS LINHAS, e nenhuma sobra. O projeto e o lote são do ACERVO (o core de
 * produção não tem tabela de lote, por decisão de 2026-08-09, e
 * `producao.etapa.lote_id` aponta `acervo.lote`); a linha de produção, a fase e a
 * subfase são o desenho do fluxo; a etapa é o que amarra a subfase ao lote -- e é
 * o INSERT dela que dispara os dois gatilhos que criam as views.
 *
 * NENHUMA `producao.unidade_trabalho`. É o ponto do teste.
 */
let cenario = 0
const semear = async () => {
  cenario += 1

  const projeto = await conn.one(
    `INSERT INTO acervo.projeto
       (nome, data_inicio, status_execucao_id, usuario_cadastramento_uuid)
     VALUES ($1, '2026-01-05', $2, $3) RETURNING id`,
    [`Projeto do mapa ${cenario}`, STATUS_EXECUCAO.EM_EXECUCAO, ADMIN_UUID]
  )
  const lote = await conn.one(
    `INSERT INTO acervo.lote
       (projeto_id, pit, nome, data_inicio, status_execucao_id, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, '2026-01-05', $4, $5) RETURNING id`,
    [
      projeto.id, `2026-MAPA-${cenario}`, `Lote do mapa ${cenario}`,
      STATUS_EXECUCAO.EM_EXECUCAO, ADMIN_UUID
    ]
  )
  const linha = await conn.one(
    `INSERT INTO producao.linha_producao
       (nome, nome_abrev, subtipo_produto_id, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      `Carta do mapa ${cenario}`, `mapa_${cenario}`,
      SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_T34_700, ADMIN_UUID
    ]
  )
  const fase = await conn.one(
    `INSERT INTO producao.fase
       (tipo_fase_id, linha_producao_id, ordem, usuario_cadastramento_uuid)
     VALUES ($1, $2, 1, $3) RETURNING id`,
    [TIPO_FASE.EXTRACAO, linha.id, ADMIN_UUID]
  )
  const subfase = await conn.one(
    `INSERT INTO producao.subfase (nome, fase_id, ordem, usuario_cadastramento_uuid)
     VALUES ($1, $2, 1, $3) RETURNING id`,
    [`Extração do mapa ${cenario}`, fase.id, ADMIN_UUID]
  )
  // `etapa_execucao_e_primeira`: o tipo Execução só existe na ordem 1.
  const etapa = await conn.one(
    `INSERT INTO producao.etapa
       (tipo_etapa_id, subfase_id, lote_id, ordem, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, 1, $4) RETURNING id`,
    [TIPO_ETAPA.EXECUCAO, subfase.id, lote.id, ADMIN_UUID]
  )

  return {
    loteId: lote.id,
    linhaId: linha.id,
    faseId: fase.id,
    subfaseId: subfase.id,
    etapaId: etapa.id,
    camadaSubfase: `lote_${lote.id}_subfase_${subfase.id}`,
    camadaLinha: `lote_${lote.id}_linha_${linha.id}`
  }
}

// A ETAPA CAI PRIMEIRO, E POR DELETE. É o único jeito de as views materializadas
// irem embora: o gatilho que as cria é FOR EACH ROW, e TRUNCATE (que é o que
// `cleanTestData` faz em `acervo.lote`, alcançando `producao.etapa` por CASCADE)
// não dispara gatilho de linha. Sem este DELETE, `acompanhamento.lote_1_subfase_1`
// ficaria no banco do worker apontando para uma tabela vazia, e o arquivo
// seguinte herdaria a sujeira.
//
// As três do fluxo (subfase, fase, linha de produção) também saem à mão: nenhuma
// delas referencia `acervo.lote`, então CASCADE nenhum as alcança.
const limparProducao = async () => {
  await conn.none('DELETE FROM producao.etapa')
  await conn.none('DELETE FROM producao.subfase')
  await conn.none('DELETE FROM producao.fase')
  await conn.none('DELETE FROM producao.linha_producao')
}

beforeEach(semPerfilNaProducao)

afterEach(async () => {
  await limparProducao()
  await semPerfilNaProducao()
  await cleanTestData()
})

const pedir = camada =>
  request(app)
    .get(`/api/acompanhamento/mapa/${camada}`)
    .set('Authorization', `Bearer ${generateUserToken()}`)

describe('a camada de acompanhamento sem unidade de trabalho', () => {
  it('devolve uma coleção VAZIA, e não `features: null`', async () => {
    await gerenteNaProducao()
    const { camadaSubfase } = await semear()

    const res = await pedir(camadaSubfase)

    expect(res.status).toBe(200)
    expect(res.body.dados.geojson.type).toBe('FeatureCollection')
    expect(res.body.dados.geojson.features).toEqual([])
    // A ASSERÇÃO QUE PEGA O DEFEITO: `toEqual([])` sozinho já recusaria `null`,
    // mas dizê-lo por extenso é o que documenta o que se está guardando.
    expect(res.body.dados.geojson.features).not.toBeNull()
  })

  it('e a view do LOTE por linha de produção responde igual', async () => {
    await gerenteNaProducao()
    const { camadaLinha } = await semear()

    const res = await pedir(camadaLinha)

    expect(res.status).toBe(200)
    expect(res.body.dados.geojson.type).toBe('FeatureCollection')
    expect(res.body.dados.geojson.features).toEqual([])
  })

  // As duas views nascem no MESMO INSERT, e é o que faz o caso acima valer: se a
  // semeadura tivesse de criar view à mão, ela estaria provando a si mesma.
  it('as duas nascem do INSERT da primeira etapa, sem unidade de trabalho nenhuma', async () => {
    await gerenteNaProducao()
    const { camadaSubfase, camadaLinha, loteId } = await semear()

    const views = await conn.any(
      `SELECT matviewname FROM pg_matviews
        WHERE schemaname = 'acompanhamento' ORDER BY matviewname`
    )
    expect(views.map(v => v.matviewname).sort()).toEqual(
      [camadaLinha, camadaSubfase].sort()
    )

    const { n } = await conn.one(
      'SELECT count(*)::int AS n FROM producao.unidade_trabalho WHERE lote_id = $1',
      [loteId]
    )
    expect(n).toBe(0)
  })

  // O CONTROLE NEGATIVO. `[]` quer dizer "existe e está vazia"; a camada que
  // nunca nasceu é 404, e não uma coleção vazia.
  it('mas a camada que não existe continua sendo 404, e não uma coleção vazia', async () => {
    await gerenteNaProducao()
    const { loteId, subfaseId } = await semear()

    const res = await pedir(`lote_${loteId}_subfase_${subfaseId + 9000}`)

    expect(res.status).toBe(404)
    expect(res.body.message).toContain('ainda não existe')
  })
})
