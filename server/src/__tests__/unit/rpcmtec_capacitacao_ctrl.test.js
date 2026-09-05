'use strict'

// Duas correções do cadastro de capacitação, com o banco mockado.
//
// AS DUAS SUJAVAM DOCUMENTO ASSINADO, e nenhuma dava erro.
//
//  1. O VÍNCULO COM A META DO PIT. O formulário da tela não manda
//     `meta_pit_id`, e o UPDATE escrevia a coluna inteira a cada salvamento:
//     toda edição apagava o vínculo em silêncio. O número que sumia alimenta o
//     cálculo de `pit_execucao_ctrl`, então a meta 5 do PIT perdia execução
//     porque alguém corrigiu o nome do curso.
//
//     A chave AUSENTE e o `null` EXPLÍCITO são coisas diferentes: a primeira
//     preserva, o segundo desliga. O teste cobre as duas.
//
//  2. A CAPACITAÇÃO CANCELADA. A listagem do mês filtrava tipo e datas, e não
//     situação: o que a Divisão cancelou entrava nas subseções 2.6 e 6.2 do
//     RPCMTec como atividade do mês.
//
//  3. A LISTA DE MILITARES, pela MESMA distinção do item 1. `militares` tinha
//     `.default([])` no schema, e o default injetava a chave: "ausente" nunca
//     chegava ao controlador, e `gravarMilitares` (DELETE mais INSERT) apagava a
//     lista inteira. Quem corrigisse pelo CLI o nome de uma capacitação, mandando
//     o corpo sem `militares`, perdia os oito instrutores dela -- com um evento
//     de auditoria dizendo que a lista mudou. A tela web sempre manda a lista, e
//     por isso nunca caiu nisso.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../rpcmtec/rpcmtec_capacitacao_ctrl')

// A linha que `auditoriaCtrl.lerAntes` devolve no início do `atualizar`. É dela
// que sai o valor preservado, e por isso ela traz o vínculo gravado.
const linhaGravada = (extra = {}) => ({
  id: 5,
  ano: 2026,
  nome: 'Curso de Geoinformação',
  tipo_id: 1,
  situacao_id: 3,
  meta_pit_id: 7,
  ...extra
})

// O corpo que a tela manda hoje: sem `meta_pit_id`, porque o formulário não tem
// o campo, e SEM `tipo_id`, porque desde a 1.33.0 quem fixa o tipo é a ROTA.
const corpoDaTela = (extra = {}) => ({
  ano: 2026,
  nome: 'Curso de Geoinformação',
  situacao_id: 3,
  militares: [],
  ...extra
})

// O tipo que a ROTA passa. `MINISTRADA`, que é o da linha gravada acima: as
// funções recusam o id de tipo diferente, e isso tem teste próprio em
// routes/capacitacao_permissao.test.js.
const MINISTRADA = 1

// O objeto de parâmetros do UPDATE da capacitação, entre as chamadas de `one`.
const paramsDoUpdate = () => {
  const chamada = mockDb.conn.one.mock.calls.find(
    ([sql]) => typeof sql === 'string' && sql.includes('UPDATE rpcmtec.capacitacao')
  )
  return chamada ? chamada[1] : null
}

const prepararAtualizar = (antes = linhaGravada()) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce(antes)
  mockDb.conn.one.mockResolvedValueOnce({ ...antes })
}

describe('rpcmtec_capacitacao_ctrl: o vínculo com a meta do PIT', () => {
  beforeEach(() => mockDb.reset())

  test('atualizar SEM a chave meta_pit_id preserva o vínculo gravado', async () => {
    prepararAtualizar(linhaGravada({ meta_pit_id: 7 }))

    await ctrl.atualizar(5, MINISTRADA, corpoDaTela(), 'uuid-1')

    expect(paramsDoUpdate()).toEqual(
      expect.objectContaining({ metaPitId: 7 })
    )
  })

  test('atualizar com meta_pit_id NULO explícito desliga o vínculo', async () => {
    prepararAtualizar(linhaGravada({ meta_pit_id: 7 }))

    await ctrl.atualizar(5, MINISTRADA, corpoDaTela({ meta_pit_id: null }), 'uuid-1')

    expect(paramsDoUpdate()).toEqual(
      expect.objectContaining({ metaPitId: null })
    )
  })

  test('atualizar com meta_pit_id NOVO troca o vínculo', async () => {
    prepararAtualizar(linhaGravada({ meta_pit_id: 7 }))

    await ctrl.atualizar(5, MINISTRADA, corpoDaTela({ meta_pit_id: 9 }), 'uuid-1')

    expect(paramsDoUpdate()).toEqual(
      expect.objectContaining({ metaPitId: 9 })
    )
  })

  // A preservação é só do UPDATE. No INSERT não há valor anterior, e a ausência
  // continua nascendo nula.
  test('criar sem meta_pit_id grava nulo', async () => {
    mockDb.conn.one.mockResolvedValueOnce({ id: 11, ano: 2026 })

    await ctrl.criar(corpoDaTela(), MINISTRADA, 'uuid-1')

    const chamada = mockDb.conn.one.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO rpcmtec.capacitacao')
    )
    expect(chamada[1]).toEqual(expect.objectContaining({ metaPitId: null }))
  })
})

