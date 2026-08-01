'use strict'

// A LACUNA QUE ESTE ARQUIVO FECHA (2026-08-01).
//
// Ate hoje NENHUM SQL do modulo orcamento era executado em teste. As 55 rotas e
// os 13 controllers tinham cobertura, mas toda ela contra `helpers/orcamento/
// mockDb`: os testes afirmavam coisas como
//
//     expect(mockDb.conn.one).toHaveBeenCalledWith(
//       expect.stringContaining('INSERT INTO orcamento.rpnp'), ...)
//
// o que prova o MAPEAMENTO DE PARAMETRO (nota_empenho_id -> notaEmpenhoId, que e
// bug real com o `$<param>` do pg-promise) e nada sobre a consulta. Passaria com
// o SQL inteiro quebrado, desde que comecasse com aquele texto. Coluna
// inexistente, JOIN errado, CHECK do banco violado: nada disso aparecia.
//
// O que se testa AQUI e so o que exige banco de verdade:
//   - as regras que vivem dentro de `db.conn.tx`, com agregacao lida do banco
//     (o teto da liquidacao e a soma das alocacoes da NE);
//   - a traducao de erro do PostgreSQL (UNIQUE e FK) para 400 com mensagem
//     legivel, que so acontece quando o banco de fato recusa;
//   - o encadeamento NC -> NE -> liquidacao, que atravessa tres tabelas.
//
// O resto (validacao Joi, 404 de id inexistente) continua no pacote mockado,
// que roda em milissegundos: repetir aqui so tornaria a suite lenta sem provar
// mais nada.

const { db } = require('../../database')
const { cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

const ncCtrl = require('../../orcamento/nota_credito/nota_credito_ctrl')
const neCtrl = require('../../orcamento/nota_empenho/nota_empenho_ctrl')
const liqCtrl = require('../../orcamento/nota_empenho/liquidacao_ctrl')
const pdrCtrl = require('../../orcamento/pdr/pdr_ctrl')

const ANO = 2026
const ND_CONSUMO = '339030'
const ND_DIARIAS = '339014'
const PDR = 1 // dominio.classificacao_nc

// Os controllers do orcamento leem `db.conn` no momento da chamada, e quem o
// cria e o `db.createConn()`. Sem esta linha eles encontrariam `undefined` --
// e essa e a razao de o modulo nunca ter tido teste de integracao: o caminho
// existia so dentro do `helpers/app`, que os testes do orcamento nao usam.
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
    numero: 'NC-001',
    ano: ANO,
    cod_nd: ND_CONSUMO,
    valor_nc: 10000,
    classificacao_id: PDR,
    ...extra
  },
  ADMIN_UUID
)

