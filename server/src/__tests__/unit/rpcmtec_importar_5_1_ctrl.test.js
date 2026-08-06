'use strict'

// A IMPORTACAO do CSV do github_dashboard na subsecao 5.1, com o banco mockado.
//
// O modulo que LE o CSV tem teste proprio (rpcmtec_csv_repositorios.test.js). O
// que se cobra aqui e o que so o controlador faz:
//
//   1. O QUE VAI PARA O BANCO. As tres primeiras colunas se refazem pelo CSV e o
//      Resumo vem do que ja estava gravado. E a matriz do INSERT que prova isso,
//      e nao o valor de retorno;
//   2. A TRAVA DA REMOCAO. Quando a importacao removeria um repositorio que ja
//      tem Resumo escrito, a rota responde 409 e NAO GRAVA NADA. So com
//      `confirmar_remocao` ela passa. A trava mora aqui, e nao na tela, porque
//      ela vale tambem para o `producao_cli`;
//   3. O CSV RUIM NAO ENCOSTA NO BANCO. A recusa vem antes da transacao;
//   4. A EDICAO FECHADA recusa, como toda escrita desta feature;
//   5. O RASTRO. O evento leva a linha ANTERIOR inteira, que e o unico lugar
//      onde o Resumo de um repositorio removido sobrevive.
//
// LIMITE CONHECIDO deste arquivo, e ele e o mesmo do mockDb: `conn.tx` roda o
// callback com o proprio `conn`, entao ATOMICIDADE nao se prova aqui. Quem a
// prova e a suite de banco.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../rpcmtec/rpcmtec_subsecao_ctrl')

const USUARIO = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const CONTEXTO = { rota: 'POST /api/rpcmtec/7/subsecao/5.1/importar' }

const CSV = [
  'Repositório,Número de commits,Efetivo',
  'controle_acervo,42,Cap Fulano;Maj Beltrano',
  'DsgTools,17,Ten Sicrano'
].join('\n')

/**
 * Prepara as duas leituras que o controlador faz, na ordem em que ele as faz.
 *
 * O mock casa pelo SQL, e nao por `mockResolvedValueOnce` em fila: uma consulta
 * a mais no meio do caminho embaralharia a fila e o teste passaria a provar
 * outra coisa.
 */
const prepararBanco = ({ fechada = false, linhas = null } = {}) => {
  mockDb.reset()

  const gravada = linhas === null
    ? null
    : { id: 88, edicao_id: 7, numero: '5.1', linhas, texto: null, sem_ocorrencia: false }

  mockDb.conn.oneOrNone.mockImplementation(async (sql) => {
    if (sql.includes('FROM rpcmtec.edicao')) {
      return { id: 7, ano: 2026, mes: 8, data_fechamento: fechada ? '2026-08-31' : null }
    }
    if (sql.includes('FROM rpcmtec.subsecao')) return gravada
    return null
  })

  mockDb.conn.one.mockImplementation(async (sql, params) => {
    if (sql.includes('INSERT INTO rpcmtec.subsecao')) {
      return {
        id: 88,
        edicao_id: 7,
        numero: '5.1',
        linhas: JSON.parse(params.linhas),
        texto: null,
        sem_ocorrencia: false
      }
    }
    return {}
  })

  return gravada
}

/** A matriz que o INSERT gravou, ja de volta em objeto. */
const linhasGravadas = () => {
  const chamada = mockDb.conn.one.mock.calls.find(
    ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO rpcmtec.subsecao')
  )
  return chamada ? JSON.parse(chamada[1].linhas) : null
}

const gravou = () => linhasGravadas() !== null

const importar = (dados) =>
  ctrl.importarRepositorios(7, dados, USUARIO, CONTEXTO)

const eventos = () =>
  mockDb.conn.none.mock.calls
    .filter(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auditoria.evento'))
    .map(([, params]) => params)

describe('importarRepositorios: o que vai para o banco', () => {
  test('a primeira importação grava as três colunas e o Resumo vazio', async () => {
    prepararBanco({ linhas: null })

    const r = await importar({ csv: CSV })

    expect(linhasGravadas()).toEqual([
      ['controle_acervo', '42', 'Cap Fulano;Maj Beltrano', ''],
      ['DsgTools', '17', 'Ten Sicrano', '']
    ])
    expect(r.total).toBe(2)
    expect(r.novos).toEqual(['controle_acervo', 'DsgTools'])
    expect(r.resumos_preservados).toBe(0)
  })

  test('A REIMPORTAÇÃO PRESERVA O RESUMO, e refaz commits e efetivo', async () => {
    // O requisito da feature, provado no INSERT e não no retorno.
    prepararBanco({
      linhas: [
        ['controle_acervo', '10', 'Cap Fulano', 'Subiu o módulo Efetivo.'],
        ['DsgTools', '4', 'Ten Sicrano', '']
      ]
    })

    const r = await importar({ csv: CSV })

    expect(linhasGravadas()).toEqual([
      ['controle_acervo', '42', 'Cap Fulano;Maj Beltrano', 'Subiu o módulo Efetivo.'],
      ['DsgTools', '17', 'Ten Sicrano', '']
    ])
    // VARIÂNCIA: os commits mudaram DE VERDADE. Sem esta asserção, um
    // controlador que não gravasse nada passaria no caso do Resumo.
    expect(linhasGravadas()[0][1]).toBe('42')
    expect(r.resumos_preservados).toBe(1)
    expect(r.atualizados).toEqual(['controle_acervo', 'DsgTools'])
  })

  test('a importação DESMARCA "sem ocorrência no mês"', async () => {
    // A tabela passa a ter conteúdo, e o CHECK do banco recusa as duas juntas.
    prepararBanco({ linhas: [] })

    await importar({ csv: CSV })

    const chamada = mockDb.conn.one.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO rpcmtec.subsecao')
    )
    expect(chamada[1].semOcorrencia).toBe(false)
    expect(chamada[1].numero).toBe('5.1')
  })
})

