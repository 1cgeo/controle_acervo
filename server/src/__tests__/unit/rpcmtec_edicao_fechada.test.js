'use strict'

// O QUE A EDIÇÃO FECHADA AINDA ACEITA, E O QUE ELA NÃO ACEITA MAIS.
//
// A regra do desenho é uma frase: fechada, o documento é o que foi assinado.
// Quatro portas passavam por baixo dela, e cada caso abaixo tranca uma.
//
//  1. O ANO E O MÊS, pelo diálogo de metadados. `assinante_uuid` e
//     `data_assinatura` continuam editáveis com a edição fechada, e isso é
//     deliberado (o documento se assina DEPOIS de fechado). O par (ano, mes)
//     viajava no mesmo corpo e não é a mesma coisa: ele diz DE QUE MÊS são as 33
//     subseções congeladas, e trocá-lo fazia a edição afirmar agosto com os
//     números de julho. NÃO HÁ VOLTA pela tela -- reabrir apaga o congelado
//     calculado e o recalcula para o mês novo --, e por isso a recusa vale mais
//     que o aviso. A recusa mora no PRÓPRIO UPDATE, e não só no `if`: o
//     `lerAntes` é um SELECT que não trava linha nenhuma, e a troca de período
//     passava por baixo dele no fechamento simultâneo, como no item 2.
//
//  2. A EXCLUSÃO, na corrida com o fechamento. O `if (antes.data_fechamento)`
//     do `deletar` lê de um SELECT que não trava linha nenhuma: entre a
//     conferência e o DELETE cabia um `fechar` inteiro, e a edição ASSINADA
//     sumia com o anexo e as subseções junto (o CASCADE). É o mesmo buraco que
//     o `fechar` e o `reabrir` já fecharam, cada um no seu UPDATE, e o `deletar`
//     ficou para trás.
//
//  3. A GRAVAÇÃO DE SUBSEÇÃO, na mesma corrida. `conferirAlvo` lia a edição sem
//     trava, via `data_fechamento` nula e seguia; o `fechar` congelava os 33
//     blocos; o UPSERT daqui esperava na trava da própria `rpcmtec.subsecao` e
//     então sobrescrevia UMA delas. A edição continuava fechada, dizendo outra
//     coisa.
//
//  4. A MARCA DE CONFERÊNCIA, na mesma corrida. O `revisar` decidia sobre o
//     `montar`, que roda FORA da transação: entre ele e o INSERT cabia um
//     `fechar` inteiro, e a edição já assinada ganhava uma marca carimbada
//     DEPOIS do fechamento, que a tela mostra como "Conferida por Fulano em
//     <hora>" com hora posterior à assinatura. A conferência é o passo ANTES do
//     fechamento, e a marca fora de ordem afirma o contrário.
//
// As quatro são de quem escreve com a edição fechada. O ÚLTIMO describe deste
// arquivo é do lado de dentro, e por isso ficou fora da lista: lá quem passa por
// cima do gravado é o PRÓPRIO fechamento. O banner dele conta a história.
//
// O QUE ESTES CASOS PROVAM, E O QUE NÃO PROVAM. Eles provam o CONTRATO: a recusa
// existe, a consulta pede a trava e a releitura vem depois do carimbo.
// Atomicidade e ordem de trava só a suíte de banco prova, porque aqui `conn.tx`
// roda o callback com o próprio `conn` (ver helpers/orcamento/mockDb.js).

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const edicaoCtrl = require('../../rpcmtec/rpcmtec_edicao_ctrl')
const subsecaoCtrl = require('../../rpcmtec/rpcmtec_subsecao_ctrl')

const USUARIO = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const CONTEXTO = { rota: 'PUT /api/rpcmtec/7' }

const FECHADA = {
  id: 7,
  ano: 2026,
  mes: 7,
  assinante_uuid: USUARIO,
  data_assinatura: '2026-08-01',
  data_fechamento: '2026-08-05T13:00:00Z'
}

const ABERTA = { ...FECHADA, data_fechamento: null }

/** O corpo que a tela manda: ano e mes são obrigatórios no schema. */
const corpo = (extra = {}) => ({
  ano: 2026, mes: 7, assinante_uuid: USUARIO, data_assinatura: '2026-08-01',
  ...extra
})

/** O SQL de todas as chamadas de um mock, para procurar uma cláusula. */
const sqls = fn => fn.mock.calls.map(c => String(c[0]))

