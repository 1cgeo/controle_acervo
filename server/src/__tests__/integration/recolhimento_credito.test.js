'use strict'

/**
 * O RECOLHIMENTO DE CRÉDITO CONTRA O BANCO DE VERDADE.
 *
 * O que só a integração prova, e por isso este arquivo existe:
 *   - a unicidade `(ano, numero, nota_credito_id)` recusa o duplicado E aceita o
 *     RATEIO (o mesmo documento abatendo outra NC), que é caso real medido: a
 *     2026NC401316 recolhe R$ 0,98 da 400224 e R$ 0,99 da 400937;
 *   - o `CHECK (valor > 0)` do banco;
 *   - a cascata: apagar a NC apaga os recolhimentos dela, e o rastro de cada um
 *     tem de sobrar em `auditoria.evento`, na ficha da NC;
 *   - o anexo do recolhimento, sexto dono do vínculo polimórfico de
 *     `orcamento.arquivo`.
 */

const { db } = require('../../database')
const { cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

const ncCtrl = require('../../orcamento/nota_credito/nota_credito_ctrl')
const recolhimentoCtrl = require('../../orcamento/nota_credito/recolhimento_ctrl')
const arquivoCtrl = require('../../orcamento/arquivo/arquivo_ctrl')

const ANO = 2026
const ND = '339030'
const PDR = 1

beforeAll(async () => {
  await db.createConn()
})

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const novaNc = (numero, valor = 1000) => ncCtrl.criar(
  { numero, ano: ANO, cod_nd: ND, valor_nc: valor, classificacao_id: PDR },
  ADMIN_UUID
)

const recolher = (ncId, valor, numero) => recolhimentoCtrl.criar(
  { nota_credito_id: Number(ncId), numero, ano: ANO, valor },
  ADMIN_UUID
)

const eventosDaNc = ncId => db.conn.any(
  `SELECT tabela, operacao, registro_id FROM auditoria.evento
    WHERE modulo = 'orcamento' AND entidade = 'nota_credito'
      AND entidade_id = $<ncId>
    ORDER BY id`,
  { ncId: String(ncId) }
)

describe('a unicidade do documento de recolhimento', () => {
  test('o MESMO documento abatendo DUAS NCs passa (o rateio)', async () => {
    const a = await novaNc('NC-400224')
    const b = await novaNc('NC-400937')

    await recolher(a.id, 0.98, '2026NC401316')
    await recolher(b.id, 0.99, '2026NC401316')

    const lidaA = await ncCtrl.getPorId(a.id)
    const lidaB = await ncCtrl.getPorId(b.id)
    expect(Number(lidaA.valor_recolhido)).toBeCloseTo(0.98, 2)
    expect(Number(lidaB.valor_recolhido)).toBeCloseTo(0.99, 2)
  })

  test('o mesmo documento DUAS VEZES na MESMA NC volta 409', async () => {
    const nc = await novaNc('NC-DUPLICADA')
    await recolher(nc.id, 100, '2026NC401316')

    await expect(recolher(nc.id, 100, '2026NC401316')).rejects.toMatchObject({
      statusCode: 409
    })
  })

  test('valor zero é recusado pelo banco', async () => {
    const nc = await novaNc('NC-ZERO')
    // O schema Joi já barra na rota; aqui o controller vai direto ao banco, e o
    // que responde é o `CHECK (valor > 0)`. As duas barreiras existem, e esta é
    // a que sobrevive a um chamador que não passe pela rota.
    await expect(recolher(nc.id, 0, 'NC-REC-ZERO')).rejects.toBeDefined()
  })
})

describe('a cascata quando a NC é apagada', () => {
  test('os recolhimentos saem junto, e o rastro de cada um fica', async () => {
    const nc = await novaNc('NC-CASCATA')
    await recolher(nc.id, 100, 'NC-REC-A')
    await recolher(nc.id, 150, 'NC-REC-B')

    const antes = await db.conn.one(
      `SELECT COUNT(*)::int AS n FROM orcamento.nota_credito_recolhimento
        WHERE nota_credito_id = $<id>`,
      { id: nc.id }
    )
    // VARIÂNCIA: sem esta conferência, o teste passaria contra uma NC que nunca
    // teve recolhimento nenhum, e a cascata não teria sido exercitada.
    expect(antes.n).toBe(2)

    await ncCtrl.deletar(nc.id, ADMIN_UUID)

    const depois = await db.conn.one(
      `SELECT COUNT(*)::int AS n FROM orcamento.nota_credito_recolhimento
        WHERE nota_credito_id = $<id>`,
      { id: nc.id }
    )
    expect(depois.n).toBe(0)

    // O RASTRO SOBRA, e é o ponto: a cascata apaga a linha sem passar por DELETE
    // nenhum do controller, e sem o `auditarCascata` o único registro de que
    // aquele documento existiu sumiria em silêncio junto com a NC.
    const eventos = await eventosDaNc(nc.id)
    const exclusoesDeRecolhimento = eventos.filter(
      e => e.tabela === 'orcamento.nota_credito_recolhimento' && e.operacao === 'D'
    )
    expect(exclusoesDeRecolhimento).toHaveLength(2)
  })
})

describe('o anexo do recolhimento', () => {
  test('vincula, lista e cai na ficha da NC ao ser auditado', async () => {
    const nc = await novaNc('NC-COM-ANEXO')
    const rec = await recolher(nc.id, 100, 'NC-REC-ANEXO')

    const arquivo = {
      originalname: 'extrato.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 extrato do SIAFI')
    }

    const lista = await arquivoCtrl.criar(
      arquivo, { recolhimento_id: rec.id }, ADMIN_UUID
    )

    expect(lista).toHaveLength(1)
    expect(lista[0].nome_original).toBe('extrato.pdf')
    expect(String(lista[0].recolhimento_id)).toBe(String(rec.id))

    // O ANEXO É MÚLTIPLO, como o do PDR: o extrato do SIAFI e o DIEx que pede a
    // devolução são dois documentos. Um segundo upload ACRESCENTA, e não
    // substitui, que é o que o modo `single` da NC faria.
    const lista2 = await arquivoCtrl.criar(
      { ...arquivo, originalname: 'diex.pdf' },
      { recolhimento_id: rec.id },
      ADMIN_UUID
    )
    expect(lista2).toHaveLength(2)

    // O evento do anexo cai na ficha da NOTA DE CRÉDITO, e não numa ficha do
    // recolhimento: o agregado resolve o salto (anexo -> recolhimento -> NC).
    const eventos = await eventosDaNc(nc.id)
    const inclusoesDeAnexo = eventos.filter(
      e => e.tabela === 'orcamento.arquivo' && e.operacao === 'I'
    )
    expect(inclusoesDeAnexo).toHaveLength(2)
  })
})
