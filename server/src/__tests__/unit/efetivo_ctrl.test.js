'use strict'

// Aproveitamento do efetivo: o que o SQL do mapa PODE devolver.
//
// A tela do mapa usa `posto_abrev` e `nome_guerra`, e mais nada de identificacao.
// O nome completo, o login e o nome por extenso do posto sao dado de pessoal, e
// trafegar sem uso e o que transforma uma tela de percentual num vazamento.
//
// A 6.1 do RPCMTec e OUTRO leitor: `resumoMensal` alimenta o gerador do
// documento, que escreve o nome por extenso. Por isso ela mantem as colunas, e
// e justamente essa diferenca que este arquivo fixa: cortar dos tres quebraria
// o relatorio em silencio.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../efetivo/efetivo_ctrl')

// `u.nome` e prefixo de `u.nome_guerra`, e `pg.nome` de `pg.nome_abrev`. Sem a
// negativa a assercao passaria a valer o contrario do que diz.
const SELECIONA_NOME_COMPLETO = /u\.nome(?!_guerra)/
const SELECIONA_POSTO_EXTENSO = /pg\.nome(?!_abrev)/
const SELECIONA_LOGIN = /u\.login/

const sqlDaChamada = () => mockDb.conn.any.mock.calls[0][0]

describe('efetivo_ctrl, o payload do mapa', () => {
  beforeEach(() => mockDb.reset())

  test('mapaAnual nao devolve nome completo, login nem posto por extenso', async () => {
    await ctrl.mapaAnual(2026)

    const sql = sqlDaChamada()
    expect(sql).not.toMatch(SELECIONA_NOME_COMPLETO)
    expect(sql).not.toMatch(SELECIONA_LOGIN)
    expect(sql).not.toMatch(SELECIONA_POSTO_EXTENSO)
  })

  test('mapaAnual mantem o que a tela desenha', async () => {
    await ctrl.mapaAnual(2026)

    const sql = sqlDaChamada()
    expect(sql).toMatch(/u\.nome_guerra/)
    expect(sql).toMatch(/pg\.nome_abrev AS posto_abrev/)
    // `ativo` fica: e o que faz a tela avisar da divergencia com o cadastro.
    expect(sql).toMatch(/u\.ativo/)
    expect(sql).toMatch(/dias_na_dgeo/)
  })

  test('resumoAnual nao devolve nome completo, login nem posto por extenso', async () => {
    await ctrl.resumoAnual(2026)

    const sql = sqlDaChamada()
    expect(sql).not.toMatch(SELECIONA_NOME_COMPLETO)
    expect(sql).not.toMatch(SELECIONA_LOGIN)
    expect(sql).not.toMatch(SELECIONA_POSTO_EXTENSO)
  })

  test('resumoAnual mantem o que a tela desenha', async () => {
    await ctrl.resumoAnual(2026)

    const sql = sqlDaChamada()
    expect(sql).toMatch(/u\.nome_guerra/)
    expect(sql).toMatch(/pg\.nome_abrev AS posto_abrev/)
    expect(sql).toMatch(/u\.ativo/)
    expect(sql).toMatch(/dias_do_ano/)
    expect(sql).toMatch(/dias_na_dgeo/)
  })

  // A 6.1 do RPCMTec escreve "1o Ten Pedro Martins" por extenso. Cortar as
  // colunas dela junto com as do mapa quebraria o documento sem erro visivel.
  test('resumoMensal MANTEM o nome completo e o posto por extenso, que a 6.1 usa', async () => {
    await ctrl.resumoMensal(2026, 3)

    const sql = sqlDaChamada()
    expect(sql).toMatch(SELECIONA_NOME_COMPLETO)
    expect(sql).toMatch(SELECIONA_POSTO_EXTENSO)
  })

  test('o recorte do ano vai por parametro nomeado, e cobre o ano inteiro', async () => {
    await ctrl.mapaAnual(2027)

    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.any(String),
      // `usuarioUuid` NULO e o mapa da DIVISAO, que e o caso de
      // `GET /efetivo/mapa`. Ele viaja sempre, e nao so quando ha recorte: o
      // pg-promise recusa parametro nomeado ausente, e o SQL o cita ou nao.
      { inicio: '2027-01-01', fim: '2027-12-31', usuarioUuid: null }
    )
  })

  // ---------------------------------------------------------------------------
  // O RECORTE POR PESSOA, que a tela `#/perfil` usa para desenhar o proprio ano.
  //
  // POR QUE ELE E UM FILTRO NAS FUNCOES QUE JA EXISTEM: duas consultas que
  // calculassem aproveitamento divergiriam na primeira correcao aplicada a uma
  // so, e a pessoa leria um numero na propria pagina e outro no mapa da Divisao.
  // ---------------------------------------------------------------------------
  const EU = '11111111-1111-1111-1111-111111111111'

  test('mapaAnual com uuid recorta em UMA pessoa, e dentro do `pessoas`', async () => {
    await ctrl.mapaAnual(2026, EU)

    const sql = sqlDaChamada()
    // NO `pessoas`, e nao num WHERE por fora: filtrar depois do CROSS JOIN faria
    // o Postgres montar a grade da Divisao inteira para devolver uma linha.
    expect(sql).toMatch(/FROM dgeo\.efetivo_periodo AS p[\s\S]*AND p\.usuario_uuid = \$<usuarioUuid>[\s\S]*CROSS JOIN/)
    expect(mockDb.conn.any.mock.calls[0][1].usuarioUuid).toBe(EU)
  })

  test('resumoAnual recorta pelo mesmo caminho', async () => {
    await ctrl.resumoAnual(2026, EU)

    expect(sqlDaChamada()).toMatch(/AND p\.usuario_uuid = \$<usuarioUuid>/)
    expect(mockDb.conn.any.mock.calls[0][1].usuarioUuid).toBe(EU)
  })

  // A VARIANCIA: sem estes dois, um controlador que recortasse SEMPRE deixaria o
  // bloco acima verde e esvaziaria o mapa da Divisao.
  test('sem uuid, o SQL nao cita o filtro de pessoa', async () => {
    await ctrl.mapaAnual(2026)

    expect(sqlDaChamada()).not.toMatch(/p\.usuario_uuid = \$<usuarioUuid>/)
  })

  // A 6.1 do RPCMTec e da Divisao inteira, e nunca de uma pessoa: ela nao ganhou
  // o parametro, e o SQL dela nao pode citar o filtro.
  test('resumoMensal continua sem recorte de pessoa', async () => {
    await ctrl.resumoMensal(2026, 3)

    expect(sqlDaChamada()).not.toMatch(/p\.usuario_uuid = \$<usuarioUuid>/)
  })
})
