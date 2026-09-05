'use strict'

// O CSV DOS RELATORIOS PROMETE DD/MM/AAAA, E TEM DE ENTREGAR NAS DUAS FONTES.
//
// O cabecalho de `csv_export.js` diz "datas DD/MM/YYYY", e a funcao so formatava
// o que chegasse como `Date`. Acontece que `database/db.js` registra
// `setTypeParser(1082, valor => valor)` -- de proposito, contra o D-1 de fuso --
// e por isso TODA coluna DATE volta do driver como a string crua 'AAAA-MM-DD'.
//
// `mapoteca.pedido.data_pedido`, `data_atendimento` e `prazo` sao DATE. O
// resultado era um mesmo arquivo com DUAS formas de data: 2026-08-01 nas colunas
// DATE e 14/08/2026 em qualquer TIMESTAMPTZ do mesmo relatorio. Quem abre no
// Excel pt-BR recebe a primeira como TEXTO, e ordenar ou filtrar por mes deixa
// de funcionar na coluna pela qual o relatorio e lido.
//
// A prova que interessa e a da IGUALDADE: `Date` e string de dia tem de sair na
// MESMA forma. Teste puro, sem banco.

const { toCsv } = require('../../../utils/csv_export')

/** As celulas de uma linha do CSV, sem o BOM nem o cabecalho. */
const celulas = (csv, linha = 1) => csv.replace(/^﻿/, '').split('\r\n')[linha].split(';')

describe('formato de data no CSV', () => {
  test('a string de dia do driver sai em dd/mm/aaaa', () => {
    const csv = toCsv([{ data_pedido: '2026-08-01' }])
    expect(celulas(csv)).toEqual(['01/08/2026'])
  })

  // ESTA e a asserção que fecha o defeito: as duas fontes, lado a lado, na mesma
  // linha, com o mesmo texto. Um `Date` e uma string de dia que descrevam o
  // mesmo dia não podem sair diferentes.
  test('`Date` e string de dia saem IDÊNTICOS para o mesmo dia', () => {
    const csv = toCsv([
      { deDate: new Date(2026, 7, 1), deTexto: '2026-08-01' }
    ])
    const [deDate, deTexto] = celulas(csv)

    expect(deDate).toBe('01/08/2026')
    expect(deTexto).toBe(deDate)
  })

  test('o dia com zero à esquerda não perde o zero', () => {
    expect(celulas(toCsv([{ d: '2026-01-09' }]))).toEqual(['09/01/2026'])
  })

  test('texto que apenas COMEÇA com uma data continua saindo como veio', () => {
    // A forma inteira é o que casa. Um período ou uma observação que cite um dia
    // não é uma data, e reescrevê-la seria estragar o texto.
    const csv = toCsv([{ periodo: '2026-08-01 a 2026-08-31' }])
    expect(celulas(csv)).toEqual(['2026-08-01 a 2026-08-31'])
  })

  test('o instante com hora (TIMESTAMPTZ em texto) não é tocado aqui', () => {
    // O driver entrega TIMESTAMPTZ como `Date`, e é o ramo de cima que o
    // formata. O que chega com hora em texto vem de outro lugar e não é dia.
    const csv = toCsv([{ quando: '2026-08-01T12:30:00.000Z' }])
    expect(celulas(csv)).toEqual(['2026-08-01T12:30:00.000Z'])
  })
})

describe('o resto do contrato do CSV não mudou', () => {
  test('BOM UTF-8, separador ponto e vírgula e quebra CRLF', () => {
    const csv = toCsv(
      [{ a: 1, b: 2 }],
      [{ key: 'a', label: 'Coluna A' }, { key: 'b', label: 'Coluna B' }]
    )

    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv.replace(/^﻿/, '')).toBe('Coluna A;Coluna B\r\n1;2')
  })

  test('nulo vira vazio, booleano vira Sim/Não e lista vira texto separado', () => {
    // A vírgula não é o separador daqui, então a lista não precisa de aspas.
    const csv = toCsv([{ a: null, b: true, c: false, d: ['x', 'y'] }])
    expect(celulas(csv)).toEqual(['', 'Sim', 'Não', 'x, y'])
  })

  test('a data formatada NÃO é confundida com fórmula pelo neutralizador', () => {
    // `neutralizeFormula` roda DEPOIS do `formatValue`. Um dia formatado começa
    // por dígito, então nada de apóstrofo na frente.
    const csv = toCsv([{ d: '2026-08-01' }])
    expect(celulas(csv)[0].startsWith("'")).toBe(false)
  })
})
