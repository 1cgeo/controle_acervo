'use strict'

// A MARCA DE CONFERENCIA por subsecao, e a impressao digital que a mantem
// honesta.
//
// O que estes casos fixam:
//
// 1. A marca vale para as TRES origens. Calculada, digitada e fixa: quem confere
//    o relatorio antes de assinar percorre os 33 blocos, e a calculada e
//    justamente a que mais precisa de olho (o numero pode estar certo e o
//    cadastro que o alimenta, errado).
// 2. A marca MORRE quando o conteudo muda. Nao literalmente: ela continua la,
//    com quem e quando, e passa a sair `desatualizada`. Marca que sobrevive
//    calada a uma mudanca de conteudo afirma conferencia que nao houve, e e pior
//    que marca nenhuma.
// 3. O fechamento AVISA e deixa fechar.
//
// A IMPRESSAO NAO E RECALCULADA AQUI DE PROPOSITO. O teste nao conhece o
// algoritmo: ele pega o valor que o `revisar` MANDOU para o banco e o devolve
// pela leitura, como o banco faria. Assim o caso prova que as duas pontas
// concordam, em vez de provar que o teste sabe copiar um `sha256`.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

// A INSTITUICAO NAO E O ASSUNTO DESTE ARQUIVO, e `montar` a le desde 2026-08-09
// para o nome do Centro entrar na 1.1, na capa e no rodape. Vai dublada para
// nao virar uma consulta a mais em cada encenacao, e o valor e a SEMENTE de
// `er/dgeo.sql` -- e nao uma constante do sistema. Que o documento ACOMPANHA
// outra instituicao e o que `routes/rpcmtec.test.js` prova, contra o banco.
jest.mock('../../instituicao/instituicao_ctrl', () => ({
  paraDocumento: jest.fn(async () => ({
    id: 1,
    nome: '1º Centro de Geoinformação',
    sigla: '1º CGEO',
    sigla_slug: '1CGEO'
  }))
}))

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

const REVISOR = {
  numero: '2.6',
  data_revisao: new Date('2026-08-06T14:32:00Z'),
  nome_guerra: 'Fulano',
  nome: 'Fulano de Tal',
  posto: 'Cap'
}

// O gerador com uma linha em cada calculada. `conteudoDe` troca o que UMA delas
// devolve, que e como o mundo real muda uma subsecao calculada: alguem cadastra
// uma versao nova.
const doGerador = (conteudoDe = {}) => {
  const mapa = {}
  for (const numero of estrutura.NUMEROS_CALCULADOS) {
    mapa[numero] = conteudoDe[numero] || [['uma linha']]
  }
  return mapa
}

/**
 * Monta o documento de uma edicao aberta.
 *
 * As DUAS consultas de `montar` na ordem em que ele as faz: as subsecoes
 * gravadas e as marcas de conferencia.
 */
const montarAberta = async ({ conteudo = {}, marcas = [] } = {}) => {
  rpcmtecCtrl.calcular.mockResolvedValueOnce(doGerador(conteudo))
  mockDb.conn.oneOrNone.mockResolvedValueOnce(edicaoAberta)
  mockDb.conn.any.mockResolvedValueOnce([])
  mockDb.conn.any.mockResolvedValueOnce(marcas)
  return ctrl.montar(1)
}

const acharBloco = (documento, numero) =>
  documento.secoes.flatMap(s => s.subsecoes).find(b => b.numero === numero)

/** A impressao que o `revisar` gravaria para uma subsecao, com dado conteudo. */
const impressaoGravada = async (numero, conteudo = {}) => {
  rpcmtecCtrl.calcular.mockResolvedValueOnce(doGerador(conteudo))
  mockDb.conn.oneOrNone.mockResolvedValueOnce(edicaoAberta)
  mockDb.conn.any.mockResolvedValueOnce([])
  mockDb.conn.any.mockResolvedValueOnce([])
  // A releitura TRAVADA da edicao, dentro da transacao do `revisar`: o `montar`
  // acima roda fora dela, e entre os dois cabe um fechamento inteiro. Ver
  // `unit/rpcmtec_edicao_fechada.test.js`, quarto describe.
  mockDb.conn.oneOrNone.mockResolvedValueOnce(edicaoAberta)
  mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
  mockDb.conn.one.mockResolvedValueOnce({
    id: 7, edicao_id: 1, numero, impressao: 'x', data_revisao: new Date(), usuario_uuid: 'u'
  })

  await ctrl.revisar(1, numero, true, 'uuid-quem-confere', {})

  const chamada = mockDb.conn.one.mock.calls.find(
    c => c[1] && c[1].impressao !== undefined
  )
  return chamada[1].impressao
}