/** O UPDATE de metadado da edição, entre as chamadas do mock. */
const updateDaEdicao = () =>
  sqls(mockDb.conn.oneOrNone).find(s => s.includes('UPDATE rpcmtec.edicao SET'))

describe('a edição fechada e o diálogo de metadados', () => {
  beforeEach(() => mockDb.reset())

  test('trocar o MÊS de uma edição fechada é recusado, e a mensagem ensina', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(FECHADA)

    await expect(
      edicaoCtrl.atualizar(7, corpo({ mes: 8 }), USUARIO, CONTEXTO)
    ).rejects.toMatchObject({ statusCode: 400 })

    // Nada foi gravado: a recusa barata vem antes do UPDATE.
    expect(updateDaEdicao()).toBeUndefined()
  })

  test('trocar o ANO de uma edição fechada é recusado pela mesma razão', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(FECHADA)

    await expect(
      edicaoCtrl.atualizar(7, corpo({ ano: 2025 }), USUARIO, CONTEXTO)
    ).rejects.toThrow(/Reabra-a antes/i)
  })

  // A OUTRA METADE DA REGRA, e ela é o motivo de a recusa ser SÓ dos dois
  // campos: o documento é assinado depois de fechado, e é aí que o assinante e a
  // data chegam. Recusar o corpo inteiro fecharia a porta que existe para isso.
  test('o assinante e a data da assinatura continuam editáveis com a edição fechada', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(FECHADA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ...FECHADA, assinante_uuid: null })

    const saida = await edicaoCtrl.atualizar(
      7, corpo({ assinante_uuid: null, data_assinatura: null }), USUARIO, CONTEXTO
    )

    expect(saida).toEqual({ id: 7 })
    expect(updateDaEdicao()).toBeDefined()
  })

  test('na edição ABERTA o mês continua editável', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ...ABERTA, mes: 8 })

    await expect(
      edicaoCtrl.atualizar(7, corpo({ mes: 8 }), USUARIO, CONTEXTO)
    ).resolves.toEqual({ id: 7 })
  })

  // A MESMA CORRIDA DO `deletar`, no `atualizar`. O `if` acima decide sobre o
  // `lerAntes`, que é um SELECT sem trava: quem conferiu a edição aberta e foi
  // gravar podia encontrá-la fechada no caminho.
  test('o UPDATE carrega a condição, e não confia no SELECT', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ...ABERTA, mes: 8 })

    await edicaoCtrl.atualizar(7, corpo({ mes: 8 }), USUARIO, CONTEXTO)

    // Fechada, só passa quem NÃO mexe no par (ano, mes).
    expect(updateDaEdicao()).toMatch(
      /data_fechamento IS NULL OR \(ano = \$<ano> AND mes = \$<mes>\)/
    )
  })

  test('a edição que fechou no meio do caminho não troca de mês', async () => {
    // O SELECT ainda a viu aberta; o UPDATE não casa mais nenhuma linha, e a
    // mensagem que o usuário recebe é a mesma da recusa barata.
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    await expect(
      edicaoCtrl.atualizar(7, corpo({ mes: 8 }), USUARIO, CONTEXTO)
    ).rejects.toMatchObject({ statusCode: 400 })

    // E nada foi para a trilha: a auditoria vive na mesma transação.
    expect(sqls(mockDb.conn.none).some(s => s.includes('INSERT INTO auditoria.evento')))
      .toBe(false)
  })
})

