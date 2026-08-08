'use strict'

// A LACUNA DA SUBSEÇÃO CALCULADA, no documento montado e no fechamento.
//
// O defeito: toda subseção calculada saía com `preenchida: true`, mesmo com
// zero linhas. Sem passagem de efetivo cadastrada, a 6.1 saía como tabela vazia
// e a edição fechava sem apontar nada. O documento assinado afirmava "não
// houve" onde o certo era "ninguém cadastrou".
//
// O CONTRATO NÃO MUDA DE SENTIDO. `preenchida` continua sendo a pergunta do
// gestor ("alguém visitou esta subseção?"), e só a DIGITADA a responde: uma
// calculada não se preenche à mão, e marcá-la pendente travaria o fechamento
// sem saída nenhuma. A lacuna sai em campo NOVO (`semLinhas`) e numa lista nova
// (`lacunasCalculadas`), ao lado do `semGerador` que já existia.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

// O gerador inteiro fica de fora: aqui se testa o que a MONTAGEM faz com o que
// ele devolve, e o `calcular` de verdade cruza vinte consultas (a vigésima é a
// 7.1, calculada desde 2026-08-08).
jest.mock('../../rpcmtec/rpcmtec_ctrl', () => ({ calcular: jest.fn() }))

const rpcmtecCtrl = require('../../rpcmtec/rpcmtec_ctrl')
const estrutura = require('../../rpcmtec/rpcmtec_estrutura')
const ctrl = require('../../rpcmtec/rpcmtec_edicao_ctrl')

const edicaoAberta = {
  id: 1,
  ano: 2026,
  mes: 7,
  assinante_uuid: 'uuid-assinante',
  data_fechamento: null,
  fechada: false
}

/**
 * O retorno do gerador, com uma linha em cada subseção calculada.
 *
 * `vazias` devolve tabela sem linha (o gerador rodou e não achou nada);
 * `semGerador` omite a chave (a estrutura declara a subseção e ninguém a
 * produz). São as duas lacunas, por causas diferentes.
 */
const doGerador = ({ vazias = [], semGerador = [] } = {}) => {
  const mapa = {}
  for (const numero of estrutura.NUMEROS_CALCULADOS) {
    if (semGerador.includes(numero)) continue
    mapa[numero] = vazias.includes(numero) ? [] : [['uma linha']]
  }
  return mapa
}

const montarAberta = async (opcoes) => {
  rpcmtecCtrl.calcular.mockResolvedValueOnce(doGerador(opcoes))
  mockDb.conn.oneOrNone.mockResolvedValueOnce(edicaoAberta)
  // DUAS consultas, nesta ordem: as subsecoes gravadas e as marcas de
  // conferencia (`rpcmtec.subsecao_revisao`, 1.36.0). Sem a segunda, `montar`
  // recebe `undefined` no lugar da lista e quebra ao indexa-la.
  mockDb.conn.any.mockResolvedValueOnce([])
  mockDb.conn.any.mockResolvedValueOnce([])
  return ctrl.montar(1)
}

const acharBloco = (documento, numero) =>
  documento.secoes.flatMap(s => s.subsecoes).find(b => b.numero === numero)

describe('rpcmtec_edicao_ctrl.montar: a calculada vazia', () => {
  beforeEach(() => {
    mockDb.reset()
    rpcmtecCtrl.calcular.mockReset()
  })

  test('calculada com ZERO linhas é lacuna, e diz por quê', async () => {
    // A 6.1 sai de `dgeo.efetivo_periodo`: sem passagem cadastrada, o gerador
    // devolve tabela vazia.
    const documento = await montarAberta({ vazias: ['6.1'] })

    const seisUm = acharBloco(documento, '6.1')
    expect(seisUm.semLinhas).toBe(true)
    expect(seisUm.semGerador).toBe(false)
    expect(documento.lacunasCalculadas).toEqual(['6.1'])
  })

  test('calculada COM linha não é lacuna', async () => {
    const documento = await montarAberta({ vazias: ['6.1'] })

    const doisSeis = acharBloco(documento, '2.6')
    expect(doisSeis.semLinhas).toBe(false)
    expect(documento.lacunasCalculadas).not.toContain('2.6')
  })

  test('a lacuna do gerador continua separada da tabela vazia', async () => {
    const documento = await montarAberta({ semGerador: ['4.7'] })

    const quatroSete = acharBloco(documento, '4.7')
    expect(quatroSete.semGerador).toBe(true)
    // Sem gerador não há tabela vazia a reportar: a causa já está dita.
    expect(quatroSete.semLinhas).toBe(false)
    expect(documento.lacunasCalculadas).toEqual(['4.7'])
  })

  // O CONTRATO DA TELA, que tem outro dono. A calculada vazia continua
  // `preenchida` e fora de `pendentes`: o gestor não tem como preenchê-la, e o
  // fechamento recusa por `pendentes`.
  test('a calculada vazia não vira pendência do gestor', async () => {
    const documento = await montarAberta({ vazias: ['6.1'] })

    expect(acharBloco(documento, '6.1').preenchida).toBe(true)
    expect(documento.pendentes).not.toContain('6.1')
  })

  test('sem lacuna nenhuma, a lista sai vazia', async () => {
    const documento = await montarAberta()

    expect(documento.lacunasCalculadas).toEqual([])
  })
})

