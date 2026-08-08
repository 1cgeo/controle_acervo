'use strict'

// A PODA DO ORÇAMENTO (2026-08-08) e o CONSERTO que veio antes dela, contra o
// banco de verdade.
//
// O QUE ESTE ARQUIVO GUARDA, e que nenhum teste de schema alcança:
//
//   1. que a chave do SIAFI da nota de empenho VOLTOU A VALER. Ela existia desde
//      2026-08-07 e estava INERTE: o servidor nunca gravava `ug`, toda NE nascia
//      com NULL, e no Postgres NULL não colide com NULL num índice único. A
//      proteção só se prova com o banco recusando de verdade;
//   2. que os três DERIVÁVEIS dão o MESMO número que a coluna dava. Não basta
//      "o campo continua saindo": o valor tem de ser o mesmo, com o mesmo
//      arredondamento, senão a tela muda em silêncio no dia da migração;
//   3. que as quinze colunas realmente saíram do BANCO, e não só do Joi;
//   4. que as que o chefe MANTEVE continuam lá -- que é a metade que se erra
//      quando alguém "arruma" o resto por simetria.

const { db } = require('../../database')
const { cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

const ncCtrl = require('../../orcamento/nota_credito/nota_credito_ctrl')
const neCtrl = require('../../orcamento/nota_empenho/nota_empenho_ctrl')
const pdrCtrl = require('../../orcamento/pdr/pdr_ctrl')
const dfdCtrl = require('../../orcamento/dfd/dfd_ctrl')

const ANO = 2026
const ND_CONSUMO = '339030' // GND 3, em dominio.natureza_despesa
const ND_CAPITAL = '449052' // GND 4
const PDR = 1 // dominio.classificacao_nc

// A UG emitente que separa as duas unidades gestoras. A regra do backfill de
// 2026-08-07, que o servidor agora aplica em toda gravação: crédito emitido pela
// 167035 é empenhado pela 167382; qualquer outro emitente, pela 160382.
const EMITENTE_DA_167382 = '167035'
const EMITENTE_DA_160382 = '160035'

beforeAll(async () => {
  await db.createConn()
})

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const novaNc = (extra = {}) => ncCtrl.criar(
  {
    numero: 'NC-P01',
    ano: ANO,
    cod_nd: ND_CONSUMO,
    valor_nc: 100000,
    classificacao_id: PDR,
    ...extra
  },
  ADMIN_UUID
)

// ---------------------------------------------------------------------------

describe('O CONSERTO: a chave do SIAFI da nota de empenho voltou a valer', () => {
  it('a NE nasce com ug e gestao gravadas, e o servidor as deriva da NC', async () => {
    const nc = await novaNc({ ug_emitente: EMITENTE_DA_160382 })
    const ne = await neCtrl.criar(
      { numero: 'NE-000001', ano: ANO, nota_credito_id: nc.id, valor_empenhado: 1000 },
      ADMIN_UUID
    )

    const linha = await db.conn.one(
      'SELECT ug, gestao FROM orcamento.nota_empenho WHERE id = $<id>',
      { id: ne.id }
    )
    expect(linha.ug).toBe('160382')
    expect(linha.gestao).toBe('00001')
  })

  it('crédito da UG 167035 produz empenho da UG 167382', async () => {
    const nc = await novaNc({ ug_emitente: EMITENTE_DA_167382 })
    const ne = await neCtrl.criar(
      { numero: 'NE-000001', ano: ANO, nota_credito_id: nc.id, valor_empenhado: 1000 },
      ADMIN_UUID
    )

    const linha = await db.conn.one(
      'SELECT ug FROM orcamento.nota_empenho WHERE id = $<id>',
      { id: ne.id }
    )
    expect(linha.ug).toBe('167382')
  })

  // O CASO QUE ESTA MIGRAÇÃO EXISTE PARA IMPEDIR. Até 2026-08-08 as duas NEs
  // abaixo entravam as duas, sem erro nenhum: `ug` era NULL nas duas, e o índice
  // único as considerava distintas. A produção chegou a ter 38 registros em 32
  // números por causa disso.
  it('duas NEs com o mesmo número, ano e UG dão 409', async () => {
    const nc = await novaNc({ ug_emitente: EMITENTE_DA_160382 })
    const outra = await novaNc({
      numero: 'NC-P02', ug_emitente: EMITENTE_DA_160382
    })

    await neCtrl.criar(
      { numero: 'NE-000009', ano: ANO, nota_credito_id: nc.id, valor_empenhado: 1000 },
      ADMIN_UUID
    )

    // Outra NC, outro crédito, MESMO número de empenho na mesma UG.
    await expect(
      neCtrl.criar(
        { numero: 'NE-000009', ano: ANO, nota_credito_id: outra.id, valor_empenhado: 500 },
        ADMIN_UUID
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  // O CONTROLE POSITIVO, e é ele que explica por que a chave tem QUATRO campos e
  // não dois. A 167382 é unidade gestora distinta, com numeração própria
  // começando do 1: as duas têm legitimamente uma 2026NE000005. Um índice em
  // (ano, numero) recusaria dado real -- foi o erro da primeira proposta, e está
  // registrado na migração de 2026-08-07.
  it('o mesmo número em UGs DIFERENTES continua entrando, e é dado legítimo', async () => {
    const daCasa = await novaNc({ ug_emitente: EMITENTE_DA_160382 })
    const daOutra = await novaNc({
      numero: 'NC-P02', ug_emitente: EMITENTE_DA_167382
    })

    const a = await neCtrl.criar(
      { numero: 'NE-000005', ano: ANO, nota_credito_id: daCasa.id, valor_empenhado: 1000 },
      ADMIN_UUID
    )
    const b = await neCtrl.criar(
      { numero: 'NE-000005', ano: ANO, nota_credito_id: daOutra.id, valor_empenhado: 700 },
      ADMIN_UUID
    )

    const ugs = await db.conn.any(
      'SELECT ug FROM orcamento.nota_empenho WHERE id IN ($<a>, $<b>) ORDER BY ug',
      { a: a.id, b: b.id }
    )
    expect(ugs.map(l => l.ug)).toEqual(['160382', '167382'])
  })

  // A UG é REDERIVADA a cada gravação, e não congelada no cadastro: se a NC
  // representativa muda, a UG que empenha muda com ela. Congelá-la deixaria a
  // chave do SIAFI descrevendo um empenho que o crédito de hoje desmente.
  it('trocar a NC representativa muda a UG do empenho', async () => {
    const daCasa = await novaNc({ ug_emitente: EMITENTE_DA_160382 })
    const daOutra = await novaNc({
      numero: 'NC-P02', ug_emitente: EMITENTE_DA_167382
    })

    const ne = await neCtrl.criar(
      { numero: 'NE-000010', ano: ANO, nota_credito_id: daCasa.id, valor_empenhado: 1000 },
      ADMIN_UUID
    )
    await neCtrl.atualizar(
      ne.id,
      { numero: 'NE-000010', ano: ANO, nota_credito_id: daOutra.id, valor_empenhado: 1000 },
      ADMIN_UUID
    )

    const linha = await db.conn.one(
      'SELECT ug FROM orcamento.nota_empenho WHERE id = $<id>',
      { id: ne.id }
    )
    expect(linha.ug).toBe('167382')
  })
})

// ---------------------------------------------------------------------------

describe('Os DERIVÁVEIS dão o MESMO número que a coluna dava', () => {
  // 31 de 31 itens de produção tinham `valor_total = quantidade * valor_unitario`
  // e 8 de 8 DFDs tinham `valor_estimado` igual à soma dos totais. A poda só é
  // segura enquanto as duas igualdades valerem, e o que se prova aqui é que a
  // CONTA do servidor é essa mesma, com o mesmo arredondamento a duas casas.
  it('o total do item e o estimado do DFD saem calculados, e batem centavo a centavo', async () => {
    const dfd = await dfdCtrl.criar(
      {
        numero: 'DFD-P01',
        ano: ANO,
        objeto: 'Aquisicao',
        consta_pca: true,
        itens: [
          // 12,345 x 7,77 = 95,920... e a coluna era NUMERIC(15,2). Sem o
          // ROUND(..., 2) a resposta passaria a trazer cinco casas no dia da
          // poda, e a tela mudaria de forma sem ninguém pedir.
          { tipo_item_id: 1, descricao: 'Papel A0', quantidade: 12.345, valor_unitario: 7.77 },
          { tipo_item_id: 2, descricao: 'Servico', quantidade: 3, valor_unitario: 1000.5 }
        ]
      },
      ADMIN_UUID
    )

    const lido = await dfdCtrl.getPorId(dfd.id)

    expect(Number(lido.itens[0].valor_total)).toBe(95.92)
    expect(Number(lido.itens[1].valor_total)).toBe(3001.5)
    // O estimado do DFD é a soma dos dois, e não uma segunda conta que possa
    // discordar.
    expect(Number(lido.valor_estimado)).toBe(95.92 + 3001.5)

    // E o mesmo valor sai na LISTA, que é outra consulta: se as duas
    // divergissem, a tela e a ficha diriam números diferentes do mesmo DFD.
    const [naLista] = (await dfdCtrl.listar(ANO)).filter(d => d.id === dfd.id)
    expect(Number(naLista.valor_estimado)).toBe(Number(lido.valor_estimado))
  })

  it('DFD sem item nenhum devolve estimado NULO, como a coluna devolvia', async () => {
    const dfd = await dfdCtrl.criar(
      { numero: 'DFD-P02', ano: ANO, objeto: 'Sem itens', consta_pca: true, itens: [] },
      ADMIN_UUID
    )
    const lido = await dfdCtrl.getPorId(dfd.id)
    expect(lido.valor_estimado).toBeNull()
  })

  // O GND vem da natureza de despesa, e não de coluna do item. Em produção os 36
  // itens concordavam nos 36; o que muda é que agora eles não TÊM como discordar.
  it('o GND do item do PDR vem da ND, e acompanha a ND quando ela muda', async () => {
    const item = await pdrCtrl.criar(
      { ano: ANO, cod_nd: ND_CONSUMO, item_label: '1D', valor_autorizado: 5000 },
      ADMIN_UUID
    )

    expect(Number((await pdrCtrl.getPorId(item.id)).gnd)).toBe(3)

    // Trocar a ND para uma de capital muda o GND sem ninguém digitar nada. Com a
    // coluna, este era exatamente o caminho para os dois discordarem.
    await pdrCtrl.atualizar(
      item.id,
      { ano: ANO, cod_nd: ND_CAPITAL, item_label: '1D', valor_autorizado: 5000 },
      ADMIN_UUID
    )
    expect(Number((await pdrCtrl.getPorId(item.id)).gnd)).toBe(4)
  })

  // O histórico do DFD descreve a lista de itens em TEXTO, e o total entra nessa
  // descrição. Se ele deixasse de entrar, o histórico esconderia justamente a
  // mudança de preço.
  it('o total derivado entra na descrição do item na auditoria', async () => {
    const dfd = await dfdCtrl.criar(
      {
        numero: 'DFD-P03',
        ano: ANO,
        objeto: 'Aquisicao',
        consta_pca: true,
        itens: [{ tipo_item_id: 1, descricao: 'Papel', quantidade: 10, valor_unitario: 5 }]
      },
      ADMIN_UUID
    )

    const [evento] = await db.conn.any(
      `SELECT dados_depois FROM auditoria.evento
        WHERE tabela = 'orcamento.dfd_item' AND entidade_id = $<id>
        ORDER BY id`,
      { id: String(dfd.id) }
    )
    expect(evento.dados_depois.itens[0]).toContain('total 50.00')
  })
})

// ---------------------------------------------------------------------------

describe('As colunas saíram do BANCO, e as que ficaram continuam lá', () => {
  const coluna = (tabela, nome) => db.conn.oneOrNone(
    `SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = $<esquema> AND table_name = $<tabela> AND column_name = $<nome>`,
    { esquema: tabela.split('.')[0], tabela: tabela.split('.')[1], nome }
  )

  const PODADAS = [
    ['orcamento.dfd', 'justificativa'],
    ['orcamento.dfd', 'grau_prioridade_id'],
    ['orcamento.dfd', 'data_prevista_conclusao'],
    ['orcamento.dfd', 'responsavel_cpf'],
    ['orcamento.dfd', 'vinculo_plano_gestao'],
    ['orcamento.dfd', 'valor_estimado'],
    ['orcamento.dfd', 'data_modificacao'],
    ['orcamento.dfd', 'usuario_modificacao_uuid'],
    ['orcamento.dfd_item', 'valor_total'],
    ['orcamento.dfd_item', 'data_modificacao'],
    ['orcamento.dfd_item', 'usuario_modificacao_uuid'],
    ['orcamento.pdr_item', 'gnd'],
    ['orcamento.pdr_item', 'data_modificacao'],
    ['orcamento.pdr_item', 'usuario_modificacao_uuid'],
    ['orcamento.licitacao', 'nup'],
    ['orcamento.licitacao', 'fornecedor'],
    ['orcamento.nota_credito', 'marcador']
  ]

  it.each(PODADAS)('%s não tem mais %s', async (tabela, nome) => {
    expect(await coluna(tabela, nome)).toBeNull()
  })

  it('dominio.grau_prioridade não existe mais, e a rota dela também não', async () => {
    const tabela = await db.conn.oneOrNone(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'dominio' AND table_name = 'grau_prioridade'`
    )
    expect(tabela).toBeNull()

    // A tabela e a rota saem no MESMO commit: catálogo que ninguém referencia,
    // servido por uma rota viva, é o meio cadáver que a 1.34.0 já recusou.
    const dominioCtrl = require('../../orcamento/dominio/dominio_ctrl')
    expect(dominioCtrl.getGrauPrioridade).toBeUndefined()
  })

  // A metade que se erra: `nup` saiu e `numero_pregao` ficou, e as duas nasceram
  // na MESMA migração, quatro dias antes, com as mesmas 0 de 11 linhas. Quem
  // apagar esta por simetria apaga a decisão do chefe.
  it('licitacao AINDA TEM numero_pregao e data_homologacao', async () => {
    expect(await coluna('orcamento.licitacao', 'numero_pregao')).not.toBeNull()
    expect(await coluna('orcamento.licitacao', 'data_homologacao')).not.toBeNull()
    expect(await coluna('orcamento.licitacao', 'fase_atual')).not.toBeNull()
  })

  // O carimbo saiu de TRÊS tabelas, e não do módulo.
  it.each([
    'orcamento.nota_credito', 'orcamento.nota_empenho',
    'orcamento.licitacao', 'orcamento.arquivo'
  ])('%s AINDA TEM data_modificacao', async tabela => {
    expect(await coluna(tabela, 'data_modificacao')).not.toBeNull()
  })

  // Estas saem no RPCMTec 4.6 e por isso não são candidatas, apesar de parecerem
  // o mesmo caso: `prazo_entrega` é 0 de 15 e é a terceira coluna da tabela
  // assinada; `ano_referencia` é 1 de 15 e decide em qual RPCMTec o item aparece.
  it.each(['prazo_entrega', 'ano_referencia'])(
    'recebimento_material AINDA TEM %s, porque a 4.6 a lê', async nome => {
      expect(await coluna('orcamento.recebimento_material', nome)).not.toBeNull()
    }
  )

  it('nota_empenho.ug e .gestao são NOT NULL no banco', async () => {
    expect((await coluna('orcamento.nota_empenho', 'ug')).is_nullable).toBe('NO')
    expect((await coluna('orcamento.nota_empenho', 'gestao')).is_nullable).toBe('NO')
  })
})