// A EDIÇÃO ABERTA NÃO RECUSA A TROCA DE PERÍODO, E TAMBÉM NÃO A FAZ CALADA.
//
// Trocar o mês refaz as 21 calculadas (elas saem do banco a cada montagem) e
// MANTÉM as 11 digitadas: o texto que descreve julho passa a sair sob o rótulo
// de agosto, e nada acusa. É o mesmo estrago que a rota de copiar o mês anterior
// produzia, e que foi podada em 2026-08-06 por essa razão.
//
// AVISA em vez de recusar, ao contrário da edição fechada: a aberta é rascunho,
// e quem criou julho no lugar de agosto no dia 1º precisa poder consertar.
describe('a troca de período na edição ABERTA, com digitadas já preenchidas', () => {
  beforeEach(() => mockDb.reset())

  /** O `count` das digitadas que o controlador consulta antes do UPDATE. */
  const digitadasGravadas = total => mockDb.conn.one.mockResolvedValueOnce({ total })

  test('com digitadas preenchidas, a troca responde 409 e diz quantas são', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    digitadasGravadas(3)

    await expect(edicaoCtrl.atualizar(7, corpo({ mes: 8 }), USUARIO, CONTEXTO))
      .rejects.toMatchObject({ statusCode: 409 })

    // 409 é aviso, e aviso não grava.
    expect(updateDaEdicao()).toBeUndefined()
  })

  test('a mensagem nomeia o mês que as digitadas descrevem', async () => {
    // Sem o mês antigo na frase, quem recebe o aviso não sabe o que vai
    // reescrever: a tela já mostra o mês NOVO no formulário.
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    digitadasGravadas(3)

    await expect(edicaoCtrl.atualizar(7, corpo({ mes: 8 }), USUARIO, CONTEXTO))
      .rejects.toThrow(/3 subseção\(ões\) preenchida\(s\).*7\/2026/s)
  })

  test('com `confirmar_troca_de_periodo`, a troca passa', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ...ABERTA, mes: 8 })

    await expect(
      edicaoCtrl.atualizar(
        7, corpo({ mes: 8, confirmar_troca_de_periodo: true }), USUARIO, CONTEXTO
      )
    ).resolves.toEqual({ id: 7 })

    // E nem consulta o `count`: quem confirmou já sabe.
    expect(sqls(mockDb.conn.one).some(s => s.includes('FROM rpcmtec.subsecao')))
      .toBe(false)
  })

  test('sem nenhuma digitada gravada, a troca passa sem aviso nenhum', async () => {
    // A edição recém-criada é o caso comum de trocar o mês, e ela não tem o que
    // perder. Cobrar confirmação aqui seria ruído.
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    digitadasGravadas(0)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ...ABERTA, mes: 8 })

    await expect(
      edicaoCtrl.atualizar(7, corpo({ mes: 8 }), USUARIO, CONTEXTO)
    ).resolves.toEqual({ id: 7 })
  })

  test('mexer só no assinante não dispara o aviso', async () => {
    // O gatilho é a troca de (ano, mes), e não qualquer salvamento: a tela manda
    // o corpo inteiro toda vez.
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ...ABERTA, assinante_uuid: null })

    await edicaoCtrl.atualizar(7, corpo({ assinante_uuid: null }), USUARIO, CONTEXTO)

    expect(sqls(mockDb.conn.one).some(s => s.includes('FROM rpcmtec.subsecao')))
      .toBe(false)
  })
})

describe('a exclusão da edição, contra o fechamento simultâneo', () => {
  beforeEach(() => mockDb.reset())

  test('o DELETE cobra `data_fechamento IS NULL`, e não confia no SELECT', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 7 })

    await edicaoCtrl.deletar(7, USUARIO, CONTEXTO)

    const apagou = sqls(mockDb.conn.oneOrNone).find(s => s.includes('DELETE FROM rpcmtec.edicao'))
    expect(apagou).toMatch(/data_fechamento IS NULL/)
  })

  test('a edição que fechou no meio do caminho NÃO é apagada', async () => {
    // O SELECT ainda a viu aberta; o DELETE não casa mais nenhuma linha.
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    await expect(edicaoCtrl.deletar(7, USUARIO, CONTEXTO))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  test('a edição já fechada continua recusada antes de qualquer DELETE', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(FECHADA)

    await expect(edicaoCtrl.deletar(7, USUARIO, CONTEXTO))
      .rejects.toThrow(/Reabra-a primeiro/i)

    expect(sqls(mockDb.conn.oneOrNone).some(s => s.includes('DELETE'))).toBe(false)
  })
})

describe('a gravação de subseção, contra o fechamento simultâneo', () => {
  beforeEach(() => mockDb.reset())

  // A TRAVA É O CONTRATO. Sem ela a conferência de `data_fechamento` é um
  // palpite sobre o passado: quem lê uma linha sem travá-la não sabe se ela
  // continua assim quando o UPSERT chega.
  test('a leitura da edição pede a trava de linha', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    mockDb.conn.one.mockResolvedValueOnce({
      id: 88, edicao_id: 7, numero: '5.2', linhas: [], texto: null, sem_ocorrencia: true
    })

    await subsecaoCtrl.gravar(7, '5.2', { sem_ocorrencia: true }, USUARIO, CONTEXTO)

    const leitura = sqls(mockDb.conn.oneOrNone).find(s => s.includes('FROM rpcmtec.edicao'))
    expect(leitura).toMatch(/FOR NO KEY UPDATE/)
  })

  test('a edição fechada recusa a gravação, e nada é gravado', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(FECHADA)

    await expect(
      subsecaoCtrl.gravar(7, '5.2', { sem_ocorrencia: true }, USUARIO, CONTEXTO)
    ).rejects.toThrow(/Reabra-a para alterar o conteúdo/i)

    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('limpar também passa pela edição travada', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    await subsecaoCtrl.limpar(7, '5.2', USUARIO, CONTEXTO)

    const leitura = sqls(mockDb.conn.oneOrNone).find(s => s.includes('FROM rpcmtec.edicao'))
    expect(leitura).toMatch(/FOR NO KEY UPDATE/)
  })
})

