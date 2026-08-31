'use strict'

/**
 * A 4.3 SÓ LISTA O RESTO QUE AINDA FALTA LIQUIDAR, e a 4.6 nomeia o empenho
 * pelo número do SIAFI.
 *
 * O CASO REAL, medido em 2026-08-31 contra o SAG. Dos quinze RPNP carregados
 * para 2026, DOZE já estavam quitados, e a 4.3 gastava doze linhas para dizer
 * que não havia nada a liquidar. A subseção é a tabela do que falta: o resto
 * resolvido sai dela, e continua no cadastro.
 *
 * O corte é `IS DISTINCT FROM 0`, e não `> 0`, porque saldo NEGATIVO e saldo
 * NULO são os dois casos que a tabela existe para denunciar. Um filtro visto só
 * esconder linha quitada não foi visto funcionar: os testes abaixo constroem os
 * dois insumos degenerados ANTES do caso feliz.
 *
 * E o filtro roda sobre o saldo DO CORTE, não sobre `rpnp.valor_a_liquidar`,
 * que guarda o saldo de hoje. Sem isso a edição de maio esconderia o resto que
 * só foi quitado em junho -- que é a mesma falha que a 4.3 já teve em
 * 2026-08-11, quando saía idêntica nas seis edições do semestre.
 *
 * A 4.6 vem junto porque compartilha a causa: as NEs de 2025 entraram pelo RPCA
 * Técnico daquele ano, que publica o código interno do documento
 * (`RPCA-405096`) e não o número do SIAFI. A 4.3 já resolvia isso pelo
 * `rpnp.empenho_label`; a 4.6 anunciava o código RPCA, e o chefe leu "Nobreak,
 * RPCA-405096" sem reconhecer o empenho 2025NE000276.
 */

