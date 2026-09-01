'use strict'

// A COLUNA "PREVISÃO DE FALTA DE ESTOQUE" DA 7.2, E O QUE ELA TEM DE RECUSAR.
//
// POR QUE ESTE ARQUIVO EXISTE. Em 2026-09-01 a coluna saía em TRAÇO nas 34
// linhas da edição de agosto, e ninguém sabia por quê. Duas causas somadas: o
// mínimo de três meses com consumo, num livro (`mapoteca.movimento_material`)
// que nasceu em julho/2026 e só tinha UM mês lançado; e a janela, que descartava
// o mês da própria edição, justamente o único mês com consumo. A tabela imprimia
// "Consumo no mês: 7" numa coluna e "-" na coluna seguinte, que é a que divide
// por ele. Nenhum teste cobria a régua: o único arquivo do repo que a nomeava
// era o próprio controller.
//
// O QUE O CHEFE DECIDIU em 2026-09-01: mínimo de UM mês, e o mês da edição
// dentro da janela. O RPCMTec de agosto se escreve em setembro, com agosto
// fechado, então o mês da edição é sempre um mês inteiro.
//
// O QUE ESTE ARQUIVO COBRA. Afrouxar um mínimo de três para um DESARMA a guarda
// contra o mês de acaso, e o que sobra de guarda tem de ficar preso. Os casos
// abaixo são o PIOR CASO da régua: entrada em que ela precisa REPROVAR, e não
// devolver uma data com cara de apurada. Cada `expect('-')` aqui é uma linha do
// documento assinado que não vai mentir.
//
// A JANELA É EXERCITADA NAS DUAS BORDAS, e não só na de dentro: um teste que só
// olha o mês que conta aprova por omissão a janela de treze meses, que foi
// exatamente o erro que o `+ 1` do `inicio` evita.
//
// O QUE ELE NÃO PROVA: que `mapoteca.movimento_material` tem o consumo lançado.
// Régua e cadastro são coisas separadas, e o traço honesto de um material sem
// lançamento continua sendo a resposta certa.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const { projetarFalta } = require('../../rpcmtec/rpcmtec_ctrl')

// A edição de referência é a de AGOSTO/2026, a que expôs o defeito. A janela
// dela vai de setembro/2025 a agosto/2026, as duas pontas incluídas.
const EDICAO = { ano: 2026, mes: 8 }

const mes = (ano, mes, quantidade) => ({ ano, mes, quantidade })

const prever = (estoque, consumoPorMes) =>
  projetarFalta({ estoque, consumoPorMes, ...EDICAO })

describe('rpcmtec 7.2: a previsão de falta reprova o que não sustenta conta', () => {
  test('material sem consumo nenhum na janela sai em traço, e não em data', () => {
    expect(prever(99, [])).toBe('-')
    expect(prever(99, [mes(2026, 8, 0), mes(2026, 7, 0)])).toBe('-')
  })

  test('consumo que existe mas caiu FORA da janela não projeta', () => {
    // Julho/2025 é anterior ao começo da janela de agosto/2026. Um material
    // parado há mais de um ano não tem ritmo, e inventar um a partir do gasto
    // de treze meses atrás daria uma data que ninguém pode defender.
    expect(prever(99, [mes(2025, 7, 50)])).toBe('-')
  })

  test('a janela tem DOZE meses, e as duas bordas provam isso', () => {
    // Setembro/2025 é o primeiro mês que conta.
    expect(prever(10, [mes(2025, 9, 10)])).not.toBe('-')
    // Agosto/2025 é o mês imediatamente anterior, e ele NÃO conta. Sem esta
    // linha, uma janela de treze meses passaria verde.
    expect(prever(10, [mes(2025, 8, 10)])).toBe('-')
  })

  test('o MÊS DA EDIÇÃO conta, que é a regressão de 2026-09-01', () => {
    // Este é o caso que saía '-' e não podia: o consumo lançado no mês do
    // relatório é o único que a Divisão tinha, e a coluna o ignorava.
    expect(prever(28, [mes(2026, 8, 7)])).toBe('DEZ 26')
  })

  test('estoque zerado com consumo acontecendo diz "Sem estoque", e não uma data', () => {
    // Data no passado seria pior do que inútil: o insumo já acabou, e a linha
    // tem de dizer isso com todas as letras.
    expect(prever(0, [mes(2026, 8, 5)])).toBe('Sem estoque')
  })

  test('quantidade negativa ou zerada no mês não vira ritmo', () => {
    // A quantidade é filtrada por `> 0`. Um estorno lançado como negativo não
    // pode virar média, sob pena de a previsão sair para o passado.
    expect(prever(50, [mes(2026, 8, 0)])).toBe('-')
    expect(prever(50, [mes(2026, 8, -4)])).toBe('-')
  })

  test('com mais de um mês, a média é a dos meses QUE TIVERAM consumo', () => {
    // Três meses de 10, e não a soma dividida por doze: dividir pelos doze
    // afundaria a média e empurraria a falta para longe.
    const serie = [mes(2026, 6, 10), mes(2026, 7, 10), mes(2026, 8, 10)]
    // 100 / 10 = 10 meses a partir de agosto/2026 -> junho/2027.
    expect(prever(100, serie)).toBe('JUN 27')
    // Os meses zerados no meio não entram na conta e não mudam o resultado.
    expect(prever(100, [...serie, mes(2026, 5, 0), mes(2026, 4, 0)])).toBe('JUN 27')
  })

  test('a projeção atravessa a virada do ano, no ano com dois dígitos', () => {
    // Cinco unidades por mês em 61 de estoque dão doze meses, e doze meses a
    // partir de agosto/2026 caem em agosto/2027. O formato é o do documento.
    expect(prever(61, [mes(2026, 8, 5)])).toBe('AGO 27')
    // E a série pode nascer no ano anterior sem que a janela a perca.
    expect(prever(24, [mes(2025, 10, 2), mes(2025, 11, 2), mes(2026, 8, 2)]))
      .toBe('AGO 27')
  })
})