describe('Orcamento contra o banco de verdade', () => {
  describe('Nota de credito', () => {
    it('insere e le de volta pelo proprio controller', async () => {
      const { id } = await novaNc()
      const lida = await ncCtrl.getPorId(id)

      expect(lida.numero).toBe('NC-001')
      expect(lida.ano).toBe(ANO)
      // O valor vem de NUMERIC, que o pg entrega como string: quem consome a
      // rota recebe isto, e nao um number. O teste mockado nao teria como saber.
      expect(Number(lida.valor_nc)).toBe(10000)
    })

    // A UNIQUE e (ano, numero, cod_nd) por UG emitente. O controller mapeia o
    // SQLSTATE 23505 para uma mensagem legivel; sem banco, o mapa nunca roda.
    //
    // O codigo e 409 (Conflict), e nao 400: a requisicao esta bem formada, o
    // que ha e um recurso que ja existe. Escrevi 400 na primeira versao deste
    // teste e o banco me corrigiu -- exatamente o tipo de detalhe que o mock
    // nunca teria como apontar.
    it('a UNIQUE do SIAFI vira 409 com mensagem, e nao 500', async () => {
      await novaNc()
      await expect(novaNc()).rejects.toMatchObject({ statusCode: 409 })
    })

    // Mesma numeracao, ND diferente: a UNIQUE nao alcanca, e as duas coexistem.
    it('mesmo numero com ND diferente coexiste', async () => {
      await novaNc()
      const outra = await novaNc({ cod_nd: ND_DIARIAS })
      expect(outra.id).toBeDefined()
    })

    // FK: cod_nd que nao esta em dominio.natureza_despesa. O SQLSTATE 23503 e
    // traduzido para 400; sem banco a violacao nunca acontece.
    it('ND inexistente vira 400, e nao erro cru do PostgreSQL', async () => {
      await expect(novaNc({ cod_nd: '999999' })).rejects.toMatchObject({
        statusCode: 400
      })
    })
  })

  describe('Nota de empenho', () => {
    it('empenha contra a NC e soma as alocacoes', async () => {
      const nc = await novaNc()
      const ne = await neCtrl.criar(
        { numero: 'NE-001', ano: ANO, nota_credito_id: nc.id, valor_empenhado: 4000 },
        ADMIN_UUID
      )

      const lida = await neCtrl.getPorId(ne.id)
      expect(Number(lida.valor_empenhado)).toBe(4000)
      expect(lida.nota_credito_id).toBe(nc.id)
    })

    // Alocacao em MAIS DE UMA NC. O `validarNcsHomogeneas` faz um SELECT com
    // `IN ($<ids:csv>)` para exigir mesma ND e mesma classificacao. E consulta
    // de verdade, com formatacao de lista do pg-promise: o mock so registrava
    // que ela foi chamada.
    it('aceita empenho repartido entre NCs da mesma ND', async () => {
      const a = await novaNc({ numero: 'NC-A' })
      const b = await novaNc({ numero: 'NC-B' })

      const ne = await neCtrl.criar(
        {
          numero: 'NE-002',
          ano: ANO,
          notas_credito: [
            { nota_credito_id: a.id, valor: 1500 },
            { nota_credito_id: b.id, valor: 2500 }
          ]
        },
        ADMIN_UUID
      )

      const lida = await neCtrl.getPorId(ne.id)
      expect(Number(lida.valor_empenhado)).toBe(4000)
    })

    it('recusa empenho repartido entre NDs diferentes', async () => {
      const a = await novaNc({ numero: 'NC-A' })
      const b = await novaNc({ numero: 'NC-B', cod_nd: ND_DIARIAS })

      await expect(
        neCtrl.criar(
          {
            numero: 'NE-003',
            ano: ANO,
            notas_credito: [
              { nota_credito_id: a.id, valor: 1000 },
              { nota_credito_id: b.id, valor: 1000 }
            ]
          },
          ADMIN_UUID
        )
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    // A NE nasce numa transacao (INSERT na NE mais as alocacoes). Se a segunda
    // parte falha, a primeira NAO pode ficar gravada -- e so o banco prova isso.
    it('NC inexistente nao deixa NE orfa: a transacao volta inteira', async () => {
      await expect(
        neCtrl.criar(
          { numero: 'NE-004', ano: ANO, nota_credito_id: 999999, valor_empenhado: 100 },
          ADMIN_UUID
        )
      ).rejects.toMatchObject({ statusCode: 400 })

      const sobrou = await db.conn.one(
        "SELECT COUNT(*)::int AS n FROM orcamento.nota_empenho WHERE numero = 'NE-004'"
      )
      expect(sobrou.n).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // O teto da liquidacao
  // -------------------------------------------------------------------------
  // Esta e a regra que MAIS precisava de banco: o controller abre transacao,
  // SOMA as liquidacoes ja existentes da NE e compara com o empenhado. A soma
  // vem de um agregado do PostgreSQL. Contra mock, o `carregarDisponivel`
  // devolvia o que o proprio teste tivesse mandado devolver.
  describe('Liquidacao nao passa do empenhado', () => {
    const prepara = async () => {
      const nc = await novaNc()
      return neCtrl.criar(
        { numero: 'NE-010', ano: ANO, nota_credito_id: nc.id, valor_empenhado: 1000 },
        ADMIN_UUID
      )
    }

    it('aceita liquidacao dentro do empenhado', async () => {
      const ne = await prepara()
      const liq = await liqCtrl.criar(
        { nota_empenho_id: ne.id, valor_liquidado: 600 },
        ADMIN_UUID
      )
      expect(liq.id).toBeDefined()
    })

    it('recusa a liquidacao que SOZINHA passa do empenhado', async () => {
      const ne = await prepara()
      await expect(
        liqCtrl.criar({ nota_empenho_id: ne.id, valor_liquidado: 1500 }, ADMIN_UUID)
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    // O caso que so o banco pega: cada liquidacao cabe, a SOMA nao.
    it('recusa a liquidacao que passa do empenhado SOMADA as anteriores', async () => {
      const ne = await prepara()
      await liqCtrl.criar({ nota_empenho_id: ne.id, valor_liquidado: 600 }, ADMIN_UUID)

      await expect(
        liqCtrl.criar({ nota_empenho_id: ne.id, valor_liquidado: 600 }, ADMIN_UUID)
      ).rejects.toMatchObject({ statusCode: 400 })

      const total = await db.conn.one(
        'SELECT COALESCE(SUM(valor_liquidado), 0)::float AS s FROM orcamento.liquidacao WHERE nota_empenho_id = $1',
        [ne.id]
      )
      expect(total.s).toBe(600)
    })
  })

  // -------------------------------------------------------------------------
  // PDR
  // -------------------------------------------------------------------------
  // Nao existe entidade "PDR": o PDR do ano e o CONJUNTO dos pdr_item daquele
  // ano (CLAUDE.md). Entao o filtro por ano e a definicao do PDR, e vale prova.
  describe('PDR do ano', () => {
    const novoItem = (extra = {}) => pdrCtrl.criar(
      {
        ano: ANO,
        cod_nd: ND_CONSUMO,
        item_label: '1',
        descricao: 'Papel A0',
        gnd: 3,
        valor_solicitado: 5000,
        ...extra
      },
      ADMIN_UUID
    )

    it('lista so os itens do ano pedido', async () => {
      await novoItem()
      await novoItem({ item_label: '2', ano: ANO - 1 })

      const doAno = await pdrCtrl.listar(ANO)
      const anterior = await pdrCtrl.listar(ANO - 1)

      expect(doAno).toHaveLength(1)
      expect(anterior).toHaveLength(1)
      expect(doAno[0].ano).toBe(ANO)
    })

    it('a NC aponta o item do PDR que ela atende', async () => {
      const item = await novoItem()
      const nc = await novaNc({ pdr_item_id: item.id })

      const lida = await ncCtrl.getPorId(nc.id)
      expect(lida.pdr_item_id).toBe(item.id)
    })
  })
})