describe('rpcmtec_edicao_ctrl.fechar: aponta a lacuna ao congelar', () => {
  beforeEach(() => {
    mockDb.reset()
    rpcmtecCtrl.calcular.mockReset()
  })

  afterEach(() => jest.restoreAllMocks())

  test('o fechamento devolve as lacunas calculadas', async () => {
    // O documento montado entra pronto: o que se testa aqui é o que o ATO de
    // fechar devolve a quem chamou.
    jest.spyOn(ctrl, 'montar').mockResolvedValueOnce({
      ...edicaoAberta,
      pendentes: [],
      lacunasCalculadas: ['6.1'],
      // Vazias: o que este arquivo testa e a LACUNA, e nao a conferencia. Com
      // subsecao por conferir, o fechamento pararia antes com 409 (ver
      // rpcmtec_revisao.test.js).
      porRevisar: [],
      revisaoVencida: [],
      secoes: [{
        titulo: '6. RECURSOS HUMANOS',
        subsecoes: [{
          numero: '6.1',
          ordem: 22,
          secaoTitulo: '6. RECURSOS HUMANOS',
          titulo: 'Aproveitamento do efetivo',
          origem: estrutura.ORIGEM.CALCULADA,
          cabecalhos: ['Militar', 'Atividades', 'Aproveitamento'],
          linhas: [],
          semGerador: false,
          semLinhas: true,
          preenchida: true
        }]
      }]
    })

    // Duas leituras por `oneOrNone`, NESTA ordem:
    //   1. o `lerAntes` da auditoria (a edicao como estava);
    //   2. o UPDATE que RECLAMA o fechamento.
    //
    // O UPDATE virou `oneOrNone` porque leva `AND data_fechamento IS NULL`: ele
    // devolve zero linhas quando outro pedido fechou primeiro, e e assim que o
    // TOCTOU se resolve. Antes era `t.one`, que nao tinha como devolver nada.
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, ano: 2026, mes: 7 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 1, ano: 2026, mes: 7, data_fechamento: '2026-08-04T12:00:00Z'
    })

    const resultado = await ctrl.fechar(1, 'uuid-1')

    expect(resultado).toEqual({ id: 1, subsecoes: 1, lacunas: ['6.1'] })
  })

  // O outro lado da guarda, e o que prova que ela e uma guarda: quando o UPDATE
  // condicional nao casa linha nenhuma (outro pedido fechou a edicao entre a
  // conferencia e a gravacao), o fechamento RECUSA em vez de gravar de novo.
  //
  // Sem este caso, o `oneOrNone` acima seria so uma troca de metodo.
  test('recusa quando outro pedido fechou a edicao antes (TOCTOU)', async () => {
    jest.spyOn(ctrl, 'montar').mockResolvedValueOnce({
      ...edicaoAberta,
      pendentes: [],
      lacunasCalculadas: [],
      porRevisar: [],
      revisaoVencida: [],
      secoes: [{
        titulo: '6. RECURSOS HUMANOS',
        subsecoes: [{
          numero: '6.1',
          ordem: 22,
          secaoTitulo: '6. RECURSOS HUMANOS',
          titulo: 'Aproveitamento do efetivo',
          origem: estrutura.ORIGEM.CALCULADA,
          cabecalhos: ['Militar'],
          linhas: [['x']],
          semGerador: false,
          semLinhas: false,
          preenchida: true
        }]
      }]
    })

    // 1. lerAntes acha a edicao; 2. o UPDATE condicional nao casa nada.
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, ano: 2026, mes: 7 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    await expect(ctrl.fechar(1, 'uuid-1')).rejects.toThrow('A edição já está fechada')

    // E nao gravou subsecao nenhuma: a reclamacao vem ANTES do laco de INSERT,
    // entao o perdedor da corrida nem chega a escrever.
    const inserts = mockDb.conn.none.mock.calls
      .filter(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO rpcmtec.subsecao'))
    expect(inserts).toHaveLength(0)
  })
})
