'use strict'

// A CONFERÊNCIA DE UMA EDIÇÃO FECHADA COMPARA O QUE ERA COMPARÁVEL.
//
// `conferirHoje` põe o congelado ao lado do que o banco diria hoje, e é o
// contrapeso do congelamento: um pedido de março corrigido em agosto não muda a
// edição de março, e a divergência ficaria invisível sem ele.
//
// O QUE ELE ERRAVA. Ele percorria `estrutura.NUMEROS_CALCULADOS`, que é a lista
// de HOJE, e comparava sem olhar a origem da linha CONGELADA. A lista muda: a
// 2.2 e a 2.4 viraram calculadas em 2026-08-05, a 2.5 e a 7.1 em 2026-08-08, e
// cada uma delas era DIGITADA nas edições fechadas antes disso. O efeito era uma
// divergência permanente numa edição em que ninguém mexeu: o texto que o gestor
// escreveu à mão em junho comparado com uma tabela que o gerador só passou a
// produzir em agosto. `montar` já seguia a regra certa ("a edição FECHADA se
// desenha com a estrutura QUE ELA TEVE"); aqui ela faltava.
//
// O QUE ESTE ARQUIVO NÃO COBRE, e o controlador diz por quê: a calculada que
// SAIU da estrutura (a 7.3, fundida na 7.2 em 2026-08-08) continua fora da
// comparação, porque não há gerador com que compará-la.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const edicaoCtrl = require('../../rpcmtec/rpcmtec_edicao_ctrl')
const rpcmtecCtrl = require('../../rpcmtec/rpcmtec_ctrl')
const estrutura = require('../../rpcmtec/rpcmtec_estrutura')

const FECHADA = {
  id: 7,
  ano: 2026,
  mes: 6,
  fechada: true,
  data_fechamento: '2026-07-02T13:00:00Z'
}

// A 2.2 é o caso real: DIGITADA até 2026-08-05, CALCULADA desde então.
const congelada = origemId => ({
  numero: '2.2',
  ordem: 5,
  secao_titulo: 'Seção 2',
  titulo: 'Totais de produção',
  origem_id: origemId,
  origem: origemId === estrutura.ORIGEM.CALCULADA ? 'Calculada' : 'Digitada',
  cabecalhos: ['Item', 'Qtd'],
  linhas: [['Carta topográfica', '4']],
  texto: null,
  sem_ocorrencia: false
})

// O que o gerador de HOJE diria da 2.2, e ele diz outra coisa: é justamente
// isso que a comparação existe para mostrar quando ela cabe.
const HOJE = { '2.2': [['Carta topográfica', '9']] }

const conferir = async origemId => {
  jest.spyOn(edicaoCtrl, 'getPorId').mockResolvedValue(FECHADA)
  jest.spyOn(rpcmtecCtrl, 'calcular').mockResolvedValue(HOJE)
  mockDb.conn.any.mockResolvedValueOnce([congelada(origemId)])
  return edicaoCtrl.conferirHoje(7)
}

describe('conferirHoje compara pela origem CONGELADA, e não pela lista de hoje', () => {
  beforeEach(() => mockDb.reset())
  afterEach(() => jest.restoreAllMocks())

  test('a 2.2 congelada como DIGITADA fica fora da comparação', async () => {
    // Ela não tinha gerador quando a edição fechou. Acusá-la hoje seria dizer
    // que o número mudou, quando o que mudou foi quem o produz.
    const saida = await conferir(estrutura.ORIGEM.DIGITADA)

    expect(saida.divergentes).not.toContain('2.2')
    expect(saida.subsecoes.map(s => s.numero)).not.toContain('2.2')
  })

  test('a 2.2 congelada como CALCULADA continua sendo comparada, e acusa', async () => {
    // A outra metade da régua: sem ela, a correção acima teria calado a
    // comparação inteira e ninguém veria diferença nenhuma.
    const saida = await conferir(estrutura.ORIGEM.CALCULADA)

    expect(saida.divergentes).toContain('2.2')
    const linha = saida.subsecoes.find(s => s.numero === '2.2')
    expect(linha.congelado).toEqual([['Carta topográfica', '4']])
    expect(linha.hoje).toEqual([['Carta topográfica', '9']])
  })

  test('a edição ABERTA não se confere', async () => {
    // Numa aberta o calculado JÁ sai do banco a cada leitura: não há congelado
    // com que comparar, e a tela mostraria duas vezes o mesmo número.
    jest.spyOn(edicaoCtrl, 'getPorId').mockResolvedValue({ ...FECHADA, fechada: false })

    await expect(edicaoCtrl.conferirHoje(7)).rejects.toMatchObject({ statusCode: 400 })
  })
})
