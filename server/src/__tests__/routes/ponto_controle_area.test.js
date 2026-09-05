'use strict'

/**
 * Recorte por ÁREA DESENHADA na tela de ponto de controle.
 *
 * A tela já tinha o "só na área do mapa", que é um retângulo. O desenho responde
 * a outra pergunta: "que pontos existem DENTRO deste polígono", que é o recorte
 * de uma região de trabalho, de um vale ou de uma faixa de fronteira. Nenhum
 * deles é retângulo.
 *
 * A prova central é a do triângulo: um ponto pode estar dentro do retângulo
 * envolvente do desenho e FORA do desenho. Filtrar só pelo `&&` (que compara
 * envolventes e é o que usa o índice) devolveria esse ponto, e a tela mostraria
 * ponto fora da área que a pessoa desenhou.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProjeto, createLote } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const token = () => generateAdminToken()

/**
 * Três pontos, dois deles escolhidos para o triângulo:
 *
 *   (-50,-15) DENTRO      canto de baixo à esquerda, dentro do triângulo
 *   (-48,-15) FORA        canto de baixo à direita: dentro da ENVOLVENTE do
 *                         triângulo, fora do triângulo
 *   (-30,-15) LONGE       fora de qualquer leitura do desenho
 */
const semear = async () => {
  const projeto = await createProjeto({ nome: 'Projeto Área' })
  const lote = await createLote(projeto.id, { nome: 'Missão Área', pit: 'PIT-AREA' })
  const usuario = await conn.one('SELECT uuid FROM dgeo.usuario LIMIT 1')
  const ponto = (cod, x, y) => conn.none(
    `INSERT INTO ponto_controle.ponto
       (cod_ponto, lote_id, data_rastreio, usuario_cadastramento_uuid, geom)
     VALUES ($1, $2, '2026-05-12', $3, ST_SetSRID(ST_MakePoint($4, $5), 4674))`,
    [cod, lote.id, usuario.uuid, x, y]
  )
  await ponto('AR-HV-1', -50.0, -15.0)
  await ponto('AR-HV-2', -48.0, -15.0)
  await ponto('AR-HV-3', -30.0, -15.0)
}

const poligono = anel => encodeURIComponent(
  JSON.stringify({ type: 'Polygon', coordinates: [anel] })
)

// Triângulo retângulo com o ângulo reto embaixo à esquerda. A hipotenusa passa
// entre os dois primeiros pontos: a envolvente pega os dois, o triângulo não.
const TRIANGULO = [
  [-50.5, -15.5], [-47.5, -15.5], [-50.5, -14.5], [-50.5, -15.5]
]

// Quadrado que cobre os dois primeiros pontos, e não o terceiro.
const QUADRADO = [
  [-50.5, -15.5], [-47.5, -15.5], [-47.5, -14.5], [-50.5, -14.5], [-50.5, -15.5]
]

const listar = query => request(app)
  .get(`/api/ponto_controle?${query}`)
  .set('Authorization', token())

