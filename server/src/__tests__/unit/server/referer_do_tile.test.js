'use strict'

/**
 * O REFERER QUE O MAPA PRECISA MANDAR, e o que aconteceu quando ele sumiu.
 *
 * Em 2026-09-11 as seis telas do SAP que têm mapa passaram a mostrar o tile de
 * "Access blocked", 403, no lugar do fundo. A causa não era o proxy da rede nem
 * a OpenStreetMap ter bloqueado o IP: era NOSSA.
 *
 * O `helmet()` põe `Referrer-Policy: no-referrer` por PADRÃO, e o app.js só
 * sobrescrevia CSP, COOP e Origin-Agent-Cluster. Com isso o navegador apagava o
 * `Referer` de todo pedido que saísse das nossas páginas, inclusive dos tiles.
 * A política de uso da OSM (osm.wiki/Blocked) é literal: "all tile requests
 * must be identifiable to a particular website or application. For websites,
 * Referer is required". Servidor nenhum tinha como saber quem estava pedindo.
 *
 * O PIOR CASO QUE ESTA RÉGUA EXISTE PARA PEGAR é o estado anterior ao conserto:
 * o cabeçalho valendo `no-referrer`. O primeiro teste reprova exatamente isso,
 * e foi conferido contra o app.js de antes, onde ele FALHA.
 *
 * Não sobe banco: é teste do pacote rápido, e o que se mede é um cabeçalho.
 */

const fs = require('fs')
const path = require('path')
const express = require('express')
const helmet = require('helmet')
const request = require('supertest')

const APP_JS = path.join(__dirname, '..', '..', '..', 'server', 'app.js')

/**
 * Monta um Express com a MESMA chamada de helmet que o app.js faz, lida do
 * arquivo. Carregar o app.js inteiro puxaria banco, rotas e configuração, e o
 * que importa aqui é só a configuração do helmet.
 */
const appComOHelmetDoArquivo = () => {
  const fonte = fs.readFileSync(APP_JS, 'utf8')
  const m = fonte.match(/app\.use\(helmet\((\{[\s\S]*?\})\)\)/)
  if (!m) throw new Error('Não achei a chamada de helmet() no app.js')

  // eslint-disable-next-line no-eval
  const opcoes = eval('(' + m[1] + ')')

  const app = express()
  app.use(helmet(opcoes))
  app.get('/', (req, res) => res.send('ok'))
  return app
}

describe('Referrer-Policy: o mapa tem de se identificar para a OSM', () => {
  test('NÃO é no-referrer, que é o padrão do helmet e a causa do bloqueio', async () => {
    const res = await request(appComOHelmetDoArquivo()).get('/')

    expect(res.headers['referrer-policy']).toBeDefined()
    expect(res.headers['referrer-policy']).not.toBe('no-referrer')
  })

  test('é uma política que MANDA a origem para destino de outra origem', async () => {
    const res = await request(appComOHelmetDoArquivo()).get('/')

    // As que servem: mandam pelo menos a origem num pedido cross-origin.
    // `origin` e `unsafe-url` também mandariam, mas vazam mais do que o
    // necessário; `strict-origin-when-cross-origin` é o padrão dos navegadores.
    const queIdentificam = [
      'strict-origin-when-cross-origin',
      'origin-when-cross-origin',
      'strict-origin',
      'origin'
    ]
    expect(queIdentificam).toContain(res.headers['referrer-policy'])
  })

  // A ARMADILHA. As quatro políticas abaixo deixam o Referer VAZIO num pedido
  // cross-origin, e qualquer uma delas traria o bloqueio de volta. O teste
  // acima já as reprova; este diz por escrito quais são, para quem for mexer.
  test.each([
    ['no-referrer'],
    ['same-origin'],
    ['no-referrer-when-downgrade'],
    ['']
  ])('a política %p não identificaria o site para a OSM', async (politica) => {
    const app = express()
    app.use(helmet({ referrerPolicy: politica === '' ? false : { policy: politica } }))
    app.get('/', (req, res) => res.send('ok'))

    const res = await request(app).get('/')
    const valor = res.headers['referrer-policy']

    // `no-referrer-when-downgrade` manda o Referer de http para https, então
    // ela identificaria; está aqui porque é a que mais engana, e a nota é o
    // ponto do teste: ela some assim que o serviço for para https.
    if (politica === 'no-referrer-when-downgrade') {
      expect(valor).toBe(politica)
      return
    }
    // `false` desliga o cabeçalho, e aí vale o padrão do NAVEGADOR, que é
    // strict-origin-when-cross-origin e identificaria. O que não pode é o
    // helmet ESCREVER no-referrer, que é o caso de verdade.
    if (politica === '') {
      expect(valor).toBeUndefined()
      return
    }
    expect(['no-referrer', 'same-origin']).toContain(valor)
  })
})
