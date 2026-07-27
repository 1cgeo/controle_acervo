'use strict'

// Teste unitario do gerador da secao 3 do RPCMTec (banco mockado).
// Cobre: linha TOTAL na 3.1, recorte cumulativo/mensal e o Markdown com tabela
// vazia. NAO ha mais checagem de exercicio: gerarSecao3 vai direto as 7
// agregacoes (Promise.all), entao a 1a chamada db.conn.any e a tabela_31.

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({ db: mockDb }))

const ctrl = require('../../../orcamento/relatorio/relatorio_ctrl')

beforeEach(() => mockDb.reset())

describe('relatorio_ctrl.gerarSecao3', () => {
  test('monta as 7 subtabelas e a linha de TOTAL na 3.1 (com split PDR/Extra-PDR)', async () => {
    // Ordem das chamadas db.conn.any no Promise.all: 31, 32(PDR), 33, 34, 35, 36, 37.
    // A 1a chamada any e a tabela_31; as demais ficam no default [] do mock.
    // A 3.1 traz previsto (PDR) e recebido/empenhado/liquidado quebrados em
    // _pdr/_extra; o total de cada fluxo e composto (pdr + extra) no ctrl.
    mockDb.conn.any.mockResolvedValueOnce([
      {
        cod_nd: '339015', nd_nome: 'Diarias', previsto: '100',
        recebido_pdr: '40', recebido_extra: '10',
        recolhido_pdr: '5', recolhido_extra: '2',
        empenhado_pdr: '20', empenhado_extra: '10',
        liquidado_pdr: '7', liquidado_extra: '3'
      }
    ])

    const r = await ctrl.gerarSecao3({ ano: 2026, mes: 6, cumulativo: true })

    expect(r).toHaveProperty('tabela_31')
    expect(r).toHaveProperty('tabela_37')

    // Linha por ND: total = pdr + extra.
    const nd = r.tabela_31[0]
    expect(nd.recebido).toBe(50)
    expect(nd.recebido_pdr).toBe(40)
    expect(nd.recebido_extra).toBe(10)
    expect(nd.recolhido).toBe(7)
    expect(nd.recolhido_pdr).toBe(5)
    expect(nd.recolhido_extra).toBe(2)
    expect(nd.empenhado).toBe(30)
    expect(nd.empenhado_pdr).toBe(20)
    expect(nd.empenhado_extra).toBe(10)
    expect(nd.liquidado).toBe(10)
    expect(nd.liquidado_pdr).toBe(7)
    expect(nd.liquidado_extra).toBe(3)

    const total = r.tabela_31[r.tabela_31.length - 1]
    expect(total.cod_nd).toBe('TOTAL')
    expect(total.previsto).toBe(100)
    expect(total.recebido).toBe(50)
    expect(total.recebido_pdr).toBe(40)
    expect(total.recebido_extra).toBe(10)
    expect(total.recolhido).toBe(7)
    expect(total.recolhido_pdr).toBe(5)
    expect(total.recolhido_extra).toBe(2)
    expect(total.empenhado).toBe(30)
    expect(total.liquidado).toBe(10)
  })

  test('recorte cumulativo usa 01-01 do ano como inicio', async () => {
    const r = await ctrl.gerarSecao3({ ano: 2026, mes: 3, cumulativo: true })
    expect(r.inicio).toBe('2026-01-01')
    expect(r.cutoff).toBe('2026-03-31')
  })

  test('nao cumulativo usa o primeiro dia do mes como inicio', async () => {
    const r = await ctrl.gerarSecao3({ ano: 2026, mes: 2, cumulativo: false })
    expect(r.inicio).toBe('2026-02-01')
    expect(r.cutoff).toBe('2026-02-28') // 2026 nao e bissexto
  })
})

describe('relatorio_ctrl.gerarSecao3Markdown', () => {
  test('renderiza as 7 subsecoes e tabela vazia com linha de hifens', async () => {
    // todas as 7 tabelas vazias (default [])
    const { markdown } = await ctrl.gerarSecao3Markdown({ ano: 2026, mes: 6, cumulativo: true })
    for (const titulo of ['### 3.1', '### 3.2', '### 3.3', '### 3.4', '### 3.5', '### 3.6', '### 3.7']) {
      expect(markdown).toContain(titulo)
    }
    // 3.2 vazia: cabecalho (8 colunas, com Valor Recolhido) + uma linha so de '-'
    expect(markdown).toContain('| - | - | - | - | - | - | - | - |')
  })
})
