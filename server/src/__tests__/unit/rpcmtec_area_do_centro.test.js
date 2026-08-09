'use strict'

// A SUBSEÇÃO 2.7 NÃO PODE SAIR ZERADA, E ESTE ARQUIVO É O QUE PROVA ISSO.
//
// O QUE MUDOU EM 2026-08-09. `limites.area_suprimento` tinha uma coluna
// `e_1cgeo BOOLEAN`, e a 2.7 ("Estado do Acervo") recortava o acervo pela linha
// marcada nela. O chefe removeu a coluna: um booleano chamado "é o 1º CGEO"
// trancava a instalação num Centro. Quem diz de quem é a área passou a ser
// `dgeo.instituicao.nome`, comparado com `area_suprimento.cgeo`.
//
// A ARMADILHA QUE ISSO ABRE. O `cgeo` vem da fonte externa `asc_insumos`, e a
// comparação é de TEXTO EXATO. Um acento a menos, um 'º' escrito como 'o' ou um
// espaço sobrando fazem o filtro devolver ZERO linhas, sem erro nenhum: o
// numerador da 2.7 vira zero, a coluna "% da ASC" vira 0%, e o RPCMTec sai
// assinado dizendo que nada da nossa área está catalogado.
//
// POR ISSO O TESTE COBRA UM ERRO, E NÃO UM ZERO. É a diferença que motiva o
// arquivo inteiro: o comportamento errado aqui não é uma exceção, é uma resposta
// bem-formada e falsa. Sem este teste, o dia em que alguém "consertar" o erro
// devolvendo zero passaria verde.
//
// O QUE ELE NÃO PROVA: que o texto da semente de `er/limites.sql` casa com o de
// `er/dgeo.sql`. Isso é igualdade entre dois arquivos de DDL, e quem a exercita
// é o `er/` aplicado num banco de verdade.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../rpcmtec/rpcmtec_ctrl')

// A SEMENTE de `er/dgeo.sql`, e não uma constante do sistema: é o que uma
// instalação nova traz até alguém trocar por `PUT /api/instituicao`. Este
// arquivo encena a instituição, e o nome só aparece aqui porque é preciso
// encenar ALGUM.
const SEMENTE = { nome: '1º Centro de Geoinformação', sigla: '1º CGEO' }
const NOME = SEMENTE.nome

// As duas leituras de `areaDoCentro`, na ordem: a instituição configurada (que
// desde 2026-08-09 sai do ponto único, `instituicao_ctrl.paraDocumento`, e não
// mais de um SELECT deste arquivo) e a área que casa com o nome dela.
//
// A INSTITUIÇÃO ENCENADA TRAZ SIGLA, e não só nome. `paraDocumento` cobra os
// dois preenchidos mesmo de quem só vai usar o nome, porque quem a pede está
// montando um documento que leva os dois -- e é melhor parar na primeira
// leitura do que com meia edição calculada.
const encenar = ({ instituicao, area }) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce(instituicao)
  mockDb.conn.oneOrNone.mockResolvedValueOnce(area)
}

describe('rpcmtec 2.7: a área é de quem a instalação diz que é', () => {
  beforeEach(() => mockDb.reset())

  test('o nome configurado que CASA devolve o texto, e é ele que a consulta usa', async () => {
    encenar({ instituicao: SEMENTE, area: { id: 1 } })

    await expect(ctrl.areaDoCentro()).resolves.toBe(NOME)

    // O parâmetro é o nome, e não um booleano nem um id fixo: é o que garante
    // que outra instalação mede a área DELA.
    const [, params] = mockDb.conn.oneOrNone.mock.calls[1]
    expect(params).toEqual({ nome: NOME })
  })

  // O CASO QUE ESTE ARQUIVO EXISTE PARA PEGAR.
  test('nome configurado que NÃO existe em area_suprimento dá erro, e não zero', async () => {
    // O 'º' virou 'o' e os acentos caíram: é o estrago típico de uma carga que
    // atravessou uma planilha ou um encoding pelo caminho.
    mockDb.conn.oneOrNone.mockResolvedValueOnce(SEMENTE)
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    mockDb.conn.any.mockResolvedValueOnce([
      { cgeo: '1o Centro de Geoinformacao' },
      { cgeo: '2º Centro de Geoinformação' }
    ])

    // `rejects` primeiro: se um dia `areaDoCentro` voltar a RESOLVER, é aqui que
    // a suíte reprova, e não numa asserção de mensagem que nunca roda.
    await expect(ctrl.areaDoCentro()).rejects.toThrow()

    mockDb.reset()
    mockDb.conn.oneOrNone.mockResolvedValueOnce(SEMENTE)
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    mockDb.conn.any.mockResolvedValueOnce([
      { cgeo: '1o Centro de Geoinformacao' },
      { cgeo: '2º Centro de Geoinformação' }
    ])

    const erro = await ctrl.areaDoCentro().catch(e => e)

    // A MENSAGEM É O REMÉDIO, e por isso ela é testada por partes: quem a lê
    // precisa dos DOIS textos lado a lado para enxergar a diferença, e do lugar
    // onde se conserta. Uma mensagem genérica ("área não encontrada") mandaria
    // abrir chamado.
    expect(erro.message).toContain(`"${NOME}"`)
    expect(erro.message).toContain('"1o Centro de Geoinformacao"')
    expect(erro.message).toContain('PUT /api/instituicao')
    expect(erro.statusCode).toBe(500)
  })

  test('tabela de áreas VAZIA também dói, e diz que falta a carga', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(SEMENTE)
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    mockDb.conn.any.mockResolvedValueOnce([])

    const erro = await ctrl.areaDoCentro().catch(e => e)

    expect(erro.message).toContain('limites.area_suprimento')
    expect(erro.message).toContain('vazia')
  })

  test('instalação SEM instituição configurada dá erro antes de olhar a área', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    const erro = await ctrl.areaDoCentro().catch(e => e)

    expect(erro.message).toContain('PUT /api/instituicao')
    // A segunda leitura NÃO acontece: sem nome não há o que procurar, e uma
    // consulta com `undefined` no parâmetro casaria com nada e pareceria a
    // mesma falha por outro motivo.
    expect(mockDb.conn.oneOrNone).toHaveBeenCalledTimes(1)
  })
})
