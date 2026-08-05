'use strict'

/**
 * Contorno do lugar filtrado.
 *
 * A tela precisa de DUAS coisas para destacar o estado ou o município: a borda,
 * que ela pinta, e a caixa envolvente, que dá o zoom. A rota entrega as duas
 * juntas de propósito: calcular a caixa no navegador, percorrendo um
 * MULTIPOLYGON de milhares de vértices, seria refazer em JavaScript o que o
 * PostGIS já tem.
 *
 * O que estas provas guardam é o CONTRATO com a tela. Se a geometria voltar sem
 * SRID, com a caixa fora de ordem, ou com o município aceitando um id de estado,
 * o mapa desenha em silêncio no lugar errado, que é o pior modo de falhar.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

// Um estado em L e um município quadrado dentro dele. O L existe para provar a
// simplificação: um retângulo já é mínimo, e sobreviveria a qualquer tolerância
// sem dizer nada.
const ESTADO_L = 'SRID=4674;MULTIPOLYGON(((' + [
  '-50 -15', '-46 -15', '-46 -13', '-48 -13', '-48 -11', '-50 -11', '-50 -15'
].join(', ') + ')))'

const MUNICIPIO = 'SRID=4674;MULTIPOLYGON(((' + [
  '-50 -15', '-49 -15', '-49 -14', '-50 -14', '-50 -15'
].join(', ') + ')))'

beforeEach(async () => {
  await conn.none('DELETE FROM limites.municipio')
  await conn.none('DELETE FROM limites.estado')
  await conn.none(
    `INSERT INTO limites.estado (id, sigla, nome, regiao, geom)
     VALUES (11, 'AL', 'Alfa', 'Norte', ST_GeomFromEWKT($1))`,
    [ESTADO_L]
  )
  await conn.none(
    `INSERT INTO limites.municipio (id, nome, nome_busca, estado_id, geom)
     VALUES (1100001, 'Vila Alfa', 'vila alfa', 11, ST_GeomFromEWKT($1))`,
    [MUNICIPIO]
  )
})

afterEach(async () => {
  await conn.none('DELETE FROM limites.municipio')
  await conn.none('DELETE FROM limites.estado')
})

const token = () => generateAdminToken()

const pedir = (caminho) =>
  request(app).get(`/api/limites/${caminho}`).set('Authorization', `Bearer ${token()}`)

describe('GET /api/limites/:tipo/:id', () => {
  test('devolve a borda do estado e a caixa que a enquadra', async () => {
    const res = await pedir('estado/11')

    expect(res.status).toBe(200)
    const d = res.body.dados
    expect(d.tipo).toBe('estado')
    expect(d.id).toBe(11)
    expect(d.nome).toBe('Alfa')
    expect(d.sigla).toBe('AL')

    // A caixa vai como [oeste, sul, leste, norte], que é a ordem que o
    // `fitBounds` do MapLibre espera. Invertida, o zoom cai do outro lado do
    // mundo sem erro nenhum.
    expect(d.bbox).toEqual([-50, -15, -46, -11])

    // A simplificação REBAIXA um MULTIPOLYGON de uma parte só para POLYGON. A
    // tela aceita os dois, e amarrar a prova a um deles quebraria no dia em que
    // o estado de uma parte virasse o caso comum. O que importa é ser polígono.
    expect(['Polygon', 'MultiPolygon']).toContain(d.geometria.type)

    // O L tem 6 vértices distintos: a simplificação não pode comer nenhum deles,
    // senão o contorno na tela deixa de ser o do estado.
    const anel = d.geometria.type === 'Polygon'
      ? d.geometria.coordinates[0]
      : d.geometria.coordinates[0][0]
    expect(anel).toHaveLength(7)
  })

  test('devolve o município, e a sigla vem nula', async () => {
    const res = await pedir('municipio/1100001')

    expect(res.status).toBe(200)
    const d = res.body.dados
    expect(d.tipo).toBe('municipio')
    expect(d.nome).toBe('Vila Alfa')
    // Município não tem sigla. O campo existe para a tela não ter de saber de
    // qual dos dois tipos veio a resposta.
    expect(d.sigla).toBeNull()
    expect(d.bbox).toEqual([-50, -15, -49, -14])
  })

  test('a geometria devolvida é GeoJSON pronto para o mapa', async () => {
    const res = await pedir('municipio/1100001')

    const geo = res.body.dados.geometria
    // Sem `crs`: o padrão do `ST_AsGeoJSON` embute um, e o membro saiu da
    // especificação (RFC 7946), que é sempre lon/lat. A malha está em 4674, que
    // difere de WGS84 por menos de um metro, então o membro só engordaria a
    // resposta com algo que o leitor pode recusar.
    expect(geo.crs).toBeUndefined()
    expect(Array.isArray(geo.coordinates)).toBe(true)
    const primeiro = geo.type === 'Polygon'
      ? geo.coordinates[0][0]
      : geo.coordinates[0][0][0]

    // O VERTICE EXATO do municipio semeado, e nao uma faixa. Conferir se a
    // coordenada cabe no planeta aceita o poligono de OUTRO municipio, e aceita
    // lon e lat trocados dentro da faixa: e justamente o defeito que o
    // cabecalho deste arquivo teme, o mapa desenhando no lugar errado.
    expect(primeiro).toEqual([-50, -15])
  })

  test('id que não existe é 404, e não uma resposta vazia com 200', async () => {
    // 200 com geometria nula faria a tela apagar o destaque em silêncio, e
    // ninguém saberia que o filtro aponta para um código que sumiu da malha.
    const res = await pedir('estado/99')
    expect(res.status).toBe(404)
  })

  test('tipo desconhecido é recusado antes de chegar ao banco', async () => {
    // Sem a lista fechada de tipos, o nome do caminho entraria numa consulta:
    // é o tipo que escolhe a TABELA, e não um parâmetro ligado.
    const res = await pedir('regiao/1')
    expect(res.status).toBe(400)
  })

  test('id fora da forma do código do IBGE é 400', async () => {
    const res = await pedir('estado/abc')
    expect(res.status).toBe(400)
  })

  test('exige autenticação', async () => {
    const res = await request(app).get('/api/limites/estado/11')
    expect(res.status).toBe(401)
  })
})