describe('a marca de conferência, contra o fechamento simultâneo', () => {
  beforeEach(() => mockDb.reset())
  afterEach(() => jest.restoreAllMocks())

  // `revisar` começa por `controller.montar`, que são dezoito consultas e a
  // estrutura inteira. Encená-las aqui mediria o `montar`, e não a trava: o
  // dublê o substitui e deixa em cena só o que este describe existe para provar.
  const documento = fechada => ({
    fechada,
    secoes: [{
      subsecoes: [{
        numero: '2.1', cabecalhos: ['a'], linhas: [['1']],
        texto: null, semOcorrencia: false
      }]
    }]
  })

  const marcaGravada = {
    id: 55, edicao_id: 7, numero: '2.1', impressao: 'abc',
    data_revisao: '2026-08-04T10:00:00Z', usuario_uuid: USUARIO
  }

  test('a leitura da edição pede a trava de linha', async () => {
    jest.spyOn(edicaoCtrl, 'montar').mockResolvedValue(documento(false))
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    mockDb.conn.one.mockResolvedValueOnce(marcaGravada)

    await edicaoCtrl.revisar(7, '2.1', true, USUARIO, CONTEXTO)

    const leitura = sqls(mockDb.conn.oneOrNone).find(s => s.includes('FROM rpcmtec.edicao'))
    expect(leitura).toMatch(/FOR NO KEY UPDATE/)
  })

  test('a edição que fechou entre o `montar` e o INSERT não recebe a marca', async () => {
    // O `montar` a viu ABERTA -- ele roda fora da transação --, e a releitura
    // travada a encontra fechada. Sem ela, a edição assinada ganharia uma marca
    // de conferência com hora POSTERIOR ao fechamento.
    jest.spyOn(edicaoCtrl, 'montar').mockResolvedValue(documento(false))
    mockDb.conn.oneOrNone.mockResolvedValueOnce(FECHADA)

    await expect(edicaoCtrl.revisar(7, '2.1', true, USUARIO, CONTEXTO))
      .rejects.toThrow(/passo ANTES do fechamento/i)

    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('DESMARCAR também espera a edição travada', async () => {
    // Apagar a marca de um documento já assinado é a mesma escrita pelo avesso:
    // ela some do que foi conferido antes de fechar.
    jest.spyOn(edicaoCtrl, 'montar').mockResolvedValue(documento(false))
    mockDb.conn.oneOrNone.mockResolvedValueOnce(FECHADA)

    await expect(edicaoCtrl.revisar(7, '2.1', false, USUARIO, CONTEXTO))
      .rejects.toMatchObject({ statusCode: 400 })

    expect(sqls(mockDb.conn.none).some(s => s.includes('DELETE FROM rpcmtec.subsecao_revisao')))
      .toBe(false)
  })

  test('a edição que sumiu no caminho dá 404, e não 400', async () => {
    jest.spyOn(edicaoCtrl, 'montar').mockResolvedValue(documento(false))
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    await expect(edicaoCtrl.revisar(7, '2.1', true, USUARIO, CONTEXTO))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})

// ---------------------------------------------------------------------------
// A QUINTA PORTA, e ela é do lado de dentro: o fechamento sobrescrevendo o que
// foi gravado na sua própria janela.
//
// `fechar` chama `montar` FORA da transação (são dezoito consultas), e só então
// abre a transação, carimba `data_fechamento` e congela os 33 blocos. Uma
// gravação de subseção que chegava nessa janela encontrava a edição ABERTA --
// ela estava --, gravava, commitava, e o UPSERT do fechamento passava por cima
// dela com o texto do snapshot. O gestor via "gravada com sucesso" no
// histórico, a edição fechava afirmando o parágrafo anterior, e nada acusava.
//
// A trava de `conferirAlvo` (item 3 lá em cima) cobre a ordem INVERSA, e não
// esta: ela barra quem chega DEPOIS de o fechamento começar.
// ---------------------------------------------------------------------------
describe('o fechamento congela o que está gravado AGORA, e não o snapshot', () => {
  beforeEach(() => mockDb.reset())
  afterEach(() => jest.restoreAllMocks())

  const DIGITADA = 2
  const CALCULADA = 1

  // O documento como o `montar` o devolveu, com a 5.2 ainda no texto ANTIGO.
  const documento = () => ({
    ...ABERTA,
    fechada: false,
    pendentes: [],
    porRevisar: [],
    revisaoVencida: [],
    lacunasCalculadas: [],
    secoes: [{
      subsecoes: [
        {
          numero: '5.2', ordem: 20, secaoTitulo: 'Seção 5', titulo: 'Ocorrências',
          origem: DIGITADA, cabecalhos: null, linhas: null,
          texto: 'o texto que o montar viu', semOcorrencia: false
        },
        {
          numero: '3.1', ordem: 10, secaoTitulo: 'Seção 3', titulo: 'Mapoteca',
          origem: CALCULADA, cabecalhos: ['a'], linhas: [['9']],
          texto: null, semOcorrencia: false
        }
      ]
    }]
  })

  /** Os parâmetros nomeados de cada UPSERT de subseção, por número. */
  const congeladas = () => new Map(
    mockDb.conn.none.mock.calls
      .filter(([sql]) => String(sql).includes('INSERT INTO rpcmtec.subsecao'))
      .map(([, p]) => [p.numero, p])
  )

  const armar = (frescas) => {
    jest.spyOn(edicaoCtrl, 'montar').mockResolvedValue(documento())
    mockDb.conn.oneOrNone.mockResolvedValueOnce(ABERTA)
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ...FECHADA })
    mockDb.conn.any.mockResolvedValueOnce(frescas)
  }

  test('a subseção gravada na janela do `montar` congela com o texto NOVO', async () => {
    armar([{
      numero: '5.2', ordem: 20, secao_titulo: 'Seção 5', titulo: 'Ocorrências',
      origem_id: DIGITADA, origem: 'Digitada', cabecalhos: null, linhas: null,
      texto: 'o texto que o gestor gravou às 10:00:01', sem_ocorrencia: false
    }])

    await edicaoCtrl.fechar(7, USUARIO, CONTEXTO, true)

    expect(congeladas().get('5.2').texto)
      .toBe('o texto que o gestor gravou às 10:00:01')
  })

  test('a releitura acontece DEPOIS do UPDATE que carimba `data_fechamento`', async () => {
    // A ordem é o que faz a releitura valer: aquele UPDATE toma a linha da
    // edição no mesmo nível que `conferirAlvo` pede, então uma gravação em voo o
    // faz ESPERAR. Lida antes, a releitura teria a mesma janela do `montar`.
    armar([{
      numero: '5.2', origem_id: DIGITADA, cabecalhos: null, linhas: null,
      texto: 'fresco', sem_ocorrencia: false
    }])

    await edicaoCtrl.fechar(7, USUARIO, CONTEXTO, true)

    const carimbo = mockDb.conn.oneOrNone.mock.invocationCallOrder[1]
    const releitura = mockDb.conn.any.mock.invocationCallOrder[0]
    expect(releitura).toBeGreaterThan(carimbo)
  })

  test('a CALCULADA não se relê: ela sai do cálculo do próprio `montar`', async () => {
    // Ela não existe em `rpcmtec.subsecao` numa edição aberta, e ir buscá-la lá
    // congelaria tabela vazia por cima do que o gerador acabou de apurar.
    armar([{
      numero: '5.2', origem_id: DIGITADA, cabecalhos: null, linhas: null,
      texto: 'fresco', sem_ocorrencia: false
    }])

    await edicaoCtrl.fechar(7, USUARIO, CONTEXTO, true)

    expect(JSON.parse(congeladas().get('3.1').linhas)).toEqual([['9']])
  })

  test('a subseção APAGADA na mesma janela derruba o fechamento', async () => {
    // `limpar` na janela deixaria a 5.2 vazia, e usar o fresco sem reconferir
    // congelaria o vazio num documento que se recusa a fechar com buraco. A
    // transação inteira volta atrás.
    armar([])

    await expect(edicaoCtrl.fechar(7, USUARIO, CONTEXTO, true))
      .rejects.toThrow(/Faltam subseções por preencher: 5\.2/)

    expect(congeladas().size).toBe(0)
  })
})