describe('rpcmtec_capacitacao_ctrl: a lista de militares', () => {
  beforeEach(() => mockDb.reset())

  /** O DELETE que abre o `gravarMilitares`: se ele não veio, a lista foi preservada. */
  const apagouOsMilitares = () =>
    mockDb.conn.none.mock.calls.some(
      ([sql]) => typeof sql === 'string' &&
        sql.includes('DELETE FROM rpcmtec.capacitacao_militar')
    )

  test('atualizar SEM a chave militares preserva a lista', async () => {
    // O caso do CLI: corrigir o nome do curso não pode desfazer o cadastro de
    // quem o ministrou. Antes de 2026-09-05 este caso apagava a lista.
    prepararAtualizar()

    await ctrl.atualizar(5, MINISTRADA, corpoDaTela({ militares: undefined }), 'uuid-1')

    expect(apagouOsMilitares()).toBe(false)
  })

  test('atualizar com a lista VAZIA apaga: é "tirei todo mundo"', async () => {
    // A outra metade da distinção. Sem este caso, a correção acima poderia ter
    // fechado a única porta que existe para esvaziar a lista.
    prepararAtualizar()

    await ctrl.atualizar(5, MINISTRADA, corpoDaTela({ militares: [] }), 'uuid-1')

    expect(apagouOsMilitares()).toBe(true)
  })

  test('atualizar com lista NOVA regrava', async () => {
    prepararAtualizar()
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

    await ctrl.atualizar(5, MINISTRADA, corpoDaTela({ militares: [uuid] }), 'uuid-1')

    expect(apagouOsMilitares()).toBe(true)
    // O INSERT em lote sai por `db.pgp.helpers.insert`, que monta a string
    // inteira: o uuid viaja NO SQL, e não em parâmetro nomeado. E o helper
    // escreve `insert into` em minúsculas, ao contrário do SQL desta casa.
    const inserido = mockDb.conn.none.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('"rpcmtec"."capacitacao_militar"'))
    expect(inserido).toContain(uuid)
  })
})

describe('rpcmtec_capacitacao_ctrl: a listagem do mês do RPCMTec', () => {
  beforeEach(() => mockDb.reset())

  // Os códigos são de `dominio.situacao_capacitacao` (er/dominio.sql:377-381):
  // 1 Prevista, 2 Em execução, 3 Concluída, 4 Cancelada.
  const CANCELADA = 4

  test('listarDoMes exclui a situação CANCELADA', async () => {
    await ctrl.listarDoMes(2026, 7, 1)

    const [sql, params] = mockDb.conn.any.mock.calls[0]
    expect(sql).toContain('c.situacao_id <> $<cancelada>')
    expect(params).toEqual(expect.objectContaining({ cancelada: CANCELADA }))
  })

  test('listarDoMes NÃO exige situação: a Prevista entra na 2.6', async () => {
    await ctrl.listarDoMes(2026, 7, 1)

    // A 2.6 descreve o que a Divisão planejou para o mês.
    // Um filtro de igualdade aqui deixaria de fora a Prevista e a Em execução.
    const [sql] = mockDb.conn.any.mock.calls[0]
    expect(sql).not.toMatch(/situacao_id\s*=/)
    expect(sql).not.toMatch(/situacao_id\s+IN/i)
  })

  test('listarDoMes mantém o recorte de tipo e de período', async () => {
    await ctrl.listarDoMes(2026, 7, 2)

    const [sql, params] = mockDb.conn.any.mock.calls[0]
    expect(sql).toContain('c.tipo_id = $<tipoId>')
    expect(params).toEqual(
      expect.objectContaining({
        tipoId: 2,
        inicioDoMes: '2026-07-01',
        fimDoMes: '2026-07-31'
      })
    )
  })
})
