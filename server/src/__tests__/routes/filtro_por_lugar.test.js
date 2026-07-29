'use strict'

/**
 * Filtro por MUNICÍPIO e por ESTADO, nas duas telas (chefe, 2026-07-29).
 *
 * O recorte é espacial contra o schema `limites`, e não um campo do produto nem
 * do ponto: nenhum dos dois guarda município, e guardar seria duas versões da
 * mesma verdade, que divergem no dia em que a malha do IBGE mudar.
 *
 * Estas provas fixam o comportamento que a tela promete: a contagem da opção é
 * o total que a busca devolve ao escolhê-la, e cada lista aplica os OUTROS
 * filtros e nunca o próprio.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProjeto, createLote, createProduto } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

// Dois estados quadrados e um município dentro de cada, longe do resto do
// mundo: a prova precisa de geometria PREVISÍVEL, e não da malha do IBGE.
//
//   ALFA  (id 11): x de -50 a -48
//     municipio 1100001 "Vila Alfa":  x de -50 a -49
//     municipio 1100002 "Vila Beta":  x de -49 a -48
//   BETA  (id 12): x de -40 a -38
//     municipio 1200001 "Vila Gama":  x de -40 a -39
const quadrado = (x0, x1) =>
  `SRID=4674;MULTIPOLYGON(((${x0} -15, ${x1} -15, ${x1} -14, ${x0} -14, ${x0} -15)))`

beforeEach(async () => {
  await conn.none('DELETE FROM limites.municipio')
  await conn.none('DELETE FROM limites.estado')
  await conn.none(
    `INSERT INTO limites.estado (id, sigla, nome, regiao, geom) VALUES
     (11, 'AL', 'Alfa', 'Norte', ST_GeomFromEWKT($1)),
     (12, 'BE', 'Beta', 'Sul',   ST_GeomFromEWKT($2))`,
    [quadrado(-50, -48), quadrado(-40, -38)]
  )
  await conn.none(
    `INSERT INTO limites.municipio (id, nome, nome_busca, estado_id, geom) VALUES
     (1100001, 'Vila Alfa', 'vila alfa', 11, ST_GeomFromEWKT($1)),
     (1100002, 'Vila Beta', 'vila beta', 11, ST_GeomFromEWKT($2)),
     (1200001, 'Vila Gama', 'vila gama', 12, ST_GeomFromEWKT($3))`,
    [quadrado(-50, -49), quadrado(-49, -48), quadrado(-40, -39)]
  )
})

afterEach(async () => {
  await cleanTestData()
  await conn.none('DELETE FROM limites.municipio')
  await conn.none('DELETE FROM limites.estado')
})

const token = () => generateAdminToken()

// Um retângulo pequeno dentro do x pedido, na faixa de y dos limites.
const dentroDe = (x0, x1) =>
  `SRID=4674;POLYGON((${x0} -14.6, ${x1} -14.6, ${x1} -14.4, ${x0} -14.4, ${x0} -14.6))`

// --- Busca do acervo ---------------------------------------------------------

describe('Busca do acervo - filtro por lugar', () => {
  // `mi` e `inom` proprios em cada um: a identidade do produto e unica, e o
  // default do fixture repetiria os tres.
  const carta = (nome, x0, x1, n) => createProduto({
    nome, mi: `MI-LUGAR-${n}`, inom: `INOM-LUGAR-${n}`, geom: dentroDe(x0, x1)
  })

  const semear = async () => {
    await carta('Carta de Vila Alfa', -49.8, -49.2, 1)
    await carta('Carta de Vila Beta', -48.8, -48.2, 2)
    await carta('Carta de Vila Gama', -39.8, -39.2, 3)
  }

  const buscar = (query) => request(app)
    .get(`/api/acervo/busca?${query}`)
    .set('Authorization', token())

  it('filtra por ESTADO', async () => {
    await semear()
    const res = await buscar('estado_id=11')
    expect(res.status).toBe(200)
    expect(res.body.dados.dados.map(p => p.nome).sort()).toEqual([
      'Carta de Vila Alfa', 'Carta de Vila Beta'
    ])
  })

  it('filtra por MUNICÍPIO', async () => {
    await semear()
    const res = await buscar('municipio_id=1100001')
    expect(res.status).toBe(200)
    expect(res.body.dados.dados.map(p => p.nome)).toEqual(['Carta de Vila Alfa'])
  })

  it('produto que cruza a divisa aparece nos DOIS municípios', async () => {
    // De -49.3 a -48.7: metade em Vila Alfa, metade em Vila Beta. A pergunta é
    // "o que existe em X", e a folha que cobre metade de X existe lá.
    await carta('Carta da divisa', -49.3, -48.7, 9)

    for (const id of [1100001, 1100002]) {
      const res = await buscar(`municipio_id=${id}`)
      expect(res.body.dados.dados.map(p => p.nome)).toEqual(['Carta da divisa'])
    }
  })

  it('a contagem da faceta é o total que a busca devolve ao escolher', async () => {
    await semear()
    const facetas = await request(app)
      .get('/api/acervo/busca/facetas')
      .set('Authorization', token())
    expect(facetas.status).toBe(200)

    const alfa = facetas.body.dados.estados.find(e => e.id === 11)
    expect(alfa.produtos).toBe(2)

    const busca = await buscar('estado_id=11')
    expect(busca.body.dados.total).toBe(alfa.produtos)
  })

  it('o município só entra na lista quando há estado escolhido', async () => {
    await semear()
    const sem = await request(app)
      .get('/api/acervo/busca/facetas')
      .set('Authorization', token())
    expect(sem.body.dados.municipios).toEqual([])

    const com = await request(app)
      .get('/api/acervo/busca/facetas?estado_id=11')
      .set('Authorization', token())
    expect(com.body.dados.municipios.map(m => m.nome)).toEqual(['Vila Alfa', 'Vila Beta'])
  })

  it('a lista de estados NÃO aplica o próprio filtro', async () => {
    await semear()
    const res = await request(app)
      .get('/api/acervo/busca/facetas?estado_id=11')
      .set('Authorization', token())
    // Beta continua na lista, senão escolher Alfa impediria trocar de estado.
    expect(res.body.dados.estados.map(e => e.sigla).sort()).toEqual(['AL', 'BE'])
  })
})

// --- Ponto de controle -------------------------------------------------------

describe('Ponto de controle - filtro por lugar', () => {
  const semear = async () => {
    const projeto = await createProjeto({ nome: 'Projeto Lugar' })
    const lote = await createLote(projeto.id, { nome: 'Missão Lugar', pit: 'PIT-LUGAR' })
    const usuario = await conn.one('SELECT uuid FROM dgeo.usuario LIMIT 1')
    const ponto = async (cod, x) => conn.none(
      `INSERT INTO ponto_controle.ponto
         (cod_ponto, lote_id, data_rastreio, usuario_cadastramento_uuid, geom)
       VALUES ($1, $2, '2026-05-12', $3,
               ST_SetSRID(ST_MakePoint($4, -14.5), 4674))`,
      [cod, lote.id, usuario.uuid, x]
    )
    await ponto('AL-HV-1', -49.5)   // Vila Alfa
    await ponto('AL-HV-2', -48.5)   // Vila Beta
    await ponto('BE-HV-1', -39.5)   // Vila Gama
  }

  const listar = (query) => request(app)
    .get(`/api/ponto_controle?${query}`)
    .set('Authorization', token())

  it('filtra por ESTADO e por MUNICÍPIO', async () => {
    await semear()

    const porEstado = await listar('estado_id=11')
    expect(porEstado.status).toBe(200)
    expect(porEstado.body.dados.pontos.map(p => p.cod_ponto).sort())
      .toEqual(['AL-HV-1', 'AL-HV-2'])

    const porMunicipio = await listar('municipio_id=1200001')
    expect(porMunicipio.body.dados.pontos.map(p => p.cod_ponto)).toEqual(['BE-HV-1'])
  })

  it('a faceta traz o quantitativo, e o município depende do estado', async () => {
    await semear()

    const sem = await request(app)
      .get('/api/ponto_controle/facetas')
      .set('Authorization', token())
    expect(sem.status).toBe(200)
    expect(sem.body.dados.estados.find(e => e.code === 11).pontos).toBe(2)
    expect(sem.body.dados.municipios).toEqual([])

    const com = await request(app)
      .get('/api/ponto_controle/facetas?estado_id=11')
      .set('Authorization', token())
    expect(com.body.dados.municipios.map(m => [m.nome, m.pontos]))
      .toEqual([['Vila Alfa', 1], ['Vila Beta', 1]])
  })

  it('o filtro de lugar vale também para o mapa e para o CSV', async () => {
    await semear()

    const posicoes = await request(app)
      .get('/api/ponto_controle/posicoes?estado_id=12')
      .set('Authorization', token())
    expect(posicoes.status).toBe(200)
    expect(posicoes.body.dados.pontos).toHaveLength(1)

    const csv = await request(app)
      .get('/api/ponto_controle/csv?estado_id=12')
      .set('Authorization', token())
    expect(csv.status).toBe(200)
    expect(csv.text).toContain('BE-HV-1')
    expect(csv.text).not.toContain('AL-HV-1')
  })
})

// --- Códigos disponíveis -----------------------------------------------------

describe('Ponto de controle - códigos disponíveis', () => {
  const semear = async (codigos) => {
    const projeto = await createProjeto({ nome: 'Projeto Códigos' })
    const lote = await createLote(projeto.id, { nome: 'Missão Códigos', pit: 'PIT-COD' })
    const usuario = await conn.one('SELECT uuid FROM dgeo.usuario LIMIT 1')
    for (const cod of codigos) {
      await conn.none(
        `INSERT INTO ponto_controle.ponto
           (cod_ponto, lote_id, data_rastreio, usuario_cadastramento_uuid, geom)
         VALUES ($1, $2, '2026-05-12', $3,
                 ST_SetSRID(ST_MakePoint(-47.9, -15.5), 4674))`,
        [cod, lote.id, usuario.uuid]
      )
    }
  }

  const pedir = (query) => request(app)
    .get(`/api/ponto_controle/codigos_disponiveis${query ? '?' + query : ''}`)
    .set('Authorization', token())

  it('aponta o buraco na numeração e a sequência depois do maior', async () => {
    // O exemplo do próprio help do P14: existindo 10, 11 e 13, faltam 1 a 9 e 12.
    await semear(['DF-HV-10', 'DF-HV-11', 'DF-HV-13'])

    const res = await pedir('uf=DF&tipo=HV&quantidade=12')
    expect(res.status).toBe(200)
    expect(res.body.dados.usados).toBe(3)
    expect(res.body.dados.maior_usado).toBe(13)
    expect(res.body.dados.total_buracos).toBe(10)
    expect(res.body.dados.buracos).toEqual([
      'DF-HV-1', 'DF-HV-2', 'DF-HV-3', 'DF-HV-4', 'DF-HV-5',
      'DF-HV-6', 'DF-HV-7', 'DF-HV-8', 'DF-HV-9', 'DF-HV-12'
    ])
    expect(res.body.dados.proximos.slice(0, 3)).toEqual([
      'DF-HV-14', 'DF-HV-15', 'DF-HV-16'
    ])
  })

  it('HV e BASE são numerações SEPARADAS', async () => {
    // O erro que isso evita: dizer que DF-HV-2 está livre porque só existe
    // DF-BASE-2. São contagens diferentes, e misturá-las devolveria código
    // ocupado como se estivesse livre.
    await semear(['DF-HV-1', 'DF-HV-2', 'DF-BASE-5'])

    const hv = await pedir('uf=DF&tipo=HV')
    expect(hv.body.dados.buracos).toEqual([])
    expect(hv.body.dados.proximos[0]).toBe('DF-HV-3')

    const base = await pedir('uf=DF&tipo=BASE')
    expect(base.body.dados.maior_usado).toBe(5)
    expect(base.body.dados.buracos).toEqual([
      'DF-BASE-1', 'DF-BASE-2', 'DF-BASE-3', 'DF-BASE-4'
    ])
  })

  it('UF sem ponto nenhum começa do 1', async () => {
    await semear(['DF-HV-1'])
    const res = await pedir('uf=SP&tipo=HV&quantidade=3')
    expect(res.body.dados.usados).toBe(0)
    expect(res.body.dados.maior_usado).toBe(0)
    expect(res.body.dados.buracos).toEqual([])
    expect(res.body.dados.proximos).toEqual(['SP-HV-1', 'SP-HV-2', 'SP-HV-3'])
  })

  it('sem uf, devolve o RESUMO por grupo', async () => {
    await semear(['DF-HV-1', 'DF-HV-3', 'SP-BASE-2'])
    const res = await pedir('')
    expect(res.status).toBe(200)
    expect(res.body.dados.grupos).toEqual(expect.arrayContaining([
      expect.objectContaining({ uf: 'DF', tipo: 'HV', usados: 2, maior_usado: 3 }),
      expect.objectContaining({ uf: 'SP', tipo: 'BASE', usados: 1, maior_usado: 2 })
    ]))
  })

  it('uf sem tipo é recusado, porque as duas numerações não se misturam', async () => {
    const res = await pedir('uf=DF')
    expect(res.status).toBe(400)
  })

  it('a `quantidade` limita a RESPOSTA, e não a busca', async () => {
    // Com 1 a 50 livres e 51 usado, pedir 5 tem de devolver os 5 MENORES, e o
    // total de buracos continua dizendo que são 50.
    await semear(['DF-HV-51'])
    const res = await pedir('uf=DF&tipo=HV&quantidade=5')
    expect(res.body.dados.total_buracos).toBe(50)
    expect(res.body.dados.buracos).toEqual([
      'DF-HV-1', 'DF-HV-2', 'DF-HV-3', 'DF-HV-4', 'DF-HV-5'
    ])
  })
})
