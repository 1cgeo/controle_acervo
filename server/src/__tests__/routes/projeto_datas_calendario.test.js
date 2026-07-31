'use strict'

// Datas de projeto e lote sao dia de CALENDARIO, e precisam sobreviver ao
// round-trip GET -> PUT.
//
// O BUG QUE ESTES TESTES TRAVAM. `acervo.projeto.data_inicio` e
// `acervo.lote.data_inicio` sao colunas DATE. Sem `.raw()` no Joi, a string
// 'AAAA-MM-DD' virava um Date de meia-noite UTC; o Postgres convertia para o
// fuso da sessao antes de guardar, e em UTC-3 o dia RECUAVA. Como o GET devolve
// 'AAAA-MM-DD', reenviar exatamente o que o GET deu, sem mudar nada, tirava um
// dia da data a CADA chamada.
//
// Nenhum teste pegava isso porque todos criavam e liam, sem reenviar. O round
// trip e o unico jeito de provar, e por isso ele e a forma destes testes.
//
// Estes testes valem em qualquer fuso do servidor de teste: eles comparam a data
// com ela mesma, nunca com uma constante calculada.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()
const so_dia = (v) => String(v).slice(0, 10)

const listarProjetos = async () =>
  (await request(app).get('/api/projetos/projeto').set('Authorization', admin())).body.dados

const listarLotes = async () =>
  (await request(app).get('/api/projetos/lote').set('Authorization', admin())).body.dados

describe('datas de calendario em projeto e lote', () => {
  it('should not shift the project dates on a no-op round trip', async () => {
    const criado = await request(app)
      .post('/api/projetos/projeto').set('Authorization', admin())
      .send({
        nome: 'Projeto Round Trip', descricao: '',
        data_inicio: '2022-09-15', data_fim: '2022-09-15',
        status_execucao_id: 3
      })
    expect(criado.status).toBe(201)

    const antes = (await listarProjetos()).find(p => p.nome === 'Projeto Round Trip')
    expect(so_dia(antes.data_inicio)).toBe('2022-09-15')
    expect(so_dia(antes.data_fim)).toBe('2022-09-15')

    // Reenvia o que o GET devolveu, sem alterar data nenhuma.
    const put = await request(app)
      .put('/api/projetos/projeto').set('Authorization', admin())
      .send({
        id: Number(antes.id), nome: antes.nome, descricao: antes.descricao || '',
        data_inicio: so_dia(antes.data_inicio), data_fim: so_dia(antes.data_fim),
        status_execucao_id: Number(antes.status_execucao_id)
      })
    expect(put.status).toBe(200)

    const depois = (await listarProjetos()).find(p => Number(p.id) === Number(antes.id))
    expect(so_dia(depois.data_inicio)).toBe(so_dia(antes.data_inicio))
    expect(so_dia(depois.data_fim)).toBe(so_dia(antes.data_fim))
  })

  it('should not shift the lote dates on a no-op round trip', async () => {
    const proj = await request(app)
      .post('/api/projetos/projeto').set('Authorization', admin())
      .send({
        nome: 'Projeto do Lote', descricao: '',
        data_inicio: '2018-03-12', data_fim: '2022-09-15', status_execucao_id: 3
      })
    expect(proj.status).toBe(201)
    const projetoId = Number((await listarProjetos()).find(p => p.nome === 'Projeto do Lote').id)

    const criado = await request(app)
      .post('/api/projetos/lote').set('Authorization', admin())
      .send({
        projeto_id: projetoId, pit: '2021-25k', nome: 'Lote Round Trip',
        descricao: '', data_inicio: '2022-06-02', data_fim: '2022-06-02',
        status_execucao_id: 3
      })
    expect(criado.status).toBe(201)

    const antes = (await listarLotes()).find(l => l.nome === 'Lote Round Trip')
    expect(so_dia(antes.data_inicio)).toBe('2022-06-02')

    const put = await request(app)
      .put('/api/projetos/lote').set('Authorization', admin())
      .send({
        id: Number(antes.id), projeto_id: Number(antes.projeto_id), pit: antes.pit,
        nome: antes.nome, descricao: antes.descricao || '',
        data_inicio: so_dia(antes.data_inicio), data_fim: so_dia(antes.data_fim),
        status_execucao_id: Number(antes.status_execucao_id)
      })
    expect(put.status).toBe(200)

    const depois = (await listarLotes()).find(l => Number(l.id) === Number(antes.id))
    expect(so_dia(depois.data_inicio)).toBe(so_dia(antes.data_inicio))
    expect(so_dia(depois.data_fim)).toBe(so_dia(antes.data_fim))
  })

  // Tres voltas seguidas. A perda era de UM dia por chamada, entao um teste de
  // uma volta so pega o bug; tres provam que nao sobrou deriva menor.
  it('should survive three consecutive round trips', async () => {
    await request(app)
      .post('/api/projetos/projeto').set('Authorization', admin())
      .send({
        nome: 'Projeto Tres Voltas', descricao: '',
        data_inicio: '2020-01-01', data_fim: '2021-10-21', status_execucao_id: 3
      })
    const id = Number((await listarProjetos()).find(p => p.nome === 'Projeto Tres Voltas').id)

    for (let i = 0; i < 3; i++) {
      const atual = (await listarProjetos()).find(p => Number(p.id) === id)
      await request(app)
        .put('/api/projetos/projeto').set('Authorization', admin())
        .send({
          id, nome: atual.nome, descricao: atual.descricao || '',
          data_inicio: so_dia(atual.data_inicio), data_fim: so_dia(atual.data_fim),
          status_execucao_id: Number(atual.status_execucao_id)
        })
    }

    const fim = (await listarProjetos()).find(p => Number(p.id) === id)
    expect(so_dia(fim.data_inicio)).toBe('2020-01-01')
    expect(so_dia(fim.data_fim)).toBe('2021-10-21')
  })
})
