'use strict'

/**
 * O RESUMO DO ANO É O QUE ALIMENTA A SUBSEÇÃO 2.1 DO RPCMTec, e por isso ele se
 * prova contra o BANCO DE VERDADE. Nada aqui é mockado: as duas correções que
 * este arquivo prende moram inteiras no SQL (um filtro e a fonte de um JOIN), e
 * um dublê provaria que a função foi chamada, não que ela deixou de imprimir a
 * meta cancelada.
 *
 * SÃO DOIS DEFEITOS, medidos contra a produção restaurada em 2026-08-08:
 *
 *   D1  `controller.grade` filtrava `m.cancelada IS NOT TRUE` e o `resumoDoAno`
 *       NÃO. A 2.1 de julho de 2026 imprimia 42 linhas, das quais 2 canceladas
 *       pela R1 em 2026-05-14 (os itens 5.2 e 5.3). O campo `cancelada` chegava
 *       na linha e ninguém o olhava.
 *
 *   D2  o `resumoDoAno` lia o FROM externo de `pit.meta_em(<último dia do mês>)`
 *       e a CTE `celula` fazia JOIN com `pit.meta_vigente`, que é a revisão de
 *       HOJE. Um item que saísse da revisão vigente continuava listado pela
 *       edição passada e PERDIA as células: `realizado` saía 0. Na produção a
 *       divergência era ZERO, então o defeito era latente -- e a
 *       reprodutibilidade, que é a razão de o aparato de revisão existir, valia
 *       pela metade.
 *
 * CADA CASO TEM O SEU CONTROLE, e é isso que impede o teste de passar com a
 * correção ausente: o item cancelado só prova alguma coisa ao lado do item VIVO
 * da mesma meta, e o item que saiu da revisão de hoje só prova alguma coisa ao
 * lado do que continua nela.
 */