describe('Ponto de controle - área desenhada', () => {
  it('devolve só os pontos DENTRO do desenho', async () => {
    await semear()
    const res = await listar(`geometria=${poligono(QUADRADO)}`)
    expect(res.status).toBe(200)
    expect(res.body.dados.pontos.map(p => p.cod_ponto).sort())
      .toEqual(['AR-HV-1', 'AR-HV-2'])
  })

  it('ponto dentro da ENVOLVENTE e fora do desenho não entra', async () => {
    await semear()

    // O quadrado e o triângulo têm a MESMA envolvente. Se o filtro fosse só o
    // `&&`, as duas consultas devolveriam a mesma coisa.
    const res = await listar(`geometria=${poligono(TRIANGULO)}`)
    expect(res.status).toBe(200)
    expect(res.body.dados.pontos.map(p => p.cod_ponto)).toEqual(['AR-HV-1'])
  })

  it('o desenho vale para o mapa, para a faceta e para o CSV', async () => {
    await semear()
    const area = `geometria=${poligono(TRIANGULO)}`

    const posicoes = await request(app)
      .get(`/api/ponto_controle/posicoes?${area}`)
      .set('Authorization', token())
    expect(posicoes.status).toBe(200)
    expect(posicoes.body.dados.pontos.map(p => p.cod_ponto)).toEqual(['AR-HV-1'])

    // A faceta tem de contar o MESMO que a lista devolve, senão o número entre
    // parênteses promete um resultado que a tela não entrega.
    const facetas = await request(app)
      .get(`/api/ponto_controle/facetas?${area}`)
      .set('Authorization', token())
    expect(facetas.status).toBe(200)
    const projeto = facetas.body.dados.projetos.find(p => p.nome === 'Projeto Área')
    expect(projeto.pontos).toBe(1)

    const csv = await request(app)
      .get(`/api/ponto_controle/csv?${area}`)
      .set('Authorization', token())
    expect(csv.status).toBe(200)
    expect(csv.text).toContain('AR-HV-1')
    expect(csv.text).not.toContain('AR-HV-2')
  })

  it('o desenho se soma aos outros filtros, e não os substitui', async () => {
    await semear()
    const res = await listar(
      `geometria=${poligono(QUADRADO)}&cod_ponto=AR-HV-2`
    )
    expect(res.body.dados.pontos.map(p => p.cod_ponto)).toEqual(['AR-HV-2'])
  })

  it('geometria malformada é recusada com 400, e não derruba a consulta', async () => {
    await semear()

    // Anel aberto: o PostGIS recusaria a geometria e a consulta inteira falharia
    // com 500. A validação tem de pegar antes.
    const aberto = poligono([
      [-50.5, -15.5], [-47.5, -15.5], [-47.5, -14.5], [-50.5, -14.5]
    ])
    expect((await listar(`geometria=${aberto}`)).status).toBe(400)

    expect((await listar('geometria=nao-e-json')).status).toBe(400)

    const linha = encodeURIComponent(JSON.stringify({
      type: 'LineString', coordinates: [[-50, -15], [-48, -15]]
    }))
    expect((await listar(`geometria=${linha}`)).status).toBe(400)
  })
})

// O CSV PERDIA O TEXTO DE "OUTRA REFERENCIA".
//
// Os codigos 99 de `sistema_geodesico` e `referencial_altim` querem dizer "e
// outra"; QUAL e mora em `outra_ref_plan` e `outro_ref_alt`, e essas duas
// colunas nao estavam no SELECT do CSV. A planilha mostrava so o rotulo
// generico, e quem exportava perdia exatamente a informacao que o codigo 99
// existe para registrar -- sem ter como saber que perdeu. A ficha nunca teve o
// problema porque le a linha inteira.
describe('CSV do ponto de controle - a "Outra referencia"', () => {
  it('traz o TEXTO das duas outras referencias, e nao so o rotulo generico', async () => {
    const projeto = await createProjeto({ nome: 'Projeto Ref' })
    const lote = await createLote(projeto.id, { nome: 'Missão Ref', pit: 'PIT-REF' })
    const usuario = await conn.one('SELECT uuid FROM dgeo.usuario LIMIT 1')

    await conn.none(
      `INSERT INTO ponto_controle.ponto
         (cod_ponto, lote_id, data_rastreio, usuario_cadastramento_uuid, geom,
          sistema_geodesico, outra_ref_plan, referencial_altim, outro_ref_alt)
       VALUES ('REF-HV-1', $1, '2026-05-12', $2,
               ST_SetSRID(ST_MakePoint(-50, -15), 4674),
               99, 'SAD-69 local da obra', 99, 'RN do porto de Rio Grande')`,
      [lote.id, usuario.uuid]
    )

    const csv = await request(app)
      .get('/api/ponto_controle/csv')
      .set('Authorization', token())

    expect(csv.status).toBe(200)
    expect(csv.text).toContain('SAD-69 local da obra')
    expect(csv.text).toContain('RN do porto de Rio Grande')
    // E as colunas aparecem no cabecalho, e nao so o valor solto numa linha.
    expect(csv.text).toContain('outra_ref_plan')
    expect(csv.text).toContain('outro_ref_alt')
  })
})
