'use strict'

// O TRAJETO SEM HORA TAMBÉM SE DESENHA, contra o banco e a rota de verdade.
//
// O DEFEITO QUE ISTO GUARDA. A view `campo.track_linha` filtrava
// `WHERE p.momento IS NOT NULL` e costurava `ORDER BY p.momento`. Um trajeto
// importado de GeoJSON entra com `momento` NULO em todo ponto -- GeoJSON de
// linha não carrega hora, e o conversor do client monta `momento: null` para
// cada coordenada --, então aquele filtro descartava o track inteiro: o servidor
// respondia "Trajeto importado com sucesso" e `GET /api/campo/:id/track`
// devolvia `geometria: null` para os 6.500 pontos que acabavam de entrar. O
// trajeto nunca aparecia no mapa. Quem exporta GPX do GPS da viatura (que tem
// `time`) nunca viu o defeito; quem passou pelo QGIS antes, sempre.
//
// A CORREÇÃO É DE DDL, e está em
// `migrations/2026-09-05_o_trajeto_sem_hora_tambem_se_desenha.sql` (3.14.0), com
// o mesmo corpo de view em `er/campo.sql`. A ordem passou a ser
// `momento NULLS LAST, id`: quem tem hora ordena pela hora, e quem não tem cai
// para o fim na ordem de INSERÇÃO, que é a ordem do arquivo.
//
// POR QUE É TESTE DE BANCO, e não de dublê. O que se prova aqui é o que o
// POSTGRES faz com a view: um mock devolveria a geometria que o teste
// escrevesse, e o defeito -- que era da view, não do controlador -- passaria
// por baixo. O `globalSetup` monta o template a partir de `er/*.sql`, então a
// view nova entra no banco de teste sem migração nenhuma.
//
// AS DUAS COLUNAS QUE O CLIENT LÊ ESTÃO AQUI DE PROPÓSITO. `pontos` conta
// `campo.track_ponto` no controlador e já dizia a verdade; `geometria` vem da
// view e era o que faltava. Provar só a contagem deixaria a tela dizendo
// "3 pontos" ao lado de "sem linha para desenhar", que é exatamente o estado
// anterior a esta correção.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const {
  generateUserToken, USER_UUID, ADMIN_UUID
} = require('../helpers/auth')
const { SITUACAO_CAMPO, CATEGORIA_CAMPO } = require('../../utils/domain_constants')

const MODULO_PIT = 4
const OPERADOR = 2

const AREA = 'POLYGON((-53 -29,-52 -29,-52 -28,-53 -28,-53 -29))'
const ANO = 2026

let app

beforeAll(async () => {
  app = await getApp()
})

// A CONCESSÃO SE DESFAZ NOS DOIS LADOS. `cleanTestData` só apaga
// `dgeo.usuario_perfil` de quem está FORA da semente, e o usuário de teste está
// DENTRO: a linha de `pit` ficaria e vazaria para todo arquivo que rodasse
// depois neste worker.
const semPerfilNoPit = () =>
  conn.none(
    `DELETE FROM dgeo.usuario_perfil
      WHERE modulo_id = $2 AND usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
    [USER_UUID, MODULO_PIT]
  )

beforeEach(async () => {
  await semPerfilNoPit()
  await conn.none(
    `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
     SELECT id, $2, $3 FROM dgeo.usuario WHERE uuid = $1
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
    [USER_UUID, MODULO_PIT, OPERADOR]
  )
})

afterEach(async () => {
  await semPerfilNoPit()
  await conn.none('DELETE FROM campo.campo')
  await cleanTestData()
})

// O ANO PRECISA DE EXERCÍCIO NO PIT: `campo.ano` referencia `pit.pit`, e sem a
// linha do ano a chave estrangeira recusaria o INSERT com um erro que se leria
// como falha do teste.
let cenario = 0
const semearCampo = async () => {
  cenario += 1

  await conn.none(
    `INSERT INTO pit.pit (ano, situacao_id, usuario_cadastramento_uuid)
     VALUES ($1, 2, $2) ON CONFLICT (ano) DO NOTHING`,
    [ANO, ADMIN_UUID]
  )

  const campo = await conn.one(
    `INSERT INTO campo.campo
       (nome, ano, situacao_id, data_inicio, data_fim, geom, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, '2026-07-28', '2026-08-03',
             ST_Multi(ST_GeomFromText($4, 4674)), $5)
     RETURNING id`,
    [`Reambulação sem hora ${cenario}`, ANO, SITUACAO_CAMPO.FINALIZADO, AREA, ADMIN_UUID]
  )
  await conn.none(
    'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
    [campo.id, CATEGORIA_CAMPO.REAMBULACAO]
  )

  return campo.id
}