const { db } = require('../../database')
const { cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

const execucaoCtrl = require('../../pit/pit_execucao_ctrl')

const ANO = 2026

// Julho de 2026, que é a edição que a medição da produção usou. O `resumoDoAno`
// converte o mês no ÚLTIMO dia dele antes de chamar `pit.meta_em`.
const MES = 7

beforeAll(async () => {
  await db.createConn()
})

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

/** O grupo numerado, que é o cabeçalho do bloco no documento. */
const criarMeta = async (numeroMeta, nome) => {
  const { id } = await db.conn.one(
    `INSERT INTO pit.meta (ano, numero_meta, nome, usuario_cadastramento_uuid)
     VALUES ($<ano>, $<numeroMeta>, $<nome>, $<uuid>) RETURNING id`,
    { ano: ANO, numeroMeta, nome, uuid: ADMIN_UUID }
  )
  return id
}

/**
 * O item, sempre de origem MANUAL: a origem calculada faria a célula vir das
 * versões e dos pedidos, e o que se mede aqui é o lançamento.
 */
const criarItem = async (metaId, item) => {
  const { id } = await db.conn.one(
    `INSERT INTO pit.meta_item
       (meta_id, item, unidade_id, origem_id, usuario_cadastramento_uuid)
     VALUES ($<metaId>, $<item>, 1, 1, $<uuid>) RETURNING id`,
    { metaId, item, uuid: ADMIN_UUID }
  )
  return id
}

/** `dataVigencia` nula é RASCUNHO: a revisão existe e ainda não rege nada. */
const criarRevisao = async (codigo, dataVigencia) => {
  const { id } = await db.conn.one(
    `INSERT INTO pit.revisao (ano, codigo, data_vigencia, usuario_cadastramento_uuid)
     VALUES ($<ano>, $<codigo>, $<dataVigencia>, $<uuid>) RETURNING id`,
    { ano: ANO, codigo, dataVigencia, uuid: ADMIN_UUID }
  )
  return id
}

const declarar = (itemId, revisaoId, extra = {}) => db.conn.none(
  `INSERT INTO pit.meta_item_revisao
     (meta_item_id, revisao_id, descricao, quantidade_prevista, cancelada,
      usuario_cadastramento_uuid)
   VALUES ($<itemId>, $<revisaoId>, $<descricao>, $<quantidade>, $<cancelada>,
           $<uuid>)`,
  {
    itemId,
    revisaoId,
    descricao: extra.descricao || 'Carta Topográfica 1:25.000.',
    quantidade: extra.quantidade === undefined ? 10 : extra.quantidade,
    cancelada: Boolean(extra.cancelada),
    uuid: ADMIN_UUID
  }
)

const lancar = (itemId, mes, realizada, planejada = realizada) => db.conn.none(
  `INSERT INTO pit.execucao
     (meta_id, mes, quantidade_planejada, quantidade, usuario_cadastramento_uuid)
   VALUES ($<itemId>, $<mes>, $<planejada>, $<realizada>, $<uuid>)`,
  { itemId, mes, planejada, realizada, uuid: ADMIN_UUID }
)

const porItem = linhas => new Map(linhas.map(l => [l.item, l]))

describe('D1: a meta cancelada sai do resumo, e com ela da 2.1', () => {
  /**
   * Uma meta com DOIS itens: o 5.1 segue vivo e o 5.2 é cancelado por uma
   * revisão posterior, como a R1 de 2026 fez com a 5.2 e a 5.3.
   */
  const cenarioCancelamento = async () => {
    const metaId = await criarMeta(5, 'Capacitação')
    const vivo = await criarItem(metaId, '5.1')
    const cancelado = await criarItem(metaId, '5.2')

    const r0 = await criarRevisao('R0', '2026-01-01')
    await declarar(vivo, r0)
    await declarar(cancelado, r0)

    // A revisão que cancela, publicada em maio: ela vige em julho.
    const r1 = await criarRevisao('R1', '2026-05-14')
    await declarar(cancelado, r1, { cancelada: true })

    await lancar(vivo, 3, 4)
    await lancar(cancelado, 3, 6)

    return { vivo, cancelado }
  }

  test('o item cancelado NÃO sai no resumo da edição de julho', async () => {
    await cenarioCancelamento()

    const linhas = await execucaoCtrl.resumoDoAno(ANO, MES)
    const itens = linhas.map(l => l.item)

    expect(itens).toContain('5.1')
    expect(itens).not.toContain('5.2')
  })

  /**
   * O CONTROLE DO D1. Sem ele o caso acima passaria com o filtro AUSENTE, desde
   * que o cenário não tivesse item cancelado nenhum: o que prova que o filtro
   * faz efeito é o cancelamento EXISTIR e ainda assim não sair.
   *
   * Aqui isso se mede pelo total: com o cancelado, o resumo tem UMA linha, e a
   * consulta sem filtro teria DUAS. O realizado do item vivo continua o dele, e
   * não a soma dos dois: o filtro tira a LINHA, e não o número.
   */
  test('o cancelamento existe de fato, e é ele que a linha a menos prova', async () => {
    const { cancelado } = await cenarioCancelamento()

    const declarado = await db.conn.one(
      `SELECT cancelada FROM pit.meta_em('2026-07-31') WHERE id = $<cancelado>`,
      { cancelado }
    )
    expect(declarado.cancelada).toBe(true)

    const linhas = await execucaoCtrl.resumoDoAno(ANO, MES)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].item).toBe('5.1')
    expect(linhas[0].realizado).toBe(4)
  })

  test('a grade continua sem a meta cancelada, como já estava', async () => {
    await cenarioCancelamento()

    const linhas = await execucaoCtrl.grade(ANO)
    expect(linhas.map(l => l.item)).toEqual(['5.1'])
  })
})