const { db } = require('../../database')
const { cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

const ncCtrl = require('../../orcamento/nota_credito/nota_credito_ctrl')
const neCtrl = require('../../orcamento/nota_empenho/nota_empenho_ctrl')
const rpnpCtrl = require('../../orcamento/licitacao/rpnp_ctrl')
const recebimentoCtrl = require('../../orcamento/nota_empenho/recebimento_ctrl')
const rpcmtecCtrl = require('../../rpcmtec/rpcmtec_ctrl')

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

/** Uma NE de valor folgado, para o resíduo do RPNP caber embaixo dela. */
const empenhoDe = async (numero, valor) => {
  const nc = await ncCtrl.criar(
    { numero: `2026NC${numero.slice(-6)}`, ano: ANO, cod_nd: ND, valor_nc: valor, classificacao_id: PDR },
    ADMIN_UUID
  )
  const ne = await neCtrl.criar({
    numero,
    ano: ANO,
    data_empenho: '2026-01-05',
    notas_credito: [{ nota_credito_id: Number(nc.id), valor }]
  }, ADMIN_UUID)
  return Number(ne.id)
}

const carregarRpnp = (neId, { empenhado, label, finalidade }) => rpnpCtrl.criar({
  ano: ANO,
  nota_empenho_id: neId,
  empenho_label: label,
  finalidade,
  valor_empenhado: empenhado,
  valor_a_liquidar: 0
}, ADMIN_UUID)

/**
 * Insere a liquidação DIRETO na tabela, e não pelo controller.
 *
 * O controller recusa liquidação acima do empenhado disponível, e é ele que
 * está certo: o insumo degenerado deste teste (saldo de RPNP negativo) não
 * nasce de quem digita, nasce do SIAFI. Foi o que aconteceu com a 2025NE000266
 * em 2026-08-31, quando a NS 2026NS000320 estornou R$ 1.668,84 que ninguém
 * lançou aqui. Passar pelo controller esconderia justamente o caso a provar.
 */
const liquidar = (neId, valor, data) => db.conn.none(
  `INSERT INTO orcamento.liquidacao
     (nota_empenho_id, valor_liquidado, data, usuario_cadastramento_uuid)
   VALUES ($<neId>, $<valor>, $<data>, $<uuid>)`,
  { neId, valor, data, uuid: ADMIN_UUID }
)

// `moeda()` usa toLocaleString('pt-BR'), que separa o R$ do numero com espaco
// NAO separavel (U+00A0). Comparar com espaco comum falha sem mostrar por que.
const semNbsp = celula => String(celula).replace(/\s/g, ' ')

const subsecao = async (numero, mes = 12) => {
  const blocos = await rpcmtecCtrl.calcular({ ano: ANO, mes })
  return blocos[numero]
}

const empenhosNa43 = async (mes = 12) => (await subsecao('4.3', mes)).map(l => l[0])

describe('a 4.3 esconde o RPNP já resolvido', () => {
  test('o resto QUITADO no corte não sai, e o que tem saldo sai', async () => {
    const quitado = await empenhoDe('2026NE000101', 5000)
    const comSaldo = await empenhoDe('2026NE000102', 5000)

    await carregarRpnp(quitado, { empenhado: 1000, label: '2025NE000900', finalidade: 'quitado' })
    await carregarRpnp(comSaldo, { empenhado: 1000, label: '2025NE000901', finalidade: 'com saldo' })

    await liquidar(quitado, 1000, '2026-03-10')
    await liquidar(comSaldo, 400, '2026-03-10')

    const linhas = await subsecao('4.3')
    expect(linhas.map(l => l[0])).toEqual(['2025NE000901'])
    expect(semNbsp(linhas[0][3])).toBe('R$ 600,00')
  })

  test('saldo NEGATIVO continua aparecendo: é defeito, e defeito se vê', async () => {
    const estourado = await empenhoDe('2026NE000103', 50000)
    await carregarRpnp(estourado, { empenhado: 1000, label: '2025NE000902', finalidade: 'estourado' })

    // Mais do que o resíduo do RPNP: é o que sobra quando um estorno do SIAFI
    // não foi lançado aqui.
    await liquidar(estourado, 2500, '2026-04-01')

    const linhas = await subsecao('4.3')
    expect(linhas.map(l => l[0])).toEqual(['2025NE000902'])
    expect(semNbsp(linhas[0][3])).toBe('-R$ 1.500,00')
  })

  test('valor_empenhado NULO continua aparecendo: nulo é "não se sabe"', async () => {
    const semValor = await empenhoDe('2026NE000104', 5000)
    await carregarRpnp(semValor, { empenhado: null, label: '2025NE000903', finalidade: 'sem valor' })

    expect(await empenhosNa43()).toEqual(['2025NE000903'])
  })

  test('com TODOS os restos quitados a subseção sai vazia', async () => {
    const a = await empenhoDe('2026NE000105', 5000)
    const b = await empenhoDe('2026NE000106', 5000)
    await carregarRpnp(a, { empenhado: 700, label: '2025NE000904', finalidade: 'a' })
    await carregarRpnp(b, { empenhado: 300, label: '2025NE000905', finalidade: 'b' })
    await liquidar(a, 700, '2026-02-02')
    await liquidar(b, 300, '2026-02-02')

    expect(await subsecao('4.3')).toEqual([])
  })

  test('o corte manda: quem só quitou em junho AINDA aparece na edição de maio', async () => {
    const tardio = await empenhoDe('2026NE000107', 5000)
    await carregarRpnp(tardio, { empenhado: 800, label: '2025NE000906', finalidade: 'tardio' })
    await liquidar(tardio, 800, '2026-06-20')

    const maio = await subsecao('4.3', 5)
    expect(maio.map(l => l[0])).toEqual(['2025NE000906'])
    expect(semNbsp(maio[0][3])).toBe('R$ 800,00')

    expect(await empenhosNa43(6)).toEqual([])
  })
})

describe('a 4.6 nomeia o empenho pelo número do SIAFI', () => {
  const receber = (neId, material) => recebimentoCtrl.criar(
    { nota_empenho_id: neId, material, situacao: 'Material recebido', ano_referencia: ANO },
    ADMIN_UUID
  )

  test('com rótulo de RPNP sai o número do SIAFI, e não o código RPCA', async () => {
    const ne = await empenhoDe('RPCA-405096', 40000)
    await carregarRpnp(ne, { empenhado: 32000, label: '2025NE000276', finalidade: 'Nobreak' })
    await receber(ne, 'Nobreak')

    const linhas = await subsecao('4.6')
    expect(linhas).toHaveLength(1)
    expect(linhas[0][0]).toBe('2025NE000276')
  })

  test('sem RPNP o número da própria NE continua valendo', async () => {
    const ne = await empenhoDe('2026NE000108', 5000)
    await receber(ne, 'Ar condicionado')

    const linhas = await subsecao('4.6')
    expect(linhas.map(l => l[0])).toEqual(['2026NE000108'])
  })

  test('empenho carregado como RPNP em dois anos não duplica a linha de material', async () => {
    const ne = await empenhoDe('RPCA-404542', 200000)
    await carregarRpnp(ne, { empenhado: 100000, label: '2025NE000267', finalidade: 'HEX' })
    await db.conn.none(
      `INSERT INTO orcamento.rpnp
         (ano, nota_empenho_id, empenho_label, finalidade, valor_empenhado,
          valor_a_liquidar, usuario_cadastramento_uuid)
       VALUES ($<neId2>, $<neId>, '2025NE000267 (recarregado)', 'HEX', 100000, 0, $<uuid>)`,
      { neId2: ANO + 1, neId: ne, uuid: ADMIN_UUID }
    )
    await receber(ne, 'Imagens HEX')

    const linhas = await subsecao('4.6')
    expect(linhas).toHaveLength(1)
    expect(linhas[0][0]).toBe('2025NE000267 (recarregado)')
  })
})