describe('importarRepositorios: a trava da remoção', () => {
  const COM_RESUMO_QUE_SOME = [
    ['controle_acervo', '10', 'Cap Fulano', 'Subiu o módulo Efetivo.'],
    ['DsgTools', '4', 'Ten Sicrano', ''],
    ['aholo', '3', 'Maj Beltrano', 'Tour virtual do museu.']
  ]

  test('sem confirmação, responde 409 NOMEANDO quem perde o Resumo', async () => {
    prepararBanco({ linhas: COM_RESUMO_QUE_SOME })

    await expect(importar({ csv: CSV })).rejects.toMatchObject({
      statusCode: 409
    })

    try {
      await importar({ csv: CSV })
    } catch (e) {
      expect(e.message).toContain('aholo')
      // O que NÃO tem Resumo não entra na pergunta: perguntar por ele treinaria
      // quem lê a clicar sem ler.
      expect(e.message).not.toContain('DsgTools')
    }
  })

  test('e NÃO GRAVA NADA', async () => {
    // O caso que faz a trava valer. Sem ele, um 409 lançado DEPOIS do INSERT
    // passaria no caso acima e teria destruído o Resumo assim mesmo.
    prepararBanco({ linhas: COM_RESUMO_QUE_SOME })

    await expect(importar({ csv: CSV })).rejects.toThrow()

    expect(gravou()).toBe(false)
    expect(eventos()).toHaveLength(0)
  })

  test('com confirmar_remocao, passa e relata quem saiu', async () => {
    prepararBanco({ linhas: COM_RESUMO_QUE_SOME })

    const r = await importar({ csv: CSV, confirmar_remocao: true })

    expect(linhasGravadas().map(l => l[0])).toEqual(['controle_acervo', 'DsgTools'])
    expect(r.removidos).toEqual([{ repositorio: 'aholo', tinha_resumo: true }])
    // O TEXTO do Resumo removido não volta na resposta: a confirmação já o
    // citou pelo nome do repositório.
    expect(JSON.stringify(r)).not.toContain('Tour virtual')
  })

  test('remover quem NÃO tem Resumo não pede confirmação nenhuma', async () => {
    // VARIÂNCIA da trava: ela dispara pelo Resumo escrito, e não por remover.
    prepararBanco({
      linhas: [
        ['controle_acervo', '10', 'Cap Fulano', ''],
        ['aholo', '3', 'Maj Beltrano', '']
      ]
    })

    const r = await importar({ csv: CSV })

    expect(gravou()).toBe(true)
    expect(r.removidos).toEqual([{ repositorio: 'aholo', tinha_resumo: false }])
  })
})

describe('importarRepositorios: o que ele recusa antes do banco', () => {
  test('CSV ruim vira 400 com a frase que ensina, e não encosta na tabela', async () => {
    prepararBanco({ linhas: [] })

    await expect(importar({ csv: 'lixo,sem,cabecalho\n1,2,3' }))
      .rejects.toMatchObject({ statusCode: 400 })

    expect(gravou()).toBe(false)
    // Nem a edição chegou a ser lida: a recusa vem antes da transação.
    expect(mockDb.conn.oneOrNone).not.toHaveBeenCalled()
  })

  test('CSV vazio também', async () => {
    prepararBanco({ linhas: [] })

    await expect(importar({ csv: '' })).rejects.toMatchObject({ statusCode: 400 })
    expect(gravou()).toBe(false)
  })

  test('edição FECHADA recusa, como toda escrita desta feature', async () => {
    prepararBanco({ fechada: true, linhas: [] })

    await expect(importar({ csv: CSV })).rejects.toThrow(/fechada/i)
    expect(gravou()).toBe(false)
  })
})

describe('importarRepositorios: o rastro', () => {
  test('grava o evento com a linha ANTERIOR inteira', async () => {
    // O evento é o único lugar onde o Resumo de um repositório removido
    // sobrevive: sem ele, "o que estava escrito na aholo" não teria resposta.
    prepararBanco({
      linhas: [['aholo', '3', 'Maj Beltrano', 'Tour virtual do museu.']]
    })

    await importar({ csv: CSV, confirmar_remocao: true })

    const [evento] = eventos()
    expect(evento).toBeDefined()
    expect(evento.tabela).toBe('rpcmtec.subsecao')
    expect(evento.operacao).toBe('U')
    expect(evento.usuarioUuid).toBe(USUARIO)
    expect(JSON.stringify(evento)).toContain('Tour virtual do museu.')
  })

  test('a subseção que ainda não existia entra como INSERÇÃO', async () => {
    prepararBanco({ linhas: null })

    await importar({ csv: CSV })

    expect(eventos()[0].operacao).toBe('I')
  })
})