/**
 * D2: A EDIÇÃO PASSADA NÃO MUDA QUANDO UMA REVISÃO NOVA É PUBLICADA.
 *
 * O QUE A CORREÇÃO FEZ, e o que ela NÃO consegue provar hoje. O `resumoDoAno`
 * lia o FROM externo de `pit.meta_em(<último dia do mês>)` e a CTE `celula` fazia
 * JOIN com `pit.meta_vigente`. Duas fontes para a MESMA pergunta, e uma delas
 * ignorando o mês. A correção passa a mesma data às duas.
 *
 * A DIVERGÊNCIA DE CONJUNTO É INALCANÇÁVEL HOJE, e é honesto dizer por quê:
 * `meta_em(d)` é `meta_vigente` mais o predicado `data_vigencia <= d`, e nada
 * mais. Todo item que `meta_em(d)` lista tem declaração publicada, logo está em
 * `meta_vigente`: um é subconjunto do outro POR CONSTRUÇÃO. Conferido também
 * contra a produção restaurada em 2026-08-08, mês a mês de 2026: zero itens em
 * `meta_em(d)` fora de `meta_vigente`. Por isso NENHUM caso de comportamento
 * separa o SQL velho do novo, e inventar um cenário que "falha sem a correção"
 * aqui seria escrever um teste que mente.
 *
 * O QUE ESTES CASOS PRENDEM, ENTÃO. A promessa que a correção protege é a
 * REPRODUTIBILIDADE: a edição de março reporta a revisão de março. Ela vale hoje
 * por acidente das duas definições, e passará a valer por construção. O guarda
 * da regressão exata (a CTE voltar a ler a revisão de hoje) é estrutural, e mora
 * em `unit/pit_execucao_poda.test.js`; aqui se prende o comportamento que dá
 * sentido a ele, e que quebra na hora se alguém trocar o `meta_em` do FROM
 * externo por `meta_vigente`.
 */
describe('D2: a edição passada não muda quando uma revisão nova é publicada', () => {
  /**
   * O R0 de janeiro promete 10 no item 1.1. Em agosto a DSG publica o R1, que
   * muda o 1.1 para 30 e ACRESCENTA o item 1.9 -- que é a história dos itens 1.9
   * a 1.11 de 2026, contada em `er/pit.sql`. Os dois têm lançamento em
   * fevereiro, inclusive o item que em fevereiro ainda não existia no plano.
   */
  const cenarioRevisaoPosterior = async () => {
    const metaId = await criarMeta(1, 'Produção de Geoinformação')
    const antigo = await criarItem(metaId, '1.1')
    const acrescentado = await criarItem(metaId, '1.9')

    const r0 = await criarRevisao('R0', '2026-01-01')
    await declarar(antigo, r0, { quantidade: 10 })

    const r1 = await criarRevisao('R1', '2026-08-01')
    await declarar(antigo, r1, { quantidade: 30 })
    await declarar(acrescentado, r1, { quantidade: 4 })

    await lancar(antigo, 2, 5)
    await lancar(acrescentado, 2, 7)

    return { antigo, acrescentado }
  }

  test('a edição de março reporta a promessa de MARÇO, e não a de hoje', async () => {
    await cenarioRevisaoPosterior()

    const marco = porItem(await execucaoCtrl.resumoDoAno(ANO, 3))

    expect(marco.get('1.1')).toBeDefined()
    expect(marco.get('1.1').quantidade_prevista).toBe(10)
    expect(marco.get('1.1').realizado).toBe(5)

    // O item que o R1 acrescentou em AGOSTO não estava no plano em março, e a
    // edição de março não pode reportá-lo -- nem a linha, nem os 7 dele.
    expect(marco.get('1.9')).toBeUndefined()
    expect(marco.size).toBe(1)
  })

  /**
   * O CONTROLE. Sem ele, "a edição de março não traz o 1.9" passaria com o item
   * simplesmente não existindo: o que prova que o recorte é por DATA é o mesmo
   * item aparecer, com o mesmo lançamento, na edição de agosto.
   */
  test('a edição de agosto traz o item acrescentado, e a promessa nova', async () => {
    await cenarioRevisaoPosterior()

    const agosto = porItem(await execucaoCtrl.resumoDoAno(ANO, 8))

    expect(agosto.size).toBe(2)
    expect(agosto.get('1.1').quantidade_prevista).toBe(30)
    expect(agosto.get('1.9').realizado).toBe(7)
    // O acumulado é de janeiro até agosto, e o lançamento é de fevereiro: o mês
    // de agosto sozinho não tem nada.
    expect(agosto.get('1.9').realizado_mes).toBe(0)
  })

  /**
   * A CÉLULA SEGUE A LINHA. É o que a correção garante por construção: se o item
   * sai da edição, as células dele saem junto, e não sobra um `realizado` de um
   * item que a edição não lista. Medido pela soma, que é o número que vai para a
   * 2.1.
   */
  test('nenhum realizado sobra de item que a edição de março não lista', async () => {
    await cenarioRevisaoPosterior()

    const marco = await execucaoCtrl.resumoDoAno(ANO, 3)
    const somaMarco = marco.reduce((t, l) => t + l.realizado, 0)
    expect(somaMarco).toBe(5)

    const agosto = await execucaoCtrl.resumoDoAno(ANO, 8)
    expect(agosto.reduce((t, l) => t + l.realizado, 0)).toBe(12)
  })
})

