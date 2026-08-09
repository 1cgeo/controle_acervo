'use strict'

// O PONTO ÚNICO de leitura da instituição, visto por quem EMITE DOCUMENTO.
//
// POR QUE ELE EXISTE. Até 2026-08-09 o nome do Centro estava escrito no código
// em dez lugares, e `rpcmtec_ctrl.areaDoCentro` já tinha aberto um
// `SELECT nome FROM dgeo.instituicao` próprio. Espalhar essa consulta pelos seis
// arquivos que precisam dela repetiria o defeito que a tabela veio consertar.
// `paraDocumento()` é esse ponto, e mora no módulo dono da tabela.
//
// O QUE ESTE ARQUIVO FIXA:
//
//   1. UMA leitura por chamada, e SEM cache: a segunda chamada volta ao banco.
//      Um cache de processo faria o relatório seguinte a um `PUT` sair com o
//      nome velho, sem erro e sem ninguém entender por quê.
//   2. O SLUG da sigla, que é o que entra em nome de arquivo.
//   3. A FALHA: sem instituição legível, o documento não sai. Nunca um valor
//      padrão -- um `|| '1º CGEO'` trancaria a instalação no Centro de quem
//      escreveu o código, e um `?? ''` imprimiria cabeçalho sem nome num PDF
//      que alguém assina.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../instituicao/instituicao_ctrl')

// A SEMENTE de `er/dgeo.sql`, e não uma verdade do sistema.
const SEMENTE = {
  id: 1,
  nome: '1º Centro de Geoinformação',
  sigla: '1º CGEO',
  ug_code: '160382'
}

describe('instituicaoCtrl.paraDocumento', () => {
  beforeEach(() => mockDb.reset())

  test('devolve a linha inteira, mais a sigla em forma de nome de arquivo', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(SEMENTE)

    await expect(ctrl.paraDocumento()).resolves.toEqual({
      ...SEMENTE,
      sigla_slug: '1CGEO'
    })
  })

  // SEM CACHE, e é o caso que guarda a decisão. Trocar a instituição por
  // `PUT /api/instituicao` tem de valer no documento SEGUINTE.
  test('cada chamada volta ao banco: a troca vale na hora', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(SEMENTE)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      ...SEMENTE, nome: '2º Centro de Geoinformação', sigla: '2º CGEO'
    })

    const antes = await ctrl.paraDocumento()
    const depois = await ctrl.paraDocumento()

    expect(antes.sigla).toBe('1º CGEO')
    expect(depois.sigla).toBe('2º CGEO')
    expect(depois.sigla_slug).toBe('2CGEO')
    expect(mockDb.conn.oneOrNone).toHaveBeenCalledTimes(2)
  })

  test('a linha ausente vira erro de DOCUMENTO, e diz onde se configura', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    const erro = await ctrl.paraDocumento().catch(e => e)

    expect(erro.statusCode).toBe(500)
    expect(erro.message).toContain('PUT /api/instituicao')
  })

  // O BANCO EM PÉ DE GUERRA é a outra causa, e ela cai na mesma mensagem: quem
  // a lê está gerando um relatório, e o que precisa saber é que o documento
  // parou por causa da instituição.
  test('o banco que não responde não vira "undefined CGEO": vira erro', async () => {
    mockDb.conn.oneOrNone.mockRejectedValueOnce(new Error('connection terminated'))

    const erro = await ctrl.paraDocumento().catch(e => e)

    expect(erro.statusCode).toBe(500)
    expect(erro.message).toContain('dgeo.instituicao')
  })

  // NOT NULL não protege de ' '. A coluna aceita, e o cabeçalho sairia vazio.
  test.each(['nome', 'sigla'])('%s em branco recusa: meia instituição não serve', async campo => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ...SEMENTE, [campo]: '   ' })

    const erro = await ctrl.paraDocumento().catch(e => e)

    expect(erro.statusCode).toBe(500)
  })

  test('sigla sem letra nem número recusa, porque não vira nome de arquivo', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ...SEMENTE, sigla: '---' })

    const erro = await ctrl.paraDocumento().catch(e => e)

    expect(erro.statusCode).toBe(500)
    expect(erro.message).toContain('nome de arquivo')
  })
})

// O SLUG segue a ideia de `acervo.slug_nome()` (er/acervo.sql) -- sem acento, só
// [A-Z0-9], maiúsculo -- com UMA divergência: lá o que sobra entre os pedaços
// vira '-', aqui vira nada. O nome que a DSG já recebe é
// `Anuario_Estatistico_1CGEO_06_Junho_2026.ods`, e um '1-CGEO' meteria um
// segundo separador dentro de um nome separado por '_'.
describe('a sigla como nome de arquivo', () => {
  test('o espaço e o ordinal somem, e o 1º CGEO continua sendo 1CGEO', () => {
    expect(ctrl.slugDaSigla('1º CGEO')).toBe('1CGEO')
  })

  // O 'º' TEM DE SUMIR, e não virar 'o'. É o que separa NFD de NFKD: em NFKD o
  // ordinal se decompõe na letra, e a sigla sairia como '1OCGEO'.
  test('o ordinal não vira a letra "o"', () => {
    expect(ctrl.slugDaSigla('1º CGEO')).not.toContain('O CGEO')
    expect(ctrl.slugDaSigla('1º CGEO')).not.toBe('1OCGEO')
  })

  test('o acento cai, e a letra fica', () => {
    expect(ctrl.slugDaSigla('Centro Ação-Sul')).toBe('CENTROACAOSUL')
  })

  test('outro Centro dá outro slug, que é o motivo de tudo isto', () => {
    expect(ctrl.slugDaSigla('2º CGEO')).toBe('2CGEO')
    expect(ctrl.slugDaSigla('4 CGEO')).toBe('4CGEO')
  })
})