const ponto = (longitude, momento = null) => ({
  longitude,
  latitude: -29.1,
  elevacao: null,
  momento
})

const importar = (campoId, pontos, placa) =>
  request(app)
    .post(`/api/campo/${campoId}/track`)
    .set('Authorization', generateUserToken())
    .send({
      chefe_vtr: '2º Sgt Ramos',
      motorista: 'Cb Bueno',
      placa_vtr: placa,
      dia: '2026-07-28',
      pontos
    })

const listar = (campoId) =>
  request(app)
    .get(`/api/campo/${campoId}/track`)
    .set('Authorization', generateUserToken())

describe('GET /api/campo/:id/track: o trajeto importado sem hora tem linha', () => {
  // ESTE É O CASO DO GeoJSON, e o que reprovava antes da 3.14.0: os três pontos
  // entravam, `pontos` dizia 3 e `geometria` vinha NULA.
  it('três pontos sem momento devolvem pontos = 3 e a linha de três vértices', async () => {
    const campoId = await semearCampo()

    const importado = await importar(
      campoId,
      [ponto(-53.1), ponto(-53.2), ponto(-53.3)],
      'EB-1234'
    )
    expect(importado.status).toBe(201)

    const res = await listar(campoId)

    expect(res.status).toBe(200)
    expect(res.body.dados).toHaveLength(1)

    const trajeto = res.body.dados[0]
    expect(trajeto.pontos).toBe(3)

    // `geometria` É O CAMPO QUE O CLIENT DESENHA (`campo-trajetos.js` só põe o
    // botão do mapa quando ela existe), e o controlador já a entrega parseada.
    expect(trajeto.geometria).not.toBeNull()
    expect(trajeto.geometria.type).toBe('LineString')
    expect(trajeto.geometria.coordinates).toHaveLength(3)

    // A ORDEM É A DO ARQUIVO, que sem `momento` é a de inserção (`id`).
    const longitudes = trajeto.geometria.coordinates.map(c => c[0])
    expect(longitudes[0]).toBeCloseTo(-53.1, 5)
    expect(longitudes[1]).toBeCloseTo(-53.2, 5)
    expect(longitudes[2]).toBeCloseTo(-53.3, 5)

    // SEM HORA NÃO SE INVENTA HORA: o M da linha vira `NaN` e some no
    // `ST_Force2D`, e as pontas do intervalo continuam nulas.
    expect(trajeto.momento_inicio).toBeNull()
    expect(trajeto.momento_fim).toBeNull()
  })

  // O CONTROLE: com hora, quem manda continua sendo a hora, e não a ordem de
  // inserção. Sem este caso, trocar a ordenação por `id` puro passaria.
  it('com momento, a linha continua ordenada pela hora e não pela inserção', async () => {
    const campoId = await semearCampo()

    const importado = await importar(
      campoId,
      [
        ponto(-53.3, '2026-07-28T15:00:00Z'),
        ponto(-53.1, '2026-07-28T13:00:00Z'),
        ponto(-53.2, '2026-07-28T14:00:00Z')
      ],
      'EB-9999'
    )
    expect(importado.status).toBe(201)

    const res = await listar(campoId)
    const trajeto = res.body.dados[0]

    expect(trajeto.pontos).toBe(3)
    const longitudes = trajeto.geometria.coordinates.map(c => c[0])
    expect(longitudes[0]).toBeCloseTo(-53.1, 5)
    expect(longitudes[2]).toBeCloseTo(-53.3, 5)
    expect(new Date(trajeto.momento_inicio).toISOString())
      .toBe('2026-07-28T13:00:00.000Z')
  })

  // O TRACK MISTO, que antes vinha com um vértice só (o ponto sem hora era
  // descartado, e o HAVING derrubava o que sobrava): o trecho cronometrado vem
  // primeiro e o resto atrás, que é o melhor que se pode afirmar sem inventar
  // hora.
  it('o track misto desenha o trecho com hora primeiro e o resto atrás', async () => {
    const campoId = await semearCampo()

    await importar(
      campoId,
      [ponto(-53.9), ponto(-53.1, '2026-07-28T13:00:00Z')],
      'EB-4321'
    )

    const res = await listar(campoId)
    const trajeto = res.body.dados[0]

    expect(trajeto.pontos).toBe(2)
    expect(trajeto.geometria.coordinates).toHaveLength(2)
    const longitudes = trajeto.geometria.coordinates.map(c => c[0])
    expect(longitudes[0]).toBeCloseTo(-53.1, 5)
    expect(longitudes[1]).toBeCloseTo(-53.9, 5)
  })
})