describe('a poda de data_conclusao e observacao', () => {
  test('as duas colunas não existem mais em pit.execucao', async () => {
    const colunas = await db.conn.any(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'pit' AND table_name = 'execucao'
       ORDER BY column_name`
    )
    const nomes = colunas.map(c => c.column_name)

    expect(nomes).not.toContain('data_conclusao')
    expect(nomes).not.toContain('observacao')
    // O controle: as duas que FICAM, com a distinção nulo-versus-zero intacta.
    expect(nomes).toContain('quantidade')
    expect(nomes).toContain('quantidade_planejada')
  })

  /**
   * NULO E ZERO CONTINUAM DIFERENTES, e é o que a poda não podia levar junto:
   * nulo é "ninguém lançou" e zero é "conferi e não houve". As duas colunas
   * seguem ANULÁVEIS, e o zero é gravável.
   */
  test('as duas colunas que ficam continuam anuláveis, e zero é valor', async () => {
    const colunas = await db.conn.any(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'pit' AND table_name = 'execucao'
         AND column_name IN ('quantidade', 'quantidade_planejada')`
    )
    expect(colunas).toHaveLength(2)
    for (const c of colunas) expect(c.is_nullable).toBe('YES')

    const metaId = await criarMeta(6, 'Programa Memória')
    const item = await criarItem(metaId, '6.1')
    const r0 = await criarRevisao('R0', '2026-01-01')
    await declarar(item, r0)

    await lancar(item, 4, 0, 3)
    const linha = await db.conn.one(
      'SELECT quantidade, quantidade_planejada FROM pit.execucao WHERE meta_id = $<item>',
      { item }
    )
    expect(linha.quantidade).toBe(0)
    expect(linha.quantidade_planejada).toBe(3)
  })

  /**
   * O CHECK encolheu para dois termos, e é ele que recusa a linha que não diz
   * nada. Enquanto ele tinha quatro, a linha que só tivesse observação não podia
   * ser apagada pela tela, que só sabe mandar os dois números.
   */
  test('a linha com os dois números nulos é recusada pelo banco', async () => {
    const metaId = await criarMeta(6, 'Programa Memória')
    const item = await criarItem(metaId, '6.1')

    await expect(db.conn.none(
      `INSERT INTO pit.execucao (meta_id, mes, usuario_cadastramento_uuid)
       VALUES ($<item>, 5, $<uuid>)`,
      { item, uuid: ADMIN_UUID }
    )).rejects.toThrow(/execucao_diz_alguma_coisa/)
  })
})