describe('a marca de conferencia no documento montado', () => {
  beforeEach(() => {
    mockDb.reset()
    rpcmtecCtrl.calcular.mockReset()
  })

  test('sem marca, a subsecao sai sem revisao e entra em porRevisar', async () => {
    const documento = await montarAberta()

    expect(acharBloco(documento, '2.6').revisao).toBeNull()
    expect(documento.porRevisar).toContain('2.6')
    expect(documento.revisaoVencida).toEqual([])
  })

  test('a marca nomeia quem conferiu e quando', async () => {
    const impressao = await impressaoGravada('2.6')
    mockDb.reset()
    rpcmtecCtrl.calcular.mockReset()

    const documento = await montarAberta({
      marcas: [{ ...REVISOR, impressao }]
    })

    const bloco = acharBloco(documento, '2.6')
    expect(bloco.revisao.por).toBe('Cap Fulano')
    expect(bloco.revisao.em).toEqual(REVISOR.data_revisao)
    expect(bloco.revisao.desatualizada).toBe(false)
    expect(documento.porRevisar).not.toContain('2.6')
    expect(documento.revisaoVencida).not.toContain('2.6')
  })

  // O CASO QUE JUSTIFICA A IMPRESSAO DIGITAL. Ninguem tocou na subsecao pela
  // tela: alguem cadastrou uma versao, e a calculada mudou sozinha.
  test('conteudo mudou depois da conferencia: a marca fica DESATUALIZADA', async () => {
    const impressao = await impressaoGravada('2.6')
    mockDb.reset()
    rpcmtecCtrl.calcular.mockReset()

    const documento = await montarAberta({
      conteudo: { '2.6': [['uma linha'], ['linha que apareceu depois']] },
      marcas: [{ ...REVISOR, impressao }]
    })

    const bloco = acharBloco(documento, '2.6')
    // A marca NAO some: quem conferiu e quando continuam sendo fato.
    expect(bloco.revisao.por).toBe('Cap Fulano')
    expect(bloco.revisao.desatualizada).toBe(true)
    expect(documento.revisaoVencida).toContain('2.6')
    // E ela NAO conta como "nunca conferida": sao pendencias diferentes, com
    // consertos diferentes (dar o primeiro olhar x dar o segundo).
    expect(documento.porRevisar).not.toContain('2.6')
  })

  // VARIANCIA da impressao: ela tem de mudar com o CONTEUDO e so com ele.
  test('a impressao muda quando o conteudo muda', async () => {
    const antes = await impressaoGravada('2.6')
    mockDb.reset()
    rpcmtecCtrl.calcular.mockReset()
    const depois = await impressaoGravada('2.6', { '2.6': [['outra coisa']] })

    expect(depois).not.toBe(antes)
  })

  test('a impressao NAO muda quando so outra subsecao muda', async () => {
    const antes = await impressaoGravada('2.6')
    mockDb.reset()
    rpcmtecCtrl.calcular.mockReset()
    // Mexe na 3.3, e pergunta pela 2.6: conferir a 2.6 nao pode vencer porque o
    // vizinho mudou.
    const depois = await impressaoGravada('2.6', { 3.3: [['mudou aqui']] })

    expect(depois).toBe(antes)
  })

  test('a marca vale para a subsecao DIGITADA tambem', async () => {
    const digitada = estrutura.BLOCOS.find(
      b => b.origem === estrutura.ORIGEM.DIGITADA
    )
    const documento = await montarAberta({
      marcas: [{ ...REVISOR, numero: digitada.numero, impressao: 'nao-bate' }]
    })

    const bloco = acharBloco(documento, digitada.numero)
    expect(bloco.revisao).not.toBeNull()
    expect(bloco.revisao.por).toBe('Cap Fulano')
  })
})

describe('o fechamento diante da conferencia que falta', () => {
  beforeEach(() => {
    mockDb.reset()
    rpcmtecCtrl.calcular.mockReset()
  })

  // As subsecoes DIGITADAS precisam estar preenchidas para o fechamento chegar
  // na conferencia: o buraco de conteudo e recusado antes, e por outro motivo.
  const gravadasCompletas = () => estrutura.BLOCOS
    .filter(b => b.origem === estrutura.ORIGEM.DIGITADA)
    .map(b => ({
      numero: b.numero,
      ordem: b.ordem,
      secao_titulo: b.secaoTitulo,
      titulo: b.titulo,
      origem_id: b.origem,
      origem: 'Digitada',
      cabecalhos: b.cabecalhos || null,
      linhas: b.cabecalhos ? [['x']] : null,
      texto: b.cabecalhos ? null : 'algo',
      sem_ocorrencia: false
    }))

  const prepararFechamento = (marcas = []) => {
    rpcmtecCtrl.calcular.mockResolvedValueOnce(doGerador())
    mockDb.conn.oneOrNone.mockResolvedValueOnce(edicaoAberta)
    mockDb.conn.any.mockResolvedValueOnce(gravadasCompletas())
    mockDb.conn.any.mockResolvedValueOnce(marcas)
  }

  test('sem confirmacao, o fechamento RECUSA com 409 e lista o que falta', async () => {
    prepararFechamento()

    await expect(ctrl.fechar(1, 'uuid-quem-fecha', {}))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  test('a recusa nomeia as subsecoes, e nao so o total', async () => {
    prepararFechamento()

    // Quem le "faltam 34" nao sabe por onde comecar.
    await expect(ctrl.fechar(1, 'uuid-quem-fecha', {}))
      .rejects.toThrow(/2\.6/)
  })

  // A CONFIRMACAO PASSA. Aqui so se prova que a conferencia deixou de barrar: o
  // fechamento segue para o UPDATE, que este teste nao encena.
  test('com ciente_revisao, a conferencia nao barra mais', async () => {
    prepararFechamento()

    let erro = null
    try {
      await ctrl.fechar(1, 'uuid-quem-fecha', {}, true)
    } catch (e) {
      erro = e
    }

    // Passou da porteira da conferencia: se parar, para por outro motivo.
    if (erro) expect(erro.statusCode).not.toBe(409)
  })
})
